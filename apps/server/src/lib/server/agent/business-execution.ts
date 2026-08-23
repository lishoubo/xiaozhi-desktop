import { agentQuickActionIdSchema } from '@hotel-butler/api';
import type {
	AgentClarificationField,
	CancelAgentBusinessExecutionResult,
	SubmitAgentClarificationInput,
	SubmitAgentClarificationResponse
} from '@hotel-butler/api';
import type { AgentPrincipal, ApiLogger } from '@hotel-butler/api/router';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import type { AgentRepository } from './agent-repository';
import type { AgentEnvironment } from './agent-config';
import {
	shouldForwardCollectionRuntimeEvent,
	type AgentRuntime
} from './agent-runtime';
import type { ConversationContextService } from './conversation-context';
import type { BusinessIntentRouter } from './execution/business-intent-router';
import {
	executionPolicyForIntent,
	generalConversationExecutionPolicy,
	getIntentDefinition,
	presentationPolicyForIntent
} from './execution/intent-registry';
import type { BusinessSlotResolver } from './execution/slot-resolver';
import { resolveRelativeDateRange } from './execution/slot-resolver';
import {
	evidenceVerifiesRequestedScope,
	normalizeEvidence,
	restoreEvidenceEnvelope,
	type EvidenceEnvelope
} from './execution/evidence';
import { buildNoHotelDataAnswer } from './execution/no-data-answer';
import { buildRoutingContext } from './execution/routing-context';
import type {
	JsonValue,
	ResolvedBusinessRequest
} from './execution/business-execution-state';
import type { DeterministicWorkflowCollector } from './execution/deterministic-workflow-collector';
import {
	summarizeConversationTitle,
	type ConversationTitleGenerator
} from './conversation-title';
import {
	agentErrorType,
	agentErrorCauseType,
	agentFailureKind,
	AgentProtocolError,
	AgentUpstreamError
} from './agent-effect';
import { describeAgentFailure, evidenceFailure, toolFailureSummary } from './agent-failure';
import { runWithHotelDataAccessScope } from './hotel-data-access-scope';
import { HOTEL_DATA_SQL_TOOL_NAME } from './hotel-data-mcp';
import { mcpResultIsError } from './mcp-observability';
import type { RunEventStream } from './run-event-stream';

type BusinessExecutionRepository = Pick<
	AgentRepository,
	| 'getBusinessExecution'
	| 'resumeBusinessExecution'
	| 'cancelBusinessExecution'
	| 'getRunContext'
	| 'getConversation'
	| 'listMemories'
	| 'updateConversationTitle'
	| 'transitionBusinessExecution'
	| 'completeRun'
	| 'finalizeRunSuccess'
>;

type ConversationContextPort = Pick<ConversationContextService, 'prepare'>;
type WorkflowCollectorPort = Pick<
	DeterministicWorkflowCollector,
	'collect' | 'assessEvidence' | 'present'
>;
type BusinessIntentRouterPort = Pick<BusinessIntentRouter, 'route'>;
type BusinessSlotResolverPort = Pick<BusinessSlotResolver, 'resolve'>;

const GROUNDED_ANALYSIS_TIMEOUT_MS = 90_000;
const HOTEL_DATA_COLLECTION_TIMEOUT_MS = 120_000;

export function isBusinessEvidenceTool(
	request: Pick<ResolvedBusinessRequest, 'intent'>,
	toolName: string
): boolean {
	if (
		request.intent === 'generic_hotel_data_query' ||
		request.intent === 'hotel_operating_summary'
	) {
		return toolName === HOTEL_DATA_SQL_TOOL_NAME;
	}
	return toolName !== 'render_hotel_ui';
}

