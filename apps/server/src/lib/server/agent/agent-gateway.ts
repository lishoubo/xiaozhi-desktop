import { agentRunEventSchema } from '@hotel-butler/api';
import type {
	AgentConversation,
	AgentConversationSummary,
	AgentGateway,
	AgentMessage,
	AgentPrincipal,
	AgentRunEvent,
	CancelAgentRunResult,
	StartAgentRunInput,
	StartAgentRunResponse
} from '@hotel-butler/api';
import { TRPCError } from '@trpc/server';
import { EventEmitter, on } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ApiLogger } from '@hotel-butler/api';
import { AgentAccessDeniedError, AgentRepository } from './agent-repository';
import type { AgentEnvironment } from './agent-config';
import type { AgentRuntime, RuntimeEvent } from './agent-runtime';
import type { ConversationContextService } from './conversation-context';
import type { McpToolProvider } from './mcp-tool-provider';
import type { SkillProvider } from './skill-provider';
import { getHotelQuickAction, listHotelQuickActions } from './hotel-quick-actions';

type AgentRepositoryPort = Pick<
	AgentRepository,
	| 'listConversations'
	| 'createConversation'
	| 'getConversation'
	| 'deleteConversation'
	| 'clearConversations'
	| 'startRun'
	| 'getRunContext'
	| 'finalizeRunSuccess'
	| 'appendEvent'
	| 'listEvents'
	| 'completeRun'
	| 'cancelRun'
>;
type McpToolProviderPort = Pick<McpToolProvider, 'serverCount' | 'capabilities'>;
type ConversationContextPort = Pick<ConversationContextService, 'prepare'>;

const terminal = (event: AgentRunEvent): boolean =>
	event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled';

export function describeAgentRunFailure(
	error: unknown
): Readonly<{ message: string; retryable: boolean }> {
	const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	if (/AI_KIMI_API_KEY|not configured/i.test(detail)) {
		return { message: 'Agent 模型服务尚未配置，请联系管理员。', retryable: false };
	}
	if (/askDatabase|executeScript|aliyun-dms-hotel-data|dms-mcpr/i.test(detail)) {
		return {
			message: '酒店经营数据服务暂时没有响应。请确认酒店和日期范围后重试，或稍后再试。',
			retryable: true
		};
	}
	return { message: '小智暂时无法完成这次请求，请稍后重试。', retryable: true };
}

function agentFailureLogFields(error: unknown): Readonly<{
	errorType: string;
	failureKind: string;
}> {
	const errorType =
		error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
			? error.name
			: 'UnknownError';
	const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
	const failureKind = /AI_KIMI_API_KEY|not configured/i.test(detail)
		? 'model_not_configured'
		: /abort/i.test(detail)
			? 'cancelled'
			: /timeout|timed out|ETIMEDOUT/i.test(detail)
				? 'upstream_timeout'
				: /MCP|askDatabase|executeScript|dms-mcpr/i.test(detail)
					? 'tool_or_data_source'
					: 'upstream_failure';
	return { errorType, failureKind };
}

export class HotelAgentGateway implements AgentGateway {
	private readonly eventBus = new EventEmitter();
	private readonly activeRuns = new Map<
		string,
		Readonly<{ ownerEmployeeId: string; controller: AbortController }>
	>();

	constructor(
		private readonly environment: AgentEnvironment,
		private readonly repository: AgentRepositoryPort,
		private readonly runtime: AgentRuntime,
		private readonly conversationContext: ConversationContextPort,
		private readonly mcpTools: McpToolProviderPort,
		private readonly skills: SkillProvider,
		private readonly logger: ApiLogger
	) {
		this.eventBus.setMaxListeners(100);
	}

	async capabilities() {
		const quickActions = listHotelQuickActions(this.mcpTools.capabilities());
		return {
			model: this.environment.model,
			mcpServerCount: this.mcpTools.serverCount(),
			skillCount: (await this.skills.list()).length,
			quickActionCount: quickActions.length,
			generativeUi: true as const,
			longTermMemory: true as const
		};
	}

	async quickActions() {
		return listHotelQuickActions(this.mcpTools.capabilities());
	}

	listConversations(principal: AgentPrincipal): Promise<AgentConversationSummary[]> {
		return this.repository.listConversations(principal);
	}

	createConversation(principal: AgentPrincipal, title?: string): Promise<AgentConversationSummary> {
		return this.repository.createConversation(principal, title);
	}

