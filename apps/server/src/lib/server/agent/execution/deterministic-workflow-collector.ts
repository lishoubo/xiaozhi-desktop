import type { AgentPrincipal } from '@hotel-butler/api';
import { randomUUID } from 'node:crypto';
import type { RuntimeEvent } from '../agent-runtime';
import {
	agentPromise,
	agentErrorCauseType,
	agentErrorRetryable,
	agentErrorType,
	agentFailureKind,
	AgentProtocolError,
	AgentUpstreamError,
	runAgentEffect
} from '../agent-effect';
import { summarizeMcpResult } from '../mcp-observability';
import type { McpToolProvider } from '../mcp-tool-provider';
import type { EvidenceEnvelope } from './evidence';
import type {
	EvidenceAssessment,
	EvidenceRecord,
	ResolvedBusinessRequest
} from './business-execution-state';
import type { DeterministicWorkflowAnswer } from './business-workflow';
import type { BusinessWorkflowRegistry } from './business-workflow-registry';
import { executionPolicyForIntent } from './intent-registry';
import { createBusinessWorkflowRegistry } from './registered-business-workflows';

type ToolProviderPort = Pick<McpToolProvider, 'getTools'> &
	Partial<Pick<McpToolProvider, 'refreshTools'>>;

export type WorkflowCollectionRequest = Readonly<{
	principal: AgentPrincipal;
	request: ResolvedBusinessRequest;
	signal: AbortSignal;
	emit(event: RuntimeEvent): Promise<void>;
}>;

export type WorkflowCollectionResult =
	| Readonly<{
			status: 'collected';
			strategy: 'deterministic';
			toolEvidence: readonly Readonly<{
				toolName: string;
				toolArgs: unknown;
				result: unknown;
			}>[];
	  }>
	| Readonly<{
			status: 'fallback';
			reason: 'agent_required' | 'tool_unavailable' | 'incompatible_tool_schema';
	  }>;

function toolResultIsError(result: unknown): boolean {
	return (
		typeof result === 'object' &&
		result !== null &&
		(Reflect.get(result, 'isError') === true || Reflect.get(result, 'status') === 'error')
	);
}

function shouldRefreshMcpTools(error: unknown): boolean {
	return (
		error instanceof AgentUpstreamError &&
		error.service === 'mcp' &&
		error.kind === 'unavailable' &&
		agentErrorCauseType(error) === 'ToolException'
	);
}

export class DeterministicWorkflowCollector {
	constructor(
		private readonly tools: ToolProviderPort,
		private readonly workflows: BusinessWorkflowRegistry = createBusinessWorkflowRegistry()
	) {}

	assessEvidence(
		request: ResolvedBusinessRequest,
		evidence: readonly EvidenceEnvelope[],
		followUpUsed: boolean
	): EvidenceAssessment {
		return this.workflows.resolve(request.intent).assessEvidence(request, evidence, followUpUsed);
	}

	present(
		request: ResolvedBusinessRequest,
		evidence: readonly EvidenceRecord[]
	): DeterministicWorkflowAnswer | null {
		return this.workflows.resolve(request.intent).present(request, evidence);
	}

	async collect(input: WorkflowCollectionRequest): Promise<WorkflowCollectionResult> {
		const handler = this.workflows.resolve(input.request.intent);
		const { allowedMcpCapabilities } = executionPolicyForIntent(input.request.intent);
		const tools = handler.requiresToolCatalog(input.request)
			? await runAgentEffect(
					agentPromise({
						service: 'mcp',
						operation: 'load_tool_catalog',
						timeoutMs: 55_000,
						try: () => this.tools.getTools(allowedMcpCapabilities)
					}),
					input.signal
				)
			: [];
		const initialPlan = handler.planCollection(input.request, tools);
		if (initialPlan.kind === 'agent') {
			return { status: 'fallback', reason: initialPlan.reason };
		}
		if (initialPlan.kind === 'protocol_error') {
			throw new AgentProtocolError({
				operation: initialPlan.operation,
				reason: initialPlan.reason
			});
		}
		let selected = initialPlan;
		const toolCallId = `${selected.tool.name}_${randomUUID()}`;
		await runAgentEffect(
			agentPromise({
				service: 'persistence',
				operation: 'publish_tool_started',
				timeoutMs: 10_000,
				try: () => input.emit({ type: 'tool_started', toolCallId, toolName: selected.tool.name })
			}),
			input.signal
		);
		await input.emit({ type: 'mcp_call_started', toolCallId, toolName: selected.tool.name });
		const callStartedAt = performance.now();
		let result: unknown;
		try {
			const invoke = () =>
				runAgentEffect(
					agentPromise({
						service: 'mcp',
						operation: selected.tool.name,
						timeoutMs: 50_000,
						try: (signal) => selected.tool.invoke(selected.args, { signal })
					}),
					input.signal
				);
			try {
				result = await invoke();
			} catch (error) {
				const refreshTools = this.tools.refreshTools;
				if (!shouldRefreshMcpTools(error) || !refreshTools) throw error;
				const refreshedTools = await runAgentEffect(
					agentPromise({
						service: 'mcp',
						operation: 'refresh_tool_catalog',
						timeoutMs: 55_000,
						try: () => refreshTools.call(this.tools, allowedMcpCapabilities)
					}),
					input.signal
				);
				const refreshedPlan = handler.planCollection(input.request, refreshedTools);
				if (refreshedPlan.kind !== 'direct') throw error;
				selected = refreshedPlan;
				result = await invoke();
			}
		} catch (error) {
			await input.emit({
				type: 'mcp_call_failed',
				toolCallId,
				toolName: selected.tool.name,
				durationMs: Math.max(0, Math.round(performance.now() - callStartedAt)),
				errorType: agentErrorType(error),
				...(agentErrorCauseType(error) ? { causeType: agentErrorCauseType(error) } : {}),
				failureKind: agentFailureKind(error),
				retryable: agentErrorRetryable(error)
			});
			throw error;
		}
		if (toolResultIsError(result)) {
			const error = new AgentUpstreamError({
				service: 'mcp',
				operation: selected.tool.name,
				kind: 'invalid_response'
			});
			await input.emit({
				type: 'mcp_call_failed',
				toolCallId,
				toolName: selected.tool.name,
				durationMs: Math.max(0, Math.round(performance.now() - callStartedAt)),
				errorType: agentErrorType(error),
				...(agentErrorCauseType(error) ? { causeType: agentErrorCauseType(error) } : {}),
				failureKind: agentFailureKind(error),
				retryable: agentErrorRetryable(error)
			});
			throw error;
		}
		await input.emit({
			type: 'mcp_call_completed',
			toolCallId,
			toolName: selected.tool.name,
			durationMs: Math.max(0, Math.round(performance.now() - callStartedAt)),
			resultSummary: summarizeMcpResult(result)
		});
		await runAgentEffect(
			agentPromise({
				service: 'persistence',
				operation: 'publish_tool_completed',
				timeoutMs: 10_000,
				try: () =>
					input.emit({
						type: 'tool_completed',
						toolCallId,
						toolName: selected.tool.name,
						summary: '工具调用已完成'
					})
			}),
			input.signal
		);
		return {
			status: 'collected',
			strategy: 'deterministic',
			toolEvidence: [{ toolName: selected.tool.name, toolArgs: selected.args, result }]
		};
	}
}