function requestHotelDataScope(
	principal: AgentPrincipal,
	request: ResolvedBusinessRequest
): readonly string[] | undefined {
	if (!principal.hotelAccess) return undefined;
	const allowed = new Set(principal.hotelAccess.hotels.map((hotel) => hotel.id));
	const requested = request.slots.hotelReference;
	const hotelIds =
		typeof requested === 'string'
			? [requested]
			: Array.isArray(requested) && requested.every((hotel) => typeof hotel === 'string')
				? requested
				: [];
	return hotelIds.every((hotel) => allowed.has(hotel)) ? hotelIds : [];
}

export function describeAgentRunFailure(error: unknown): ReturnType<typeof describeAgentFailure> {
	return describeAgentFailure(error);
}

function describeEvidenceRejection(reasonCode: string): Readonly<{
	code: import('@hotel-butler/api').AgentFailureCode;
	message: string;
	recovery: import('@hotel-butler/api').AgentFailureRecovery;
	retryable: boolean;
}> {
	return evidenceFailure(reasonCode);
}

export function agentFailureLogFields(error: unknown): Readonly<{
	errorType: string;
	failureKind: string;
	upstreamService?: string;
	upstreamOperation?: string;
	upstreamFailureKind?: string;
	analysisCompletionIssue?: 'empty' | 'output_limit';
	causeType?: string;
}> {
	const analysisCompletionIssue =
		error instanceof AgentUpstreamError &&
		error.cause instanceof Error &&
		error.cause.name === 'AgentAnalysisIncompleteError' &&
		(error.cause.message === 'empty' || error.cause.message === 'output_limit')
			? error.cause.message
			: undefined;
	return {
		errorType: agentErrorType(error),
		failureKind: agentFailureKind(error),
		...(agentErrorCauseType(error) ? { causeType: agentErrorCauseType(error) } : {}),
		...(analysisCompletionIssue ? { analysisCompletionIssue } : {}),
		...(error instanceof AgentUpstreamError
			? {
					upstreamService: error.service,
					upstreamOperation: error.operation,
					upstreamFailureKind: error.kind
				}
			: {})
	};
}

export async function runGroundedAnalysis(
	runtime: AgentRuntime,
	options: Parameters<AgentRuntime['run']>[0],
	timeoutMs = GROUNDED_ANALYSIS_TIMEOUT_MS,
	operation = 'analyze_grounded_answer'
): Promise<Awaited<ReturnType<AgentRuntime['run']>>> {
	options.signal.throwIfAborted();
	const analysisController = new AbortController();
	let timedOut = false;
	let finished = false;
	let rejectDeadline: (reason: unknown) => void = () => undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		rejectDeadline = reject;
	});
	const abortFromParent = () => {
		finished = true;
		analysisController.abort(options.signal.reason);
		rejectDeadline(options.signal.reason ?? new DOMException('Run cancelled', 'AbortError'));
	};
	options.signal.addEventListener('abort', abortFromParent, { once: true });
	const timeout = setTimeout(() => {
		timedOut = true;
		finished = true;
		const error = new AgentUpstreamError({
			service: 'model',
			operation,
			kind: 'timeout'
		});
		analysisController.abort(error);
		rejectDeadline(error);
	}, timeoutMs);
	timeout.unref();
	const runtimeResult = runtime.run({
		...options,
		signal: analysisController.signal,
		emit: (event) => (finished ? Promise.resolve() : options.emit(event))
	});
	try {
		return await Promise.race([runtimeResult, deadline]);
	} catch (error) {
		if (timedOut && !options.signal.aborted && !(error instanceof AgentUpstreamError)) {
			throw new AgentUpstreamError({
				service: 'model',
				operation,
				kind: 'timeout',
				cause: error
			});
		}
		throw error;
	} finally {
		finished = true;
		clearTimeout(timeout);
		options.signal.removeEventListener('abort', abortFromParent);
	}
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

export class BusinessExecution {
	constructor(
		private readonly repository: BusinessExecutionRepository,
		private readonly logger: ApiLogger,
		private readonly launchRun: (principal: AgentPrincipal, runId: string) => void,
		private readonly environment: AgentEnvironment,
		private readonly runtime: AgentRuntime,
		private readonly conversationContext: ConversationContextPort,
		private readonly eventStream: RunEventStream,
		private readonly intentRouter?: BusinessIntentRouterPort,
		private readonly slotResolver?: BusinessSlotResolverPort,
		private readonly workflowCollector?: WorkflowCollectorPort,
		private readonly conversationTitleGenerator?: ConversationTitleGenerator
	) {}

