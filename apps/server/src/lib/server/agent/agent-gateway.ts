import { agentRunEventSchema } from '@hotel-butler/api';
import type {
	AgentConversation,
	AgentConversationSummary,
	AgentGateway,
	AgentMessage,
	AgentPrincipal,
	AgentRunEvent,
	StartAgentRunInput,
	StartAgentRunResponse
} from '@hotel-butler/api';
import { TRPCError } from '@trpc/server';
import { EventEmitter, on } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ApiLogger } from '@hotel-butler/api';
import { AgentAccessDeniedError, AgentRepository } from './agent-repository';
import type { AgentEnvironment } from './agent-config';
import type { HotelAgentRuntime, RuntimeEvent } from './hotel-agent-runtime';
import type { McpToolProvider } from './mcp-tool-provider';
import type { SkillProvider } from './skill-provider';
import { getHotelQuickAction, listHotelQuickActions } from './hotel-quick-actions';

type AgentRepositoryPort = Pick<
	AgentRepository,
	| 'listConversations'
	| 'createConversation'
	| 'getConversation'
	| 'startRun'
	| 'getRunContext'
	| 'appendAssistantMessage'
	| 'appendEvent'
	| 'listEvents'
	| 'completeRun'
>;
type AgentRuntimePort = Pick<HotelAgentRuntime, 'run'>;
type McpToolProviderPort = Pick<McpToolProvider, 'serverCount' | 'capabilities'>;

const terminal = (event: AgentRunEvent): boolean =>
	event.type === 'run_completed' || event.type === 'run_failed';

export class HotelAgentGateway implements AgentGateway {
	private readonly eventBus = new EventEmitter();
	private readonly activeRuns = new Set<string>();

	constructor(
		private readonly environment: AgentEnvironment,
		private readonly repository: AgentRepositoryPort,
		private readonly runtime: AgentRuntimePort,
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
				this.activeRuns.add(result.response.runId);
				void this.executeRun(principal, result.response.runId).finally(() => {
					this.activeRuns.delete(result.response.runId);
				});
			}
			return result.response;
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

	private async executeRun(principal: AgentPrincipal, runId: string): Promise<void> {
		const controller = new AbortController();
		try {
			const context = await this.repository.getRunContext(principal, runId);
			const conversation = await this.repository.getConversation(
				principal,
				context.conversation.id
			);
			await this.publish(principal, runId, context.conversation.id, { type: 'run_started' });
			const result = await this.runtime.run({
				principal,
				history: conversation.messages,
				signal: controller.signal,
				emit: (event) => this.publish(principal, runId, context.conversation.id, event)
			});
			const message = await this.repository.appendAssistantMessage(
				context.conversation.id,
				result.content,
				result.ui
			);
			await this.publish(principal, runId, context.conversation.id, {
				type: 'run_completed',
				message
			});
			await this.repository.completeRun(runId, 'completed');
		} catch (error) {
			this.logger.error(
				{
					event: 'agent.run.failed',
					runId,
					errorType: error instanceof Error ? error.name : 'UnknownError'
				},
				'Agent run failed'
			);
			const context = await this.repository.getRunContext(principal, runId);
			await this.publish(principal, runId, context.conversation.id, {
				type: 'run_failed',
				message: '小智暂时无法完成这次请求，请稍后重试。',
				retryable: true
			});
			await this.repository.completeRun(runId, 'failed');
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
	): Promise<void> {
		const value = agentRunEventSchema.parse({
			...event,
			id: randomUUID(),
			runId,
			conversationId,
			createdAt: new Date().toISOString()
		});
		await this.repository.appendEvent(value, principal);
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
