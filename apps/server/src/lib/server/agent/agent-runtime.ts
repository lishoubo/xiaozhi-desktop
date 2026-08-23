import type {
	AgentMessage,
	AgentPendingClarification,
	GenerativeUiSpec
} from '@hotel-butler/api';
import type { AgentPrincipal } from '@hotel-butler/api/router';
import type { EvidenceRecord, ResolvedBusinessRequest } from './execution/business-execution-state';
import type { McpCapability } from './agent-config';
import type { McpResultSummary } from './mcp-observability';

export type AgentRuntimeMemory = Readonly<{
	key: string;
	content: string;
	importance: number;
}>;

export type AgentLocalToolName = 'remember_long_term_memory' | 'render_hotel_ui';

export type PublishableRuntimeEvent =
	| Readonly<{ type: 'text_delta'; delta: string }>
	| Readonly<{ type: 'tool_started'; toolCallId: string; toolName: string }>
	| Readonly<{
			type: 'tool_completed';
			toolCallId: string;
			toolName: string;
			summary: string;
	  }>
	| Readonly<{
			type: 'tool_failed';
			toolCallId: string;
			toolName: string;
			code: import('@hotel-butler/api').AgentFailureCode;
			summary: string;
	  }>
	| Readonly<{ type: 'ui_spec'; spec: GenerativeUiSpec }>;

export type RuntimeTelemetryEvent =
	| Readonly<{
			type: 'runtime_phase_completed';
			phase: 'ui_spec_generated' | 'model_first_token';
			durationMs: number;
	  }>
	| Readonly<{
			type: 'mcp_call_started';
			toolCallId: string;
			toolName: string;
	  }>
	| Readonly<{
			type: 'mcp_call_completed';
			toolCallId: string;
			toolName: string;
			durationMs: number;
			resultSummary: McpResultSummary;
	  }>
	| Readonly<{
			type: 'mcp_call_failed';
			toolCallId: string;
			toolName: string;
			durationMs: number;
			errorType: string;
			causeType?: string;
			failureKind: string;
			retryable: boolean;
	  }>;

export type RuntimeEvent = PublishableRuntimeEvent | RuntimeTelemetryEvent;

export function shouldForwardCollectionRuntimeEvent(event: RuntimeEvent): boolean {
	return (
		event.type === 'tool_started' ||
		event.type === 'tool_completed' ||
		event.type === 'tool_failed' ||
		event.type === 'mcp_call_started' ||
		event.type === 'mcp_call_completed' ||
		event.type === 'mcp_call_failed'
	);
}

export type AgentRuntimeRunOptions = Readonly<{
	principal: AgentPrincipal;
	conversationSummary: string | null;
	history: readonly AgentMessage[];
	memories?: readonly AgentRuntimeMemory[];
	allowedMcpCapabilities: readonly McpCapability[];
	allowedSkillNames: readonly string[];
	allowedLocalToolNames: readonly AgentLocalToolName[];
	signal: AbortSignal;
	emit(event: RuntimeEvent): Promise<void>;
	workflowRequest?: ResolvedBusinessRequest;
	evidenceGap?: string;
	validatedEvidence?: readonly EvidenceRecord[];
	evidenceLimitations?: readonly string[];
	analysisOnly?: boolean;
	workflowToolCallBudget?: number;
}>;

export type AgentRuntimeResult = Readonly<{
	content: string;
	ui: GenerativeUiSpec | null;
	toolEvidence?: readonly Readonly<{ toolName: string; toolArgs: unknown; result: unknown }>[];
	toolCallCount?: number;
}>;

export interface AgentRuntime {
	run(options: AgentRuntimeRunOptions): Promise<AgentRuntimeResult>;
	writeClarification?(
		input: Readonly<{
			userRequest: string;
			clarification: AgentPendingClarification;
			signal: AbortSignal;
		}>
	): Promise<string>;
}
