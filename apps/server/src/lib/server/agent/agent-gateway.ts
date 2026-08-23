import type {
	AgentConversation,
	AgentConversationSummary,
	AgentRunEvent,
	CancelAgentBusinessExecutionResult,
	CancelAgentRunResult,
	RetryAgentRunInput,
	RetryAgentRunResponse,
	StartAgentRunInput,
	StartAgentRunResponse,
	SubmitAgentClarificationInput,
	SubmitAgentClarificationResponse
} from '@hotel-butler/api';
import type { AgentGateway, AgentPrincipal, ApiLogger } from '@hotel-butler/api/router';
import { TRPCError } from '@trpc/server';
import {
	AgentAccessDeniedError,
	ActiveBusinessExecutionExistsError,
	AgentRepository,
	AgentRunNotRetryableError,
	StaleBusinessExecutionVersionError
} from './agent-repository';
import type { AgentEnvironment } from './agent-config';
import type { AgentRuntime } from './agent-runtime';
import type { ConversationContextService } from './conversation-context';
import type { McpToolProvider } from './mcp-tool-provider';
import type { SkillProvider } from './skill-provider';
import { getHotelQuickAction, listHotelQuickActions } from './hotel-quick-actions';
import type { BusinessIntentRouter } from './execution/business-intent-router';
import type { BusinessSlotResolver } from './execution/slot-resolver';
import type { DeterministicWorkflowCollector } from './execution/deterministic-workflow-collector';
import type { ConversationTitleGenerator } from './conversation-title';
import { RunEventStream } from './run-event-stream';
import { RunLifecycle } from './run-lifecycle';
import { agentFailureLogFields, BusinessExecution } from './business-execution';
export { formatClarificationAnswer } from './business-execution';

type AgentRepositoryPort = Pick<
	AgentRepository,
	| 'listConversations'
	| 'createConversation'
	| 'getConversation'
	| 'deleteConversation'
	| 'clearConversations'
	| 'startRun'
	| 'resumeBusinessExecution'
	| 'cancelBusinessExecution'
	| 'retryBusinessExecution'
	| 'getBusinessExecution'
	| 'transitionBusinessExecution'
	| 'recoverInterruptedRuns'
	| 'getRunContext'
	| 'finalizeRunSuccess'
	| 'appendEvent'
	| 'listEvents'
	| 'completeRun'
	| 'cancelRun'
	| 'listMemories'
	| 'updateConversationTitle'
>;
type McpToolProviderPort = Pick<McpToolProvider, 'serverCount' | 'capabilities'> &
	Partial<Pick<McpToolProvider, 'prewarm'>>;
type ConversationContextPort = Pick<ConversationContextService, 'prepare'>;
type WorkflowCollectorPort = Pick<
	DeterministicWorkflowCollector,
	'collect' | 'assessEvidence' | 'present'
>;
type BusinessIntentRouterPort = Pick<BusinessIntentRouter, 'route'>;
type BusinessSlotResolverPort = Pick<BusinessSlotResolver, 'resolve'>;

export {
	describeAgentRunFailure,
	isBusinessEvidenceTool,
	runGroundedAnalysis
} from './business-execution';

export class HotelAgentGateway implements AgentGateway {
	private readonly eventStream: RunEventStream;
	private readonly runLifecycle: RunLifecycle;
	private readonly businessExecution: BusinessExecution;

	constructor(
		private readonly environment: AgentEnvironment,
		private readonly repository: AgentRepositoryPort,
		private readonly runtime: AgentRuntime,
		private readonly conversationContext: ConversationContextPort,
		private readonly mcpTools: McpToolProviderPort,
		private readonly skills: SkillProvider,
		private readonly logger: ApiLogger,
		private readonly intentRouter?: BusinessIntentRouterPort,
		private readonly slotResolver?: BusinessSlotResolverPort,
		private readonly workflowCollector?: WorkflowCollectorPort,
		private readonly conversationTitleGenerator?: ConversationTitleGenerator
	) {
		this.eventStream = new RunEventStream(repository, logger);
		this.runLifecycle = new RunLifecycle(
			repository,
			(principal, runId, conversationId) =>
				this.eventStream.publish(principal, runId, conversationId, { type: 'run_cancelled' }),
			logger,
			agentFailureLogFields
		);
		this.businessExecution = new BusinessExecution(
			repository,
			logger,
			(principal, runId) => this.launchRun(principal, runId),
			environment,
			runtime,
			conversationContext,
			this.eventStream,
			intentRouter,
			slotResolver,
			workflowCollector,
			conversationTitleGenerator
		);
	}

