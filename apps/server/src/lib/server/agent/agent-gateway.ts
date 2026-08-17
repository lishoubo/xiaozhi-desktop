import { agentQuickActionIdSchema, agentRunEventSchema } from '@hotel-butler/api';
import type {
	AgentConversation,
	AgentConversationSummary,
	AgentClarificationField,
	AgentGateway,
	AgentMessage,
	AgentPrincipal,
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
import { TRPCError } from '@trpc/server';
import { EventEmitter, on } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ApiLogger } from '@hotel-butler/api';
import {
	AgentAccessDeniedError,
	ActiveBusinessExecutionExistsError,
	AgentRepository,
	AgentRunNotRetryableError,
	StaleBusinessExecutionVersionError
} from './agent-repository';
import type { AgentEnvironment } from './agent-config';
import type { AgentRuntime, PublishableRuntimeEvent, RuntimeEvent } from './agent-runtime';
import type { ConversationContextService } from './conversation-context';
import type { McpToolProvider } from './mcp-tool-provider';
import type { SkillProvider } from './skill-provider';
import { getHotelQuickAction, listHotelQuickActions } from './hotel-quick-actions';
import type { BusinessIntentRouter } from './execution/business-intent-router';
import { resolveRelativeDateRange, type BusinessSlotResolver } from './execution/slot-resolver';
import { getIntentDefinition } from './execution/intent-registry';
import { assessEvidence, normalizeEvidence } from './execution/evidence';
import type { JsonValue } from './execution/business-execution-state';
import type { DeterministicWorkflowCollector } from './execution/deterministic-workflow-collector';
import {
	agentErrorType,
	agentErrorRetryable,
	agentFailureKind,
	AgentConfigurationError,
	AgentProtocolError,
	AgentUpstreamError
} from './agent-effect';

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
>;
type McpToolProviderPort = Pick<McpToolProvider, 'serverCount' | 'capabilities'>;
type ConversationContextPort = Pick<ConversationContextService, 'prepare'>;
type WorkflowCollectorPort = Pick<DeterministicWorkflowCollector, 'collect'>;
type BusinessIntentRouterPort = Pick<BusinessIntentRouter, 'route'>;
type BusinessSlotResolverPort = Pick<BusinessSlotResolver, 'resolve'>;

const terminal = (event: AgentRunEvent): boolean =>
	event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled';