	async submitClarification(
		principal: AgentPrincipal,
		input: SubmitAgentClarificationInput
	): Promise<SubmitAgentClarificationResponse> {
		const execution = await this.repository.getBusinessExecution(principal, input.businessExecutionId);
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
						.map(
							(field) =>
								`${field.label}：${formatClarificationAnswer(field, answers[field.slot])}`
						)
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
	}

	async cancel(
		principal: AgentPrincipal,
		businessExecutionId: string,
		expectedVersion: number
	): Promise<CancelAgentBusinessExecutionResult> {
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
	}

	private extractClarificationAnswers(
		clarification: Extract<
			Awaited<ReturnType<BusinessExecutionRepository['getBusinessExecution']>>['state'],
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

	async executeRun(
		principal: AgentPrincipal,
		runId: string,
		controller: AbortController
	): Promise<void> {
		return runWithHotelDataAccessScope(
			principal.hotelAccess?.hotels.map((hotel) => hotel.id),
			() => this.executeRunWithHotelDataAccess(principal, runId, controller)
		);
	}

	private async executeRunWithHotelDataAccess(
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
					fastModel: this.environment.fastModel,
					analysisModel: this.environment.model
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
			const memories = await this.repository.listMemories(principal);
			const promptForTitle = context.userMessage?.content;
			const fallbackTitle = promptForTitle ? summarizeConversationTitle(promptForTitle) : null;
			const titleUpdate =
				this.conversationTitleGenerator &&
				promptForTitle &&
				fallbackTitle &&
				context.conversation.title === fallbackTitle
					? this.conversationTitleGenerator
							.generate(promptForTitle, controller.signal)
							.then((title) =>
								this.repository.updateConversationTitle(principal, {
									conversationId: context.conversation.id,
									expectedTitle: fallbackTitle,
									title
								})
							)
							.catch((error: unknown) => {
								if (controller.signal.aborted) return;
								this.logger.warn(
									{
										event: 'agent.conversation.title.failed',
										conversationId: context.conversation.id,
										errorType: error instanceof Error ? error.name : 'UnknownError'
									},
									'Agent conversation title generation failed; keeping fallback title'
								);
							})
					: Promise.resolve();
			void titleUpdate;
			await this.eventStream.publish(principal, runId, context.conversation.id, { type: 'run_started' });
			if (this.intentRouter && this.slotResolver && context.run.businessExecutionId) {
				let execution = await this.repository.getBusinessExecution(
					principal,
					context.run.businessExecutionId
				);
				if (execution.state.status === 'routing') {
					const routingContext =
						execution.state.inputKind === 'prompt'
							? buildRoutingContext({
									conversationSummary: prepared.summary,
									history: prepared.history,
									currentMessageId: execution.summary.triggerUserMessageId,
									memories,
									recentBusinessRequests: context.recentBusinessRequests
								})
							: null;
					const decision = await this.intentRouter.route(
						execution.state.inputKind === 'quick_action'
							? {
									kind: 'quick_action',
									quickActionId: agentQuickActionIdSchema.parse(execution.state.inputValue)
								}
							: {
									kind: 'prompt',
									text: execution.state.inputValue,
									...(routingContext ? { context: routingContext } : {})
								}
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
								responseMode: decision.responseMode,
								slots: decision.slots
							}
						}
					);
					await this.eventStream.publish(principal, runId, context.conversation.id, {
						type: 'business_execution_updated',
						execution: execution.summary
					});
				}
				if (execution.state.status === 'resolving_slots') {
					if (!execution.state.intent) throw new Error('Business intent is unresolved');
					const resolution = await this.slotResolver.resolve({
						definition: getIntentDefinition(execution.state.intent),
						intent: execution.state.intent,
						responseMode: execution.state.responseMode,
						orgId: principal.orgId,
						hotelAccess: principal.hotelAccess,
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
					await this.eventStream.publish(principal, runId, context.conversation.id, {
						type: 'business_execution_updated',
						execution: execution.summary
					});
				}
				if (execution.state.status === 'awaiting_clarification') {
					let clarificationText = execution.state.clarification.prompt;
					if (this.runtime.writeClarification) {
						try {
							clarificationText = await this.runtime.writeClarification({
								userRequest: context.userMessage.content,
								clarification: execution.state.clarification,
								signal: controller.signal
							});
						} catch (error) {
							if (controller.signal.aborted) throw error;
							this.logger.warn(
								{
									event: 'agent.clarification.copy.failed',
									runId,
									conversationId: context.conversation.id,
									...agentFailureLogFields(error)
								},
								'Clarification copy generation failed; using deterministic fallback'
							);
						}
					}
					const message = await this.repository.finalizeRunSuccess(
						runId,
						context.conversation.id,
						clarificationText,
						null
					);
					if (message) {
						await this.eventStream.publish(principal, runId, context.conversation.id, {
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
				let remainingWorkflowToolCalls =
					execution.state.status === 'executing'
						? getIntentDefinition(execution.state.request.intent).maxToolCalls
						: 0;
				const collectionSignal = AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(HOTEL_DATA_COLLECTION_TIMEOUT_MS)
				]);
				const accumulatedEnvelopes: EvidenceEnvelope[] =
					execution.state.status === 'executing'
						? execution.state.evidence.flatMap((record) => {
								const restored = restoreEvidenceEnvelope(record);
								return restored ? [restored] : [];
							})
						: [];
				const evidenceFingerprints = new Set(
					accumulatedEnvelopes.map((item) => item.queryFingerprint)
				);
				let evidenceGap: string | undefined;
				while (execution.state.status === 'executing' && workflowPasses < 2) {
					workflowPasses += 1;
					const workflowRequest = execution.state.request;
					const workflowHotelIds = requestHotelDataScope(principal, workflowRequest);
					const collectionStartedAt = performance.now();
					let collectionStrategy: 'deterministic' | 'agent' = 'agent';
					let collectedToolEvidence: NonNullable<
						Awaited<ReturnType<AgentRuntime['run']>>['toolEvidence']
					> = [];
					let collectionToolCallCount = 0;
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
					const workflowCollector = this.workflowCollector;
					const deterministic =
						workflowCollector && evidenceGap === undefined
							? await runWithHotelDataAccessScope(workflowHotelIds, () =>
									workflowCollector.collect({
										principal,
										request: workflowRequest,
										signal: collectionSignal,
										emit: (event) =>
											this.eventStream.forwardRuntimeEvent(
												principal,
												runId,
												context.conversation.id,
												event,
												context.run.businessExecutionId
											)
									})
								)
							: { status: 'fallback' as const, reason: 'agent_required' as const };
					if (deterministic.status === 'collected') {
						collectionStrategy = deterministic.strategy;
						collectedToolEvidence = deterministic.toolEvidence;
						collectionToolCallCount = deterministic.toolEvidence.length;
					} else {
						controlledResult = await runWithHotelDataAccessScope(workflowHotelIds, () =>
							this.runtime.run({
								principal,
								conversationSummary: prepared.summary,
								history: prepared.history,
								memories,
								...executionPolicyForIntent(workflowRequest.intent),
								signal: collectionSignal,
								workflowRequest,
								evidenceGap,
								workflowToolCallBudget: remainingWorkflowToolCalls,
								emit: (event) =>
									shouldForwardCollectionRuntimeEvent(event)
										? this.eventStream.forwardRuntimeEvent(
												principal,
												runId,
												context.conversation.id,
												event,
												context.run.businessExecutionId
											)
										: Promise.resolve()
							})
						);
						collectedToolEvidence = controlledResult.toolEvidence ?? [];
						collectionToolCallCount =
							controlledResult.toolCallCount ?? collectedToolEvidence.length;
					}
					remainingWorkflowToolCalls = Math.max(
						0,
						remainingWorkflowToolCalls - collectionToolCallCount
					);
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
							unresolvedToolArgumentCount: collectedToolEvidence.filter(
								(item) => item.toolName === HOTEL_DATA_SQL_TOOL_NAME && item.toolArgs === null
							).length,
							durationMs: Math.max(0, Math.round(performance.now() - collectionStartedAt))
						},
						'Agent workflow collection completed'
					);
					const normalizedEnvelopes = collectedToolEvidence
						.filter(
							(item) =>
								isBusinessEvidenceTool(workflowRequest, item.toolName) &&
								!mcpResultIsError(item.result)
						)
						.map((item) =>
							normalizeEvidence({
								request: workflowRequest,
								toolName: item.toolName,
								toolArgs: item.toolArgs,
								result: item.result,
								verifiedHotelScope: workflowHotelIds,
								observedAt: new Date().toISOString()
							})
						)
						.filter((item) => evidenceVerifiesRequestedScope(workflowRequest, item));
					const envelopes = normalizedEnvelopes.filter((item) => {
						if (evidenceFingerprints.has(item.queryFingerprint)) return false;
						evidenceFingerprints.add(item.queryFingerprint);
						return true;
					});
					accumulatedEnvelopes.push(...envelopes);
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
					if (!workflowCollector) {
						throw new AgentProtocolError({
							operation: 'assess_business_workflow_evidence',
							reason: 'Business workflow collector is unavailable'
						});
					}
					const assessment = workflowCollector.assessEvidence(
						// Evidence assessment is deterministic and intentionally separate from the model.
						execution.state.request,
						accumulatedEnvelopes,
						execution.state.followUpUsed || remainingWorkflowToolCalls === 0
					);
					evidenceGap = assessment.status === 'needs_more_data' ? assessment.limitation : undefined;
					this.logger.info(
						{
							event: 'agent.workflow.evidence.assessed',
							runId,
							conversationId: context.conversation.id,
							businessExecutionId: context.run.businessExecutionId,
							assessment: assessment.status,
							evidenceCount: accumulatedEnvelopes.length,
							evidenceSources: [...new Set(accumulatedEnvelopes.map((item) => item.source))],
							toolNames: [...new Set(accumulatedEnvelopes.map((item) => item.toolName))],
							parseQualities: [...new Set(accumulatedEnvelopes.map((item) => item.parseQuality))],
							coveredDomains: [
								...new Set(accumulatedEnvelopes.flatMap((item) => item.provenance?.domains ?? []))
							],
							tableNames: [
								...new Set(accumulatedEnvelopes.flatMap((item) => item.provenance?.tables ?? []))
							],
							filteredEvidenceCount: accumulatedEnvelopes.filter((item) => item.filtered).length,
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
					const transitioned = await this.repository.completeRun(runId, 'failed', {
						reasonCode: execution.state.reasonCode,
						retryable: failure.retryable
					});
					if (transitioned) {
						await this.eventStream.publish(principal, runId, context.conversation.id, {
							type: 'run_failed',
							...failure
						});
					}
					return;
				}

				if (execution.state.status === 'answering') {
					if (execution.state.mode === 'grounded' && execution.state.request) {
						if (!this.workflowCollector) {
							throw new AgentProtocolError({
								operation: 'present_business_workflow_answer',
								reason: 'Business workflow collector is unavailable'
							});
						}
						const deterministicAnswer = this.workflowCollector.present(
							execution.state.request,
							execution.state.evidence
						);
						if (deterministicAnswer) {
							const limitationText = execution.state.limitations.length
								? `\n\n数据限制：${execution.state.limitations.join('；')}`
								: '';
							const deterministicContent = `${deterministicAnswer.content.trimEnd()}${limitationText}`;
							const toolCallId = `render_hotel_ui_${randomUUID()}`;
							await this.eventStream.forwardRuntimeEvent(
								principal,
								runId,
								context.conversation.id,
								{ type: 'tool_started', toolCallId, toolName: 'render_hotel_ui' },
								context.run.businessExecutionId
							);
							await this.eventStream.forwardRuntimeEvent(
								principal,
								runId,
								context.conversation.id,
								{ type: 'ui_spec', spec: deterministicAnswer.ui },
								context.run.businessExecutionId
							);
							await this.eventStream.forwardRuntimeEvent(
								principal,
								runId,
								context.conversation.id,
								{ type: 'text_delta', delta: `${deterministicContent}\n\n` },
								context.run.businessExecutionId
							);
							await this.eventStream.forwardRuntimeEvent(
								principal,
								runId,
								context.conversation.id,
								{
									type: 'tool_completed',
									toolCallId,
									toolName: 'render_hotel_ui',
									summary: '已根据验证后的经营数据生成结果视图'
								},
								context.run.businessExecutionId
							);
							this.logger.info(
								{
									event: 'agent.answer.deterministic.prepared',
									runId,
									conversationId: context.conversation.id,
									businessExecutionId: context.run.businessExecutionId,
									intent: execution.state.request.intent
								},
								'Deterministic grounded result prepared'
							);
							if (execution.state.request.responseMode === 'data_only') {
								controlledResult = { ...deterministicAnswer, content: deterministicContent };
								this.logger.info(
									{
										event: 'agent.answer.data_only.completed',
										runId,
										conversationId: context.conversation.id,
										businessExecutionId: context.run.businessExecutionId,
										intent: execution.state.request.intent
									},
									'Data-only grounded answer completed'
								);
							} else {
								const analysisToolCallId = `upstream_llm_analysis_${randomUUID()}`;
								await this.eventStream.forwardRuntimeEvent(
									principal,
									runId,
									context.conversation.id,
									{
										type: 'tool_started',
										toolCallId: analysisToolCallId,
										toolName: 'upstream_llm_analysis'
									},
									context.run.businessExecutionId
								);
								const answerStartedAt = performance.now();
								this.logger.info(
									{
										event: 'agent.answer.model.started',
										runId,
										conversationId: context.conversation.id,
										businessExecutionId: context.run.businessExecutionId,
										intent: execution.state.request.intent,
										evidenceCount: execution.state.evidence.length,
										timeoutMs: GROUNDED_ANALYSIS_TIMEOUT_MS
									},
									'Agent answer model started'
								);
								let analysisResult: Awaited<ReturnType<typeof runGroundedAnalysis>> | null = null;
								try {
									analysisResult = await runGroundedAnalysis(this.runtime, {
										principal,
										conversationSummary: null,
										history: [],
										memories,
										...presentationPolicyForIntent(execution.state.request.intent),
										signal: controller.signal,
										workflowRequest: execution.state.request,
										validatedEvidence: execution.state.evidence,
										evidenceLimitations: execution.state.limitations,
										analysisOnly: true,
										emit: (event) =>
											this.eventStream.forwardRuntimeEvent(
												principal,
												runId,
												context.conversation.id,
												event,
												context.run.businessExecutionId
											)
									});
								} catch (error) {
									if (controller.signal.aborted) throw error;
									const failure = describeAgentRunFailure(error);
									await this.eventStream.forwardRuntimeEvent(
										principal,
										runId,
										context.conversation.id,
										{
											type: 'tool_failed',
											toolCallId: analysisToolCallId,
											toolName: 'upstream_llm_analysis',
											code: failure.code,
											summary: toolFailureSummary(failure)
										},
										context.run.businessExecutionId
									);
									controlledResult = {
										content: `${deterministicContent}\n\n${failure.message}`,
										ui: deterministicAnswer.ui
									};
									this.logger.warn(
										{
											event: 'agent.answer.model.degraded',
											runId,
											conversationId: context.conversation.id,
											businessExecutionId: context.run.businessExecutionId,
											failureCode: failure.code
										},
										'Agent answer model failed after deterministic result was prepared'
									);
								}
								if (analysisResult) {
									await this.eventStream.forwardRuntimeEvent(
										principal,
										runId,
										context.conversation.id,
										{
											type: 'tool_completed',
											toolCallId: analysisToolCallId,
											toolName: 'upstream_llm_analysis',
											summary: '上游大模型分析已完成'
										},
										context.run.businessExecutionId
									);
									controlledResult = {
										content: analysisResult.content.trim()
											? `${deterministicContent}\n\n${analysisResult.content.trim()}`
											: deterministicContent,
										ui: deterministicAnswer.ui
									};
									this.logger.info(
										{
											event: 'agent.answer.model.completed',
											runId,
											conversationId: context.conversation.id,
											businessExecutionId: context.run.businessExecutionId,
											hasGenerativeUi: true,
											responseCharacterCount: analysisResult.content.length,
											durationMs: Math.max(0, Math.round(performance.now() - answerStartedAt))
										},
										'Agent answer model completed'
									);
								}
							}
						} else {
							const answerStartedAt = performance.now();
							this.logger.info(
								{
									event: 'agent.answer.model.started',
									runId,
									conversationId: context.conversation.id,
									businessExecutionId: context.run.businessExecutionId,
									intent: execution.state.request.intent,
									evidenceCount: execution.state.evidence.length,
									timeoutMs: GROUNDED_ANALYSIS_TIMEOUT_MS
								},
								'Agent answer model started'
							);
							controlledResult = await runGroundedAnalysis(
								this.runtime,
								{
									principal,
									conversationSummary: null,
									history: [],
									memories,
									...presentationPolicyForIntent(execution.state.request.intent),
									signal: controller.signal,
									workflowRequest: execution.state.request,
									validatedEvidence: execution.state.evidence,
									evidenceLimitations: execution.state.limitations,
									emit: (event) =>
										this.eventStream.forwardRuntimeEvent(
											principal,
											runId,
											context.conversation.id,
											event,
											context.run.businessExecutionId
										)
								},
								GROUNDED_ANALYSIS_TIMEOUT_MS,
								'generate_grounded_answer'
							);
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
					}
					if (execution.state.mode === 'general' && !controlledResult) {
						controlledResult = await this.runtime.run({
							principal,
							conversationSummary: prepared.summary,
							history: prepared.history,
							memories,
							...generalConversationExecutionPolicy,
							signal: controller.signal,
							emit: (event) =>
								this.eventStream.forwardRuntimeEvent(
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
							: execution.state.mode === 'no_data' && execution.state.request
								? buildNoHotelDataAnswer(execution.state.request)
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
					await this.eventStream.publish(principal, runId, context.conversation.id, {
						type: 'business_execution_updated',
						execution: execution.summary
					});
					await this.eventStream.publish(principal, runId, context.conversation.id, {
						type: 'run_completed',
						message
					});
					this.logger.info(
						{
							event: 'agent.run.execution.completed',
							runId,
							conversationId: context.conversation.id,
							durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
							responseCharacterCount: content.length,
							hasGenerativeUi: Boolean(controlledResult?.ui)
						},
						'Agent run execution completed'
					);
					return;
				}
			}
			const result = await this.runtime.run({
				principal,
				conversationSummary: prepared.summary,
				history: prepared.history,
				memories,
				...generalConversationExecutionPolicy,
				signal: controller.signal,
				emit: (event) =>
					this.eventStream.forwardRuntimeEvent(
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
			await this.eventStream.publish(principal, runId, context.conversation.id, {
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
				reasonCode: failure.code,
				retryable: failure.retryable
			});
			if (transitioned) {
				await this.eventStream.publish(principal, runId, context.conversation.id, {
					type: 'run_failed',
					...failure
				});
			}
		}
	}


}