	async getConversation(
		principal: AgentPrincipal,
		conversationId: string
	): Promise<AgentConversation> {
		try {
			return await this.repository.getConversation(principal, conversationId);
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	async deleteConversation(
		principal: AgentPrincipal,
		conversationId: string
	): Promise<{ deletedCount: number }> {
		const startedAt = performance.now();
		try {
			const result = await this.repository.deleteConversation(principal, conversationId);
			this.logger.info(
				{
					event: 'agent.conversation.deleted',
					conversationId,
					deletedCount: result.deletedCount,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt))
				},
				'Agent conversation deleted'
			);
			return result;
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	async clearConversations(principal: AgentPrincipal): Promise<{ deletedCount: number }> {
		const startedAt = performance.now();
		const result = await this.repository.clearConversations(principal);
		this.logger.info(
			{
				event: 'agent.conversations.cleared',
				deletedCount: result.deletedCount,
				durationMs: Math.max(0, Math.round(performance.now() - startedAt))
			},
			'Agent conversations cleared'
		);
		return result;
	}

	async startRun(
		principal: AgentPrincipal,
		input: StartAgentRunInput
	): Promise<StartAgentRunResponse> {
		try {
			const prompt = this.resolvePrompt(input);
			const result = await this.repository.startRun(principal, {
				conversationId: input.conversationId,
				clientRequestId: input.clientRequestId,
				prompt
			});
			if (result.created && !this.activeRuns.has(result.response.runId)) {
				const controller = new AbortController();
				this.activeRuns.set(result.response.runId, {
					ownerEmployeeId: principal.employeeId,
					controller
				});
				void this.executeRun(principal, result.response.runId, controller).finally(() => {
					const active = this.activeRuns.get(result.response.runId);
					if (active?.controller === controller) this.activeRuns.delete(result.response.runId);
				});
			}
			this.logger.info(
				{
					event: result.created ? 'agent.run.accepted' : 'agent.run.reused',
					runId: result.response.runId,
					conversationId: input.conversationId,
					requestKind: 'prompt' in input ? 'prompt' : 'quick_action'
				},
				result.created ? 'Agent run accepted' : 'Agent run reused'
			);
			return result.response;
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	async cancelRun(principal: AgentPrincipal, runId: string): Promise<CancelAgentRunResult> {
		const startedAt = performance.now();
		try {
			const result = await this.repository.cancelRun(principal, runId);
			if (result.transitioned) {
				const active = this.activeRuns.get(runId);
				if (active?.ownerEmployeeId === principal.employeeId) active.controller.abort();
				await this.publish(principal, runId, result.conversationId, { type: 'run_cancelled' });
			}
			this.logger.info(
				{
					event: result.transitioned ? 'agent.run.cancelled' : 'agent.run.cancel_reused',
					runId,
					conversationId: result.conversationId,
					status: result.status,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt))
				},
				result.transitioned ? 'Agent run cancelled' : 'Agent run cancellation reused terminal state'
			);
			return { runId, status: result.status };
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	private resolvePrompt(input: StartAgentRunInput): string {
		if ('prompt' in input) return input.prompt;
		const action = getHotelQuickAction(input.quickActionId);
		if (!this.mcpTools.capabilities().has(action.requiredCapability)) {
			throw new TRPCError({
				code: 'PRECONDITION_FAILED',
				message: '该快捷操作所需的公共 MCP 能力尚未配置'
			});
		}
		return action.prompt;
	}

	async *events(
		principal: AgentPrincipal,
		input: Readonly<{ runId: string; lastEventId?: string | null }>,
		signal?: AbortSignal
	): AsyncIterable<AgentRunEvent> {
		try {
			const live = on(this.eventBus, input.runId, { signal });
			const history = await this.repository.listEvents(principal, input.runId, input.lastEventId);
			this.logger.debug(
				{
					event: 'agent.events.replay.ready',
					runId: input.runId,
					replayedEventCount: history.length,
					hasCursor: Boolean(input.lastEventId)
				},
				'Agent event replay ready'
			);
			const delivered = new Set<string>();
			for (const event of history) {
				delivered.add(event.id);
				yield event;
				if (terminal(event)) return;
			}
			for await (const [value] of live) {
				const event = agentRunEventSchema.parse(value);
				if (event.id === input.lastEventId || delivered.has(event.id)) continue;
				delivered.add(event.id);
				yield event;
				if (terminal(event)) return;
			}
		} catch (error) {
			if (signal?.aborted) return;
			throw this.toTrpcError(error);
		}
	}

	private async executeRun(
		principal: AgentPrincipal,
		runId: string,
		controller: AbortController
	): Promise<void> {
		const startedAt = performance.now();
		try {
			const context = await this.repository.getRunContext(principal, runId);
			this.logger.info(
				{
					event: 'agent.run.execution.started',
					runId,
					conversationId: context.conversation.id,
					model: this.environment.model
				},
				'Agent run execution started'
			);
			let prepared;
			try {
				prepared = await this.conversationContext.prepare(
					principal,
					context.conversation.id,
					controller.signal
				);
			} catch (error) {
				if (controller.signal.aborted) throw error;
				this.logger.warn(
					{
						event: 'agent.conversation.summary.failed',
						runId,
						conversationId: context.conversation.id,
						...agentFailureLogFields(error)
					},
					'Conversation summarization failed; using full history'
				);
				const conversation = await this.repository.getConversation(
					principal,
					context.conversation.id
				);
				prepared = { summary: null, history: conversation.messages };
			}
			controller.signal.throwIfAborted();
			this.logger.debug(
				{
					event: 'agent.context.prepared',
					runId,
					conversationId: context.conversation.id,
					historyMessageCount: prepared.history.length,
					hasSummary: Boolean(prepared.summary)
				},
				'Agent conversation context prepared'
			);
			await this.publish(principal, runId, context.conversation.id, { type: 'run_started' });
			const result = await this.runtime.run({
				principal,
				conversationSummary: prepared.summary,
				history: prepared.history,
				signal: controller.signal,
				emit: (event) => this.publish(principal, runId, context.conversation.id, event)
			});
			controller.signal.throwIfAborted();
			const message = await this.repository.finalizeRunSuccess(
				runId,
				context.conversation.id,
				result.content,
				result.ui
			);
			if (!message) return;
			await this.publish(principal, runId, context.conversation.id, {
				type: 'run_completed',
				message
			});
			this.logger.info(
				{
					event: 'agent.run.execution.completed',
					runId,
					conversationId: context.conversation.id,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
					responseCharacterCount: result.content.length,
					hasGenerativeUi: Boolean(result.ui)
				},
				'Agent run execution completed'
			);
		} catch (error) {
			if (controller.signal.aborted) {
				this.logger.info(
					{
						event: 'agent.run.execution.cancelled',
						runId,
						durationMs: Math.max(0, Math.round(performance.now() - startedAt))
					},
					'Agent run execution stopped after cancellation'
				);
				return;
			}
			this.logger.error(
				{
					event: 'agent.run.failed',
					runId,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
					...agentFailureLogFields(error)
				},
				'Agent run failed'
			);
			const context = await this.repository.getRunContext(principal, runId);
			const failure = describeAgentRunFailure(error);
			const transitioned = await this.repository.completeRun(runId, 'failed');
			if (transitioned) {
				await this.publish(principal, runId, context.conversation.id, {
					type: 'run_failed',
					...failure
				});
			}
		}
	}

	private async publish(
		principal: AgentPrincipal,
		runId: string,
		conversationId: string,
		event:
			| RuntimeEvent
			| Readonly<{ type: 'run_started' }>
			| Readonly<{ type: 'run_completed'; message: AgentMessage }>
			| Readonly<{ type: 'run_failed'; message: string; retryable: boolean }>
			| Readonly<{ type: 'run_cancelled' }>
	): Promise<void> {
		const value = agentRunEventSchema.parse({
			...event,
			id: randomUUID(),
			runId,
			conversationId,
			createdAt: new Date().toISOString()
		});
		await this.repository.appendEvent(value, principal);
		if (value.type === 'tool_started' || value.type === 'tool_completed') {
			this.logger.debug(
				{
					event: `agent.${value.type}`,
					runId,
					conversationId,
					toolCallId: value.toolCallId,
					toolName: value.toolName
				},
				value.type === 'tool_started' ? 'Agent tool started' : 'Agent tool completed'
			);
		}
		this.eventBus.emit(runId, value);
	}

	private toTrpcError(error: unknown): Error {
		if (error instanceof TRPCError) return error;
		if (error instanceof AgentAccessDeniedError) {
			return new TRPCError({ code: 'NOT_FOUND', message: 'Agent 会话不存在' });
		}
		return error instanceof Error ? error : new Error('Unknown agent error');
	}
}