	async capabilities() {
		if (this.mcpTools.capabilities().has('hotel_data')) {
			this.mcpTools.prewarm?.(['hotel_data']);
		}
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

	async listConversations(principal: AgentPrincipal): Promise<AgentConversationSummary[]> {
		await this.ensureRecovered();
		const startedAt = performance.now();
		const conversations = await this.repository.listConversations(principal);
		this.logger.debug(
			{
				event: 'agent.conversations.listed',
				conversationCount: conversations.length,
				activeRunCount: conversations.filter((conversation) => conversation.activeRunId).length,
				durationMs: Math.max(0, Math.round(performance.now() - startedAt))
			},
			'Agent conversations listed'
		);
		return conversations;
	}

	createConversation(principal: AgentPrincipal, title?: string): Promise<AgentConversationSummary> {
		return this.repository.createConversation(principal, title);
	}

	async getConversation(
		principal: AgentPrincipal,
		conversationId: string
	): Promise<AgentConversation> {
		await this.ensureRecovered();
		const startedAt = performance.now();
		try {
			const conversation = await this.repository.getConversation(principal, conversationId);
			this.logger.debug(
				{
					event: 'agent.conversation.loaded',
					conversationId,
					activeRunId: conversation.activeRun?.runId ?? null,
					messageCount: conversation.messages.length,
					executionCount: conversation.executions.length,
					durationMs: Math.max(0, Math.round(performance.now() - startedAt))
				},
				'Agent conversation loaded'
			);
			return conversation;
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
			return await this.runLifecycle.start(
				principal,
				input,
				this.resolvePrompt(input),
				(runId, controller) => this.businessExecution.executeRun(principal, runId, controller)
			);
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	async submitClarification(
		principal: AgentPrincipal,
		input: SubmitAgentClarificationInput
	): Promise<SubmitAgentClarificationResponse> {
		try {
			await this.ensureRecovered();
			return await this.businessExecution.submitClarification(principal, input);
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	async retryRun(
		principal: AgentPrincipal,
		input: RetryAgentRunInput
	): Promise<RetryAgentRunResponse> {
		try {
			return await this.runLifecycle.retry(
				principal,
				input,
				(runId, controller) => this.businessExecution.executeRun(principal, runId, controller)
			);
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	async cancelBusinessExecution(
		principal: AgentPrincipal,
		businessExecutionId: string,
		expectedVersion: number
	): Promise<CancelAgentBusinessExecutionResult> {
		try {
			return await this.businessExecution.cancel(principal, businessExecutionId, expectedVersion);
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	private launchRun(principal: AgentPrincipal, runId: string): void {
		this.runLifecycle.launch(principal, runId, (controller) =>
			this.businessExecution.executeRun(principal, runId, controller)
		);
	}

	private ensureRecovered(): Promise<void> {
		return this.runLifecycle.ensureRecovered();
	}

	async cancelRun(principal: AgentPrincipal, runId: string): Promise<CancelAgentRunResult> {
		try {
			return await this.runLifecycle.cancel(principal, runId);
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
			yield* this.eventStream.events(principal, input, signal);
		} catch (error) {
			if (signal?.aborted) return;
			throw this.toTrpcError(error);
		}
	}

	private toTrpcError(error: unknown): Error {
		if (error instanceof TRPCError) return error;
		if (error instanceof AgentAccessDeniedError) {
			return new TRPCError({ code: 'NOT_FOUND', message: 'Agent 会话不存在' });
		}
		if (error instanceof ActiveBusinessExecutionExistsError) {
			return new TRPCError({
				code: 'CONFLICT',
				message: '当前会话还有等待补充的任务，请先回答或取消该任务。'
			});
		}
		if (error instanceof StaleBusinessExecutionVersionError) {
			return new TRPCError({ code: 'CONFLICT', message: '任务状态已更新，请刷新会话后重试。' });
		}
		if (error instanceof AgentRunNotRetryableError) {
			return new TRPCError({ code: 'CONFLICT', message: '这次执行不能重试，请重新发起请求。' });
		}
		if (
			error instanceof Error &&
			/interaction is stale|has expired|not awaiting clarification/.test(error.message)
		) {
			return new TRPCError({ code: 'CONFLICT', message: '这次补充信息已经失效，请刷新会话。' });
		}
		return error instanceof Error ? error : new Error('Unknown agent error');
	}
}