export function describeAgentRunFailure(
	error: unknown
): Readonly<{ message: string; retryable: boolean }> {
	if (error instanceof AgentConfigurationError) {
		return { message: 'Agent 模型服务尚未配置，请联系管理员。', retryable: false };
	}
	if (error instanceof AgentProtocolError) {
		return { message: '本次请求未通过执行协议校验，请调整查询条件后重试。', retryable: false };
	}
	if (error instanceof AgentUpstreamError) {
		return {
			message:
				error.service === 'mcp'
					? '酒店经营数据服务暂时没有响应。请确认酒店和日期范围后重试，或稍后再试。'
					: '小智暂时无法完成这次请求，请稍后重试。',
			retryable: agentErrorRetryable(error)
		};
	}
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

function describeEvidenceRejection(reasonCode: string): Readonly<{
	message: string;
	retryable: boolean;
}> {
	if (reasonCode === 'evidence_scope_mismatch') {
		return {
			message: '数据源返回的酒店范围与本次请求不一致，已停止生成结论。请确认酒店后重试。',
			retryable: false
		};
	}
	return {
		message: '数据证据未通过安全校验，已停止生成结论。请调整查询条件后重试。',
		retryable: false
	};
}

export function formatClarificationAnswer(
	field: AgentClarificationField,
	value: JsonValue | undefined
): string {
	if (value === undefined || value === null) return '';
	if (field.kind === 'single_choice' && typeof value === 'string') {
		return field.choices.find((choice) => choice.value === value)?.label ?? value;
	}
	if (field.kind === 'date_range' && typeof value === 'object' && !Array.isArray(value)) {
		const start = Reflect.get(value, 'start');
		const end = Reflect.get(value, 'end');
		if (typeof start === 'string' && typeof end === 'string') return `${start} 至 ${end}`;
	}
	return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
		? String(value)
		: JSON.stringify(value);
}

function agentFailureLogFields(error: unknown): Readonly<{
	errorType: string;
	failureKind: string;
	upstreamService?: string;
	upstreamOperation?: string;
	upstreamFailureKind?: string;
}> {
	return {
		errorType: agentErrorType(error),
		failureKind: agentFailureKind(error),
		...(error instanceof AgentUpstreamError
			? {
					upstreamService: error.service,
					upstreamOperation: error.operation,
					upstreamFailureKind: error.kind
				}
			: {})
	};
}

export class HotelAgentGateway implements AgentGateway {
	private readonly eventBus = new EventEmitter();
	private readonly activeRuns = new Map<
		string,
		Readonly<{ ownerEmployeeId: string; controller: AbortController }>
	>();
	private recoveryPromise: Promise<void> | null = null;

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
		private readonly workflowCollector?: WorkflowCollectorPort
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
			await this.ensureRecovered();
			const prompt = this.resolvePrompt(input);
			const result = await this.repository.startRun(principal, {
				conversationId: input.conversationId,
				clientRequestId: input.clientRequestId,
				prompt,
				executionInput:
					'prompt' in input
						? { kind: 'prompt', value: input.prompt }
						: { kind: 'quick_action', value: input.quickActionId }
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

	async submitClarification(
		principal: AgentPrincipal,
		input: SubmitAgentClarificationInput
	): Promise<SubmitAgentClarificationResponse> {
		try {
			await this.ensureRecovered();
			const execution = await this.repository.getBusinessExecution(
				principal,
				input.businessExecutionId
			);
			if (execution.state.status !== 'awaiting_clarification') {
				throw new TRPCError({ code: 'CONFLICT', message: '这次补充信息已经失效，请刷新会话。' });
			}
			const answers =
				'answers' in input
					? input.answers
					: this.extractClarificationAnswers(execution.state.clarification, input.responseText);
			const content =
				'responseText' in input
					? input.responseText
					: execution.state.clarification.fields
							.map((field) => `${field.label}：${formatClarificationAnswer(field, answers[field.slot])}`)
							.join('；');
			const result = await this.repository.resumeBusinessExecution(principal, {
				businessExecutionId: input.businessExecutionId,
				interactionId: input.interactionId,
				expectedVersion: input.expectedVersion,
				clientRequestId: input.clientRequestId,
				content,
				answers
			});
			this.logger.info(
				{
					event: result.created
						? 'agent.business_execution.clarification_accepted'
						: 'agent.business_execution.clarification_reused',
					businessExecutionId: input.businessExecutionId,
					runId: result.response.runId,
					interactionId: input.interactionId,
					answerMode: 'answers' in input ? 'structured' : 'free_text'
				},
				'Agent business clarification accepted'
			);
			if (result.created) this.launchRun(principal, result.response.runId);
			return result.response;
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	async retryRun(
		principal: AgentPrincipal,
		input: RetryAgentRunInput
	): Promise<RetryAgentRunResponse> {
		try {
			await this.ensureRecovered();
			const result = await this.repository.retryBusinessExecution(principal, input);
			if (result.created) this.launchRun(principal, result.response.runId);
			this.logger.info(
				{
					event: result.created ? 'agent.run.retry.accepted' : 'agent.run.retry.reused',
					runId: result.response.runId,
					failedRunId: input.failedRunId,
					conversationId: result.response.userMessage.conversationId
				},
				result.created ? 'Agent run retry accepted' : 'Agent run retry reused'
			);
			return result.response;
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
			const current = await this.repository.getBusinessExecution(principal, businessExecutionId);
			if (current.state.status !== 'awaiting_clarification') {
				throw new TRPCError({ code: 'CONFLICT', message: '只有等待补充信息的任务可以取消。' });
			}
			const result = await this.repository.cancelBusinessExecution(
				principal,
				businessExecutionId,
				expectedVersion
			);
			this.logger.info(
				{
					event: 'agent.business_execution.cancelled',
					businessExecutionId,
					conversationId: current.summary.conversationId
				},
				'Agent business execution cancelled by user'
			);
			return result;
		} catch (error) {
			throw this.toTrpcError(error);
		}
	}

	private launchRun(principal: AgentPrincipal, runId: string): void {
		if (this.activeRuns.has(runId)) return;
		const controller = new AbortController();
		this.activeRuns.set(runId, { ownerEmployeeId: principal.employeeId, controller });
		void this.executeRun(principal, runId, controller).finally(() => {
			const active = this.activeRuns.get(runId);
			if (active?.controller === controller) this.activeRuns.delete(runId);
		});
	}

	private ensureRecovered(): Promise<void> {
		if (!this.recoveryPromise) {
			this.recoveryPromise = this.repository
				.recoverInterruptedRuns()
				.then((runCount) => {
					if (runCount > 0) {
						this.logger.warn(
							{ event: 'agent.runs.recovered_after_restart', runCount },
							'Interrupted Agent runs were marked retryable after restart'
						);
					}
				})
				.catch((error: unknown) => {
					this.recoveryPromise = null;
					throw error;
				});
		}
		return this.recoveryPromise;
	}

	private extractClarificationAnswers(
		clarification: Extract<
			Awaited<ReturnType<AgentRepositoryPort['getBusinessExecution']>>['state'],
			{ status: 'awaiting_clarification' }
		>['clarification'],
		responseText: string
	): Readonly<Record<string, JsonValue>> {
		const answers: Record<string, JsonValue> = {};
		const dateTokens = responseText.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
		let dateIndex = 0;
		for (const field of clarification.fields) {
			if (field.kind === 'single_choice') {
				const match = field.choices.find(
					(choice) => responseText.trim() === choice.value || responseText.includes(choice.label)
				);
				if (match) answers[field.slot] = match.value;
			}
			if (field.kind === 'date') {
				const token = dateTokens[dateIndex] ?? responseText.trim();
				const range = resolveRelativeDateRange(token, new Date());
				if (range) {
					answers[field.slot] = range.start;
					if (dateTokens[dateIndex]) dateIndex += 1;
				}
			}
			if (field.kind === 'date_range') {
				const relative = resolveRelativeDateRange(responseText.trim(), new Date());
				if (relative) answers[field.slot] = { start: relative.start, end: relative.end };
				else if (dateTokens.length >= 2) {
					answers[field.slot] = { start: dateTokens[0] ?? '', end: dateTokens[1] ?? '' };
				}
			}
			if (field.kind === 'number') {
				const match = responseText.match(/\d+(?:\.\d+)?/);
				if (match) answers[field.slot] = Number(match[0]);
			}
		}
		const unresolved = clarification.fields.filter((field) => !(field.slot in answers));
		if (unresolved.length === 1) {
			const field = unresolved[0];
			if (field) answers[field.slot] = responseText.trim();
		}
		if (clarification.fields.some((field) => field.required && !(field.slot in answers))) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: '这条自然语言回复还不能唯一对应所有待补参数，请使用补充信息卡片提交。'
			});
		}
		return answers;
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
			if (this.intentRouter && this.slotResolver && context.run.businessExecutionId) {
				let execution = await this.repository.getBusinessExecution(
					principal,
					context.run.businessExecutionId
				);
				if (execution.state.status === 'routing') {
					const decision = await this.intentRouter.route(
						execution.state.inputKind === 'quick_action'
							? {
									kind: 'quick_action',
									quickActionId: agentQuickActionIdSchema.parse(execution.state.inputValue)
								}
							: { kind: 'prompt', text: execution.state.inputValue }
					);
					execution = await this.repository.transitionBusinessExecution(
						principal,
						context.run.businessExecutionId,
						execution.version,
						{
							type: 'route_classified',
							proposal: {
								routeKind: decision.routeKind,
								intent: decision.intent,
								slots: decision.slots
							}
						}
					);
					await this.publish(principal, runId, context.conversation.id, {
						type: 'business_execution_updated',
						execution: execution.summary
					});
				}
				if (execution.state.status === 'resolving_slots') {
					if (!execution.state.intent) throw new Error('Business intent is unresolved');
					const resolution = await this.slotResolver.resolve({
						definition: getIntentDefinition(execution.state.intent),
						intent: execution.state.intent,
						orgId: principal.orgId,
						slots: execution.state.slots,
						anchorMessageId: execution.summary.triggerUserMessageId,
						version: execution.version + 1
					});
					execution = await this.repository.transitionBusinessExecution(
						principal,
						context.run.businessExecutionId,
						execution.version,
						resolution.status === 'ready'
							? { type: 'slots_ready', request: resolution.request }
							: {
									type: 'slots_need_clarification',
									slots: resolution.slots,
									clarification: resolution.clarification
								}
					);
					await this.publish(principal, runId, context.conversation.id, {
						type: 'business_execution_updated',
						execution: execution.summary
					});
				}
				if (execution.state.status === 'awaiting_clarification') {
					const message = await this.repository.finalizeRunSuccess(
						runId,
						context.conversation.id,
						execution.state.clarification.prompt,
						null
					);
					if (message) {
						await this.publish(principal, runId, context.conversation.id, {
							type: 'run_completed',
							message
						});
					}
					return;
				}

				let controlledResult: Awaited<ReturnType<AgentRuntime['run']>> | null = null;
				if (execution.state.status === 'ready') {
					execution = await this.repository.transitionBusinessExecution(
						principal,
						context.run.businessExecutionId,
						execution.version,
						{ type: 'workflow_started' }
					);
				}
				let workflowPasses = 0;
				while (execution.state.status === 'executing' && workflowPasses < 2) {
					workflowPasses += 1;
					const workflowRequest = execution.state.request;
					const collectionStartedAt = performance.now();
					let collectionStrategy: 'deterministic' | 'agent' = 'agent';
					let collectedToolEvidence: NonNullable<
						Awaited<ReturnType<AgentRuntime['run']>>['toolEvidence']
					> = [];
					this.logger.info(
						{
							event: 'agent.workflow.collection.started',
							runId,
							conversationId: context.conversation.id,
							businessExecutionId: context.run.businessExecutionId,
							workflowPass: workflowPasses,
							intent: workflowRequest.intent
						},
						'Agent workflow collection started'
					);
					const deterministic = this.workflowCollector
						? await this.workflowCollector.collect({
								principal,
								request: workflowRequest,
								signal: controller.signal,
								emit: (event) =>
									this.forwardRuntimeEvent(
										principal,
										runId,
										context.conversation.id,
										event,
										context.run.businessExecutionId
									)
							})
						: { status: 'fallback' as const, reason: 'agent_required' as const };
					if (deterministic.status === 'collected') {
						collectionStrategy = deterministic.strategy;
						collectedToolEvidence = deterministic.toolEvidence;
					} else {
						controlledResult = await this.runtime.run({
							principal,
							conversationSummary: prepared.summary,
							history: prepared.history,
							signal: controller.signal,
							workflowRequest,
							emit: (event) =>
								event.type === 'tool_started' || event.type === 'tool_completed'
									? this.publish(principal, runId, context.conversation.id, event)
									: Promise.resolve()
						});
						collectedToolEvidence = controlledResult.toolEvidence ?? [];
					}
					this.logger.info(
						{
							event: 'agent.workflow.collection.completed',
							runId,
							conversationId: context.conversation.id,
							businessExecutionId: context.run.businessExecutionId,
							workflowPass: workflowPasses,
							strategy: collectionStrategy,
							toolCount: collectedToolEvidence.length,
							toolNames: collectedToolEvidence.map((item) => item.toolName),
							durationMs: Math.max(0, Math.round(performance.now() - collectionStartedAt))
						},
						'Agent workflow collection completed'
					);
					const envelopes = collectedToolEvidence
						.filter((item) => item.toolName !== 'render_hotel_ui')
						.map((item) =>
							normalizeEvidence({
								request: workflowRequest,
								toolName: item.toolName,
								toolArgs: item.toolArgs,
								result: item.result,
								observedAt: new Date().toISOString()
							})
						);
					execution = await this.repository.transitionBusinessExecution(
						principal,
						context.run.businessExecutionId,
						execution.version,
						{
							type: 'workflow_completed',
							evidence: envelopes.map((item) => ({
								evidenceId: item.evidenceId,
								source: item.source,
								data: item
							}))
						}
					);
					if (execution.state.status !== 'validating_evidence') break;
					const evidenceAssessmentStartedAt = performance.now();
					const assessment = assessEvidence(
						// Evidence assessment is deterministic and intentionally separate from the model.
						execution.state.request,
						envelopes,
						execution.state.followUpUsed
					);
					this.logger.info(
						{
							event: 'agent.workflow.evidence.assessed',
							runId,
							conversationId: context.conversation.id,
							businessExecutionId: context.run.businessExecutionId,
							assessment: assessment.status,
							evidenceCount: envelopes.length,
							evidenceSources: [...new Set(envelopes.map((item) => item.source))],
							toolNames: [...new Set(envelopes.map((item) => item.toolName))],
							parseQualities: [...new Set(envelopes.map((item) => item.parseQuality))],
							filteredEvidenceCount: envelopes.filter((item) => item.filtered).length,
							durationMs: Math.max(0, Math.round(performance.now() - evidenceAssessmentStartedAt))
						},
						'Agent workflow evidence assessed'
					);
					execution = await this.repository.transitionBusinessExecution(
						principal,
						context.run.businessExecutionId,
						execution.version,
						{ type: 'evidence_validated', assessment }
					);
				}

				if (execution.state.status === 'failed') {
					const failure = describeEvidenceRejection(execution.state.reasonCode);
					const transitioned = await this.repository.completeRun(runId, 'failed');
					if (transitioned) {
						await this.publish(principal, runId, context.conversation.id, {
							type: 'run_failed',
							...failure
						});
					}
					return;
				}

				if (execution.state.status === 'answering') {
					if (execution.state.mode === 'grounded' && execution.state.request) {
						const answerStartedAt = performance.now();
						this.logger.info(
							{
								event: 'agent.answer.model.started',
								runId,
								conversationId: context.conversation.id,
								businessExecutionId: context.run.businessExecutionId,
								intent: execution.state.request.intent,
								evidenceCount: execution.state.evidence.length
							},
							'Agent answer model started'
						);
						controlledResult = await this.runtime.run({
							principal,
							conversationSummary: null,
							history: [],
							signal: controller.signal,
							workflowRequest: execution.state.request,
							validatedEvidence: execution.state.evidence,
							emit: (event) =>
								this.forwardRuntimeEvent(
									principal,
									runId,
									context.conversation.id,
									event,
									context.run.businessExecutionId
								)
						});
						this.logger.info(
							{
								event: 'agent.answer.model.completed',
								runId,
								conversationId: context.conversation.id,
								businessExecutionId: context.run.businessExecutionId,
								hasGenerativeUi: Boolean(controlledResult.ui),
								durationMs: Math.max(0, Math.round(performance.now() - answerStartedAt))
							},
							'Agent answer model completed'
						);
					}
					if (execution.state.mode === 'general' && !controlledResult) {
						controlledResult = await this.runtime.run({
							principal,
							conversationSummary: prepared.summary,
							history: prepared.history,
							signal: controller.signal,
							validatedEvidence: [],
							emit: (event) =>
								this.forwardRuntimeEvent(
									principal,
									runId,
									context.conversation.id,
									event,
									context.run.businessExecutionId
								)
						});
					}
					const content =
						execution.state.mode === 'write_denied'
							? '当前暂不支持修改订单、价格、库存、房态或其他业务数据。我可以帮助你查询现状、分析原因并给出操作建议。'
							: execution.state.mode === 'limited'
								? `本次查询没有获得足够的可验证数据，因此不输出未经证实的业务结论。${execution.state.limitations.join('')}`
								: controlledResult?.content ||
									`本次查询没有获得足够的可验证数据。${execution.state.limitations.join('')}`;
					const message = await this.repository.finalizeRunSuccess(
						runId,
						context.conversation.id,
						content,
						controlledResult?.ui ?? null
					);
					if (!message) return;
					execution = await this.repository.transitionBusinessExecution(
						principal,
						context.run.businessExecutionId,
						execution.version,
						{ type: 'answer_completed', assistantMessageId: message.id }
					);
					await this.publish(principal, runId, context.conversation.id, {
						type: 'business_execution_updated',
						execution: execution.summary
					});
					await this.publish(principal, runId, context.conversation.id, {
						type: 'run_completed',
						message
					});
					return;
				}
			}
			const result = await this.runtime.run({
				principal,
				conversationSummary: prepared.summary,
				history: prepared.history,
				signal: controller.signal,
				emit: (event) =>
					this.forwardRuntimeEvent(
						principal,
						runId,
						context.conversation.id,
						event,
						context.run.businessExecutionId
					)
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
			const transitioned = await this.repository.completeRun(runId, 'failed', {
				reasonCode: 'run_failed',
				retryable: failure.retryable
			});
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
			| PublishableRuntimeEvent
			| Readonly<{
					type: 'business_execution_updated';
					execution: import('@hotel-butler/api').AgentBusinessExecutionSummary;
			  }>
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
		if (value.type === 'business_execution_updated') {
			this.logger.info(
				{
					event: 'agent.business_execution.state_changed',
					runId,
					conversationId,
					businessExecutionId: value.execution.id,
					status: value.execution.status,
					routeKind: value.execution.routeKind,
					intent: value.execution.intent
				},
				'Agent business execution state changed'
			);
		}
		this.eventBus.emit(runId, value);
	}

	private forwardRuntimeEvent(
		principal: AgentPrincipal,
		runId: string,
		conversationId: string,
		event: RuntimeEvent,
		businessExecutionId: string | null = null
	): Promise<void> {
		if (event.type === 'runtime_phase_completed') {
			this.logger.info(
				{
					event: `agent.runtime.${event.phase}`,
					runId,
					conversationId,
					businessExecutionId,
					durationMs: event.durationMs
				},
				'Agent runtime phase completed'
			);
			return Promise.resolve();
		}
		if (event.type === 'mcp_call_started') {
			this.logger.info(
				{
					event: 'agent.mcp.call.started',
					runId,
					conversationId,
					businessExecutionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName
				},
				'MCP call started'
			);
			return Promise.resolve();
		}
		if (event.type === 'mcp_call_completed') {
			this.logger.info(
				{
					event: 'agent.mcp.call.completed',
					runId,
					conversationId,
					businessExecutionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					durationMs: event.durationMs,
					...event.resultSummary
				},
				'MCP call completed'
			);
			return Promise.resolve();
		}
		if (event.type === 'mcp_call_failed') {
			this.logger.warn(
				{
					event: 'agent.mcp.call.failed',
					runId,
					conversationId,
					businessExecutionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					durationMs: event.durationMs,
					errorType: event.errorType,
					failureKind: event.failureKind,
					retryable: event.retryable
				},
				'MCP call failed'
			);
			return Promise.resolve();
		}
		return this.publish(principal, runId, conversationId, event);
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
