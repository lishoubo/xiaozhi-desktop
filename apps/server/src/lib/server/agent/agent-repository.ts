import type {
	AgentConversation,
	AgentConversationSummary,
	AgentBusinessExecutionSummary,
	AgentMessage,
	AgentPrincipal,
	AgentRunEvent,
	GenerativeUiSpec,
	StartAgentRunResponse
} from '@hotel-butler/api';
import { and, asc, desc, eq, gt, isNull, notInArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import {
	agentConversation,
	agentBusinessExecution,
	agentBusinessExecutionEvent,
	agentMemory,
	agentMessage,
	agentRun,
	agentRunEvent
} from '$lib/server/db/agent.schema';
import type { StoredConversationContext } from './conversation-context';
import { buildActiveRunDraft, buildAgentExecutionTraces } from './agent-execution-trace';
import {
	businessExecutionStateSchema,
	transitionBusinessExecution,
	type BusinessExecutionEvent,
	type BusinessExecutionState
} from './execution/business-execution-state';

const toIso = (value: Date): string => value.toISOString();

const toConversationSummary = (
	row: Pick<typeof agentConversation.$inferSelect, 'id' | 'title' | 'createdAt' | 'updatedAt'>,
	activeRunId: string | null = null,
	activeBusinessExecutionId: string | null = null
): AgentConversationSummary => ({
	id: row.id,
	title: row.title,
	activeRunId,
	activeBusinessExecutionId,
	createdAt: toIso(row.createdAt),
	updatedAt: toIso(row.updatedAt)
});

const toMessage = (
	row: Readonly<{
		id: string;
		conversationId: string;
		businessExecutionId?: string | null;
		role: 'user' | 'assistant';
		content: string;
		ui?: GenerativeUiSpec | null;
		createdAt: Date;
	}>
): AgentMessage => ({
	id: row.id,
	conversationId: row.conversationId,
	businessExecutionId: row.businessExecutionId ?? null,
	role: row.role,
	content: row.content,
	ui: row.ui ?? null,
	createdAt: toIso(row.createdAt)
});

const toBusinessExecutionSummary = (
	row: typeof agentBusinessExecution.$inferSelect
): AgentBusinessExecutionSummary => {
	const state = businessExecutionStateSchema.parse(row.state);
	return {
		id: row.id,
		conversationId: row.conversationId,
		triggerUserMessageId: row.triggerUserMessageId,
		routeKind: row.routeKind,
		intent: row.intent,
		status: row.status,
		pendingClarification: state.status === 'awaiting_clarification' ? state.clarification : null,
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
		completedAt: row.completedAt ? toIso(row.completedAt) : null
	};
};

const terminalBusinessExecutionStatuses = ['completed', 'failed', 'cancelled'] as const;

function isTerminalBusinessExecutionStatus(status: BusinessExecutionState['status']): boolean {
	return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function executionRoute(
	state: BusinessExecutionState,
	fallbackRouteKind: AgentBusinessExecutionSummary['routeKind'],
	fallbackIntent: AgentBusinessExecutionSummary['intent']
): Readonly<{
	routeKind: AgentBusinessExecutionSummary['routeKind'];
	intent: AgentBusinessExecutionSummary['intent'];
}> {
	if (state.status === 'resolving_slots' || state.status === 'awaiting_clarification') {
		return { routeKind: state.routeKind, intent: state.intent };
	}
	if (
		state.status === 'ready' ||
		state.status === 'executing' ||
		state.status === 'validating_evidence'
	) {
		return { routeKind: state.request.routeKind, intent: state.request.intent };
	}
	if (state.status === 'answering' && state.request) {
		return { routeKind: state.request.routeKind, intent: state.request.intent };
	}
	return { routeKind: fallbackRouteKind, intent: fallbackIntent };
}

export class AgentAccessDeniedError extends Error {}

export class StaleBusinessExecutionVersionError extends Error {
	constructor(expected: number, actual: number) {
		super(`Agent business execution version is stale: expected ${expected}, actual ${actual}`);
		this.name = 'StaleBusinessExecutionVersionError';
	}
}

export class ActiveBusinessExecutionExistsError extends Error {
	constructor() {
		super('Agent conversation already has an active business execution');
		this.name = 'ActiveBusinessExecutionExistsError';
	}
}

export class AgentRunNotRetryableError extends Error {
	constructor() {
		super('Agent run is not retryable');
		this.name = 'AgentRunNotRetryableError';
	}
}

export type AgentMemoryRecord = Readonly<{ key: string; content: string; importance: number }>;

export class AgentRepository {
	constructor(
		private readonly database: typeof db,
		private readonly now: () => Date = () => new Date(),
		private readonly generateId: () => string = randomUUID
	) {}

	private async loadConversation(principal: AgentPrincipal, conversationId: string) {
		const conversations = await this.database
			.select()
			.from(agentConversation)
			.where(
				and(
					eq(agentConversation.id, conversationId),
					eq(agentConversation.ownerEmployeeId, principal.employeeId)
				)
			)
			.limit(1);
		const conversation = conversations[0];
		if (!conversation) throw new AgentAccessDeniedError('Agent conversation was not found');
		const messages = await this.database
			.select()
			.from(agentMessage)
			.where(eq(agentMessage.conversationId, conversationId))
			.orderBy(asc(agentMessage.createdAt), asc(agentMessage.id));
		return { conversation, messages };
	}

	async listConversations(principal: AgentPrincipal): Promise<AgentConversationSummary[]> {
		const [rows, runningRuns, activeExecutions] = await Promise.all([
			this.database
				.select()
				.from(agentConversation)
				.where(eq(agentConversation.ownerEmployeeId, principal.employeeId))
				.orderBy(desc(agentConversation.updatedAt)),
			this.database
				.select({ id: agentRun.id, conversationId: agentRun.conversationId })
				.from(agentRun)
				.where(
					and(eq(agentRun.ownerEmployeeId, principal.employeeId), eq(agentRun.status, 'running'))
				)
				.orderBy(desc(agentRun.createdAt)),
			this.database
				.select({
					id: agentBusinessExecution.id,
					conversationId: agentBusinessExecution.conversationId
				})
				.from(agentBusinessExecution)
				.where(
					and(
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId),
						notInArray(agentBusinessExecution.status, [...terminalBusinessExecutionStatuses])
					)
				)
				.orderBy(desc(agentBusinessExecution.updatedAt))
		]);
		const activeRunByConversation = new Map<string, string>();
		for (const run of runningRuns) {
			if (!activeRunByConversation.has(run.conversationId)) {
				activeRunByConversation.set(run.conversationId, run.id);
			}
		}
		const activeExecutionByConversation = new Map<string, string>();
		for (const execution of activeExecutions) {
			if (!activeExecutionByConversation.has(execution.conversationId)) {
				activeExecutionByConversation.set(execution.conversationId, execution.id);
			}
		}
		return rows.map((row) =>
			toConversationSummary(
				row,
				activeRunByConversation.get(row.id) ?? null,
				activeExecutionByConversation.get(row.id) ?? null
			)
		);
	}

	async createConversation(
		principal: AgentPrincipal,
		title = '新对话'
	): Promise<AgentConversationSummary> {
		const now = this.now();
		const record: typeof agentConversation.$inferInsert = {
			id: this.generateId(),
			ownerEmployeeId: principal.employeeId,
			ownerOrgId: principal.orgId,
			title,
			createdAt: now,
			updatedAt: now
		};
		await this.database.insert(agentConversation).values(record);
		return toConversationSummary(record);
	}

	async deleteConversation(
		principal: AgentPrincipal,
		conversationId: string
	): Promise<{ deletedCount: number }> {
		const deleted = await this.database
			.delete(agentConversation)
			.where(
				and(
					eq(agentConversation.id, conversationId),
					eq(agentConversation.ownerEmployeeId, principal.employeeId)
				)
			)
			.returning({ id: agentConversation.id });
		if (deleted.length === 0) {
			throw new AgentAccessDeniedError('Agent conversation was not found');
		}
		return { deletedCount: deleted.length };
	}

	async clearConversations(principal: AgentPrincipal): Promise<{ deletedCount: number }> {
		const deleted = await this.database
			.delete(agentConversation)
			.where(eq(agentConversation.ownerEmployeeId, principal.employeeId))
			.returning({ id: agentConversation.id });
		return { deletedCount: deleted.length };
	}

	async getConversation(
		principal: AgentPrincipal,
		conversationId: string
	): Promise<AgentConversation> {
		const { conversation, messages } = await this.loadConversation(principal, conversationId);
		const [runs, events, businessExecutions] = await Promise.all([
			this.database
				.select({
					id: agentRun.id,
					businessExecutionId: agentRun.businessExecutionId,
					userMessageId: agentRun.userMessageId,
					status: agentRun.status,
					createdAt: agentRun.createdAt,
					completedAt: agentRun.completedAt
				})
				.from(agentRun)
				.where(
					and(
						eq(agentRun.conversationId, conversationId),
						eq(agentRun.ownerEmployeeId, principal.employeeId)
					)
				)
				.orderBy(asc(agentRun.createdAt), asc(agentRun.id)),
			this.database
				.select({ payload: agentRunEvent.payload })
				.from(agentRunEvent)
				.where(
					and(
						eq(agentRunEvent.conversationId, conversationId),
						eq(agentRunEvent.ownerEmployeeId, principal.employeeId)
					)
				)
				.orderBy(asc(agentRunEvent.sequence)),
			this.database
				.select()
				.from(agentBusinessExecution)
				.where(
					and(
						eq(agentBusinessExecution.conversationId, conversationId),
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId)
					)
				)
				.orderBy(asc(agentBusinessExecution.createdAt), asc(agentBusinessExecution.id))
		]);
		const activeRun = [...runs].reverse().find((run) => run.status === 'running') ?? null;
		const activeBusinessExecution =
			[...businessExecutions]
				.reverse()
				.find((execution) => !isTerminalBusinessExecutionStatus(execution.status)) ?? null;
		const payloads = events.map((event) => event.payload);
		return {
			conversation: toConversationSummary(
				conversation,
				activeRun?.id ?? null,
				activeBusinessExecution?.id ?? null
			),
			messages: messages.map(toMessage),
			executions: buildAgentExecutionTraces(runs, payloads),
			businessExecutions: businessExecutions.map(toBusinessExecutionSummary),
			activeBusinessExecution: activeBusinessExecution
				? toBusinessExecutionSummary(activeBusinessExecution)
				: null,
			activeRun: activeRun ? buildActiveRunDraft(activeRun.id, payloads) : null
		};
	}

	async getConversationContext(
		principal: AgentPrincipal,
		conversationId: string
	): Promise<StoredConversationContext> {
		const { conversation, messages } = await this.loadConversation(principal, conversationId);
		return {
			conversationId: conversation.id,
			summary: conversation.contextSummary,
			summarizedThroughMessageId: conversation.summarizedThroughMessageId,
			messages: messages.map(toMessage)
		};
	}

	async saveConversationSummary(
		principal: AgentPrincipal,
		input: Readonly<{
			conversationId: string;
			expectedThroughMessageId: string | null;
			summary: string;
			throughMessageId: string;
		}>
	): Promise<boolean> {
		const expectedMarker = input.expectedThroughMessageId
			? eq(agentConversation.summarizedThroughMessageId, input.expectedThroughMessageId)
			: isNull(agentConversation.summarizedThroughMessageId);
		const updated = await this.database
			.update(agentConversation)
			.set({
				contextSummary: input.summary,
				summarizedThroughMessageId: input.throughMessageId,
				summaryUpdatedAt: this.now()
			})
			.where(
				and(
					eq(agentConversation.id, input.conversationId),
					eq(agentConversation.ownerEmployeeId, principal.employeeId),
					expectedMarker
				)
			)
			.returning({ id: agentConversation.id });
		return updated.length === 1;
	}

	async startRun(
		principal: AgentPrincipal,
		input: Readonly<{
			conversationId: string;
			prompt: string;
			clientRequestId: string;
			executionInput?: Readonly<{
				kind: 'prompt' | 'quick_action';
				value: string;
			}>;
		}>
	): Promise<Readonly<{ response: StartAgentRunResponse; created: boolean }>> {
		return this.database.transaction(async (transaction) => {
			const existing = await transaction
				.select({
					runId: agentRun.id,
					businessExecutionId: agentRun.businessExecutionId,
					userMessage: agentMessage
				})
				.from(agentRun)
				.innerJoin(agentMessage, eq(agentRun.userMessageId, agentMessage.id))
				.where(
					and(
						eq(agentRun.ownerEmployeeId, principal.employeeId),
						eq(agentRun.clientRequestId, input.clientRequestId)
					)
				)
				.limit(1);
			if (existing[0]) {
				if (!existing[0].businessExecutionId) {
					throw new Error('Legacy Agent run cannot be resumed as a business execution');
				}
				return {
					response: {
						runId: existing[0].runId,
						businessExecutionId: existing[0].businessExecutionId,
						userMessage: toMessage(existing[0].userMessage)
					},
					created: false
				};
			}

			const owned = await transaction
				.select({ id: agentConversation.id, title: agentConversation.title })
				.from(agentConversation)
				.where(
					and(
						eq(agentConversation.id, input.conversationId),
						eq(agentConversation.ownerEmployeeId, principal.employeeId)
					)
				)
				.limit(1);
			if (!owned[0]) throw new AgentAccessDeniedError('Agent conversation was not found');
			const activeExecution = await transaction
				.select({ id: agentBusinessExecution.id })
				.from(agentBusinessExecution)
				.where(
					and(
						eq(agentBusinessExecution.conversationId, input.conversationId),
						notInArray(agentBusinessExecution.status, [...terminalBusinessExecutionStatuses])
					)
				)
				.limit(1);
			if (activeExecution[0]) throw new ActiveBusinessExecutionExistsError();

			const now = this.now();
			const message: typeof agentMessage.$inferInsert = {
				id: this.generateId(),
				conversationId: input.conversationId,
				businessExecutionId: null,
				role: 'user',
				content: input.prompt,
				ui: null,
				createdAt: now
			};
			const runId = this.generateId();
			const businessExecutionId = this.generateId();
			const initialState: BusinessExecutionState = {
				status: 'routing',
				inputKind: input.executionInput?.kind ?? 'prompt',
				inputValue: input.executionInput?.value ?? input.prompt
			};
			await transaction.insert(agentMessage).values(message);
			await transaction.insert(agentBusinessExecution).values({
				id: businessExecutionId,
				conversationId: input.conversationId,
				triggerUserMessageId: message.id,
				ownerEmployeeId: principal.employeeId,
				ownerOrgId: principal.orgId,
				routeKind: 'unclear',
				intent: null,
				status: initialState.status,
				state: initialState,
				version: 1,
				createdAt: now,
				updatedAt: now
			});
			await transaction
				.update(agentMessage)
				.set({ businessExecutionId })
				.where(eq(agentMessage.id, message.id));
			message.businessExecutionId = businessExecutionId;
			await transaction.insert(agentRun).values({
				id: runId,
				conversationId: input.conversationId,
				ownerEmployeeId: principal.employeeId,
				clientRequestId: input.clientRequestId,
				userMessageId: message.id,
				businessExecutionId,
				status: 'running',
				createdAt: now
			});
			await transaction
				.update(agentConversation)
				.set({
					title: owned[0].title === '新对话' ? input.prompt.slice(0, 40) : owned[0].title,
					updatedAt: now
				})
				.where(eq(agentConversation.id, input.conversationId));
			return {
				response: { runId, businessExecutionId, userMessage: toMessage(message) },
				created: true
			};
		});
	}

	async recoverInterruptedRuns(): Promise<number> {
		return this.database.transaction(async (transaction) => {
			const interrupted = await transaction
				.select()
				.from(agentRun)
				.where(eq(agentRun.status, 'running'));
			if (interrupted.length === 0) return 0;
			const now = this.now();
			for (const run of interrupted) {
				const runEventId = this.generateId();
				await transaction
					.update(agentRun)
					.set({ status: 'failed', completedAt: now })
					.where(and(eq(agentRun.id, run.id), eq(agentRun.status, 'running')));
				await transaction.insert(agentRunEvent).values({
					id: runEventId,
					runId: run.id,
					conversationId: run.conversationId,
					ownerEmployeeId: run.ownerEmployeeId,
					type: 'run_failed',
					payload: {
						id: runEventId,
						runId: run.id,
						conversationId: run.conversationId,
						createdAt: now.toISOString(),
						type: 'run_failed',
						message: '服务重启中断了上次执行，请重试。',
						retryable: true
					},
					createdAt: now
				});
				if (!run.businessExecutionId) continue;
				const executions = await transaction
					.select()
					.from(agentBusinessExecution)
					.where(eq(agentBusinessExecution.id, run.businessExecutionId))
					.limit(1);
				const current = executions[0];
				if (!current || isTerminalBusinessExecutionStatus(current.status)) continue;
				const previous = businessExecutionStateSchema.parse(current.state);
				const next = transitionBusinessExecution(previous, {
					type: 'execution_failed',
					reasonCode: 'server_restart',
					retryable: true
				});
				await transaction
					.update(agentBusinessExecution)
					.set({
						status: next.status,
						state: next,
						version: current.version + 1,
						updatedAt: now,
						completedAt: now,
						expiresAt: null
					})
					.where(eq(agentBusinessExecution.id, current.id));
				await transaction.insert(agentBusinessExecutionEvent).values({
					id: this.generateId(),
					businessExecutionId: current.id,
					conversationId: current.conversationId,
					ownerEmployeeId: current.ownerEmployeeId,
					type: 'execution_failed',
					payload: {
						type: 'execution_failed',
						previousStatus: previous.status,
						nextStatus: next.status,
						version: current.version + 1
					},
					createdAt: now
				});
			}
			return interrupted.length;
		});
	}

	async resumeBusinessExecution(
		principal: AgentPrincipal,
		input: Readonly<{
			businessExecutionId: string;
			interactionId: string;
			expectedVersion: number;
			clientRequestId: string;
			content: string;
			answers: Readonly<Record<string, import('./execution/business-execution-state').JsonValue>>;
		}>
	): Promise<Readonly<{ response: StartAgentRunResponse; created: boolean }>> {
		return this.database.transaction(async (transaction) => {
			const existing = await transaction
				.select({
					runId: agentRun.id,
					businessExecutionId: agentRun.businessExecutionId,
					userMessage: agentMessage
				})
				.from(agentRun)
				.innerJoin(agentMessage, eq(agentRun.userMessageId, agentMessage.id))
				.where(
					and(
						eq(agentRun.ownerEmployeeId, principal.employeeId),
						eq(agentRun.clientRequestId, input.clientRequestId)
					)
				)
				.limit(1);
			if (existing[0]?.businessExecutionId) {
				return {
					response: {
						runId: existing[0].runId,
						businessExecutionId: existing[0].businessExecutionId,
						userMessage: toMessage(existing[0].userMessage)
					},
					created: false
				};
			}

			const rows = await transaction
				.select()
				.from(agentBusinessExecution)
				.where(
					and(
						eq(agentBusinessExecution.id, input.businessExecutionId),
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId)
					)
				)
				.limit(1);
			const current = rows[0];
			if (!current) throw new AgentAccessDeniedError('Agent business execution was not found');
			if (current.version !== input.expectedVersion) {
				throw new StaleBusinessExecutionVersionError(input.expectedVersion, current.version);
			}
			const currentState = businessExecutionStateSchema.parse(current.state);
			if (currentState.status !== 'awaiting_clarification') {
				throw new Error('Agent business execution is not awaiting clarification');
			}
			if (currentState.clarification.interactionId !== input.interactionId) {
				throw new Error('Agent clarification interaction is stale');
			}
			if (new Date(currentState.clarification.expiresAt).getTime() <= this.now().getTime()) {
				throw new Error('Agent clarification interaction has expired');
			}

			const event: BusinessExecutionEvent = {
				type: 'clarification_submitted',
				answers: input.answers
			};
			const nextState = transitionBusinessExecution(currentState, event);
			const nextVersion = current.version + 1;
			const now = this.now();
			const updated = await transaction
				.update(agentBusinessExecution)
				.set({
					status: nextState.status,
					state: nextState,
					version: nextVersion,
					expiresAt: null,
					updatedAt: now
				})
				.where(
					and(
						eq(agentBusinessExecution.id, input.businessExecutionId),
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId),
						eq(agentBusinessExecution.version, input.expectedVersion)
					)
				)
				.returning({ id: agentBusinessExecution.id });
			if (!updated[0]) {
				throw new StaleBusinessExecutionVersionError(input.expectedVersion, nextVersion);
			}
			await transaction.insert(agentBusinessExecutionEvent).values({
				id: this.generateId(),
				businessExecutionId: input.businessExecutionId,
				conversationId: current.conversationId,
				ownerEmployeeId: principal.employeeId,
				type: event.type,
				payload: {
					type: event.type,
					previousStatus: currentState.status,
					nextStatus: nextState.status,
					version: nextVersion
				},
				createdAt: now
			});

			const message: typeof agentMessage.$inferInsert = {
				id: this.generateId(),
				conversationId: current.conversationId,
				businessExecutionId: input.businessExecutionId,
				role: 'user',
				content: input.content,
				ui: null,
				createdAt: now
			};
			const runId = this.generateId();
			await transaction.insert(agentMessage).values(message);
			await transaction.insert(agentRun).values({
				id: runId,
				conversationId: current.conversationId,
				ownerEmployeeId: principal.employeeId,
				clientRequestId: input.clientRequestId,
				userMessageId: message.id,
				businessExecutionId: input.businessExecutionId,
				status: 'running',
				createdAt: now
			});
			await transaction
				.update(agentConversation)
				.set({ updatedAt: now })
				.where(eq(agentConversation.id, current.conversationId));
			return {
				response: {
					runId,
					businessExecutionId: input.businessExecutionId,
					userMessage: toMessage(message)
				},
				created: true
			};
		});
	}

	async retryBusinessExecution(
		principal: AgentPrincipal,
		input: Readonly<{ failedRunId: string; clientRequestId: string }>
	): Promise<Readonly<{ response: StartAgentRunResponse; created: boolean }>> {
		return this.database.transaction(async (transaction) => {
			const existing = await transaction
				.select({
					runId: agentRun.id,
					businessExecutionId: agentRun.businessExecutionId,
					userMessage: agentMessage
				})
				.from(agentRun)
				.innerJoin(agentMessage, eq(agentRun.userMessageId, agentMessage.id))
				.where(
					and(
						eq(agentRun.ownerEmployeeId, principal.employeeId),
						eq(agentRun.clientRequestId, input.clientRequestId)
					)
				)
				.limit(1);
			if (existing[0]?.businessExecutionId) {
				return {
					response: {
						runId: existing[0].runId,
						businessExecutionId: existing[0].businessExecutionId,
						userMessage: toMessage(existing[0].userMessage)
					},
					created: false
				};
			}

			const failedRuns = await transaction
				.select()
				.from(agentRun)
				.where(
					and(
						eq(agentRun.id, input.failedRunId),
						eq(agentRun.ownerEmployeeId, principal.employeeId)
					)
				)
				.limit(1);
			const failedRun = failedRuns[0];
			if (!failedRun) throw new AgentAccessDeniedError('Agent run was not found');
			if (failedRun.status !== 'failed' || !failedRun.businessExecutionId) {
				throw new AgentRunNotRetryableError();
			}
			const laterAttempts = await transaction
				.select({ id: agentRun.id })
				.from(agentRun)
				.where(eq(agentRun.retryOfRunId, failedRun.id))
				.limit(1);
			if (laterAttempts[0]) throw new AgentRunNotRetryableError();

			const rows = await transaction
				.select()
				.from(agentBusinessExecution)
				.where(
					and(
						eq(agentBusinessExecution.id, failedRun.businessExecutionId),
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId)
					)
				)
				.limit(1);
			const current = rows[0];
			if (!current) throw new AgentAccessDeniedError('Agent business execution was not found');
			const currentState = businessExecutionStateSchema.parse(current.state);
			if (
				current.status !== 'failed' ||
				currentState.status !== 'failed' ||
				!currentState.retryable ||
				!currentState.retryCheckpoint
			) {
				throw new AgentRunNotRetryableError();
			}

			const active = await transaction
				.select({ id: agentBusinessExecution.id })
				.from(agentBusinessExecution)
				.where(
					and(
						eq(agentBusinessExecution.conversationId, current.conversationId),
						notInArray(agentBusinessExecution.status, [...terminalBusinessExecutionStatuses])
					)
				)
				.limit(1);
			if (active[0]) throw new ActiveBusinessExecutionExistsError();

			const nextState = transitionBusinessExecution(currentState, {
				type: 'execution_retry_requested'
			});
			const nextVersion = current.version + 1;
			const now = this.now();
			const route = executionRoute(nextState, current.routeKind, current.intent);
			const restored = await transaction
				.update(agentBusinessExecution)
				.set({
					routeKind: route.routeKind,
					intent: route.intent,
					status: nextState.status,
					state: nextState,
					version: nextVersion,
					expiresAt: null,
					updatedAt: now,
					completedAt: null
				})
				.where(
					and(
						eq(agentBusinessExecution.id, current.id),
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId),
						eq(agentBusinessExecution.version, current.version),
						eq(agentBusinessExecution.status, 'failed')
					)
				)
				.returning({ id: agentBusinessExecution.id });
			if (!restored[0]) {
				throw new StaleBusinessExecutionVersionError(current.version, nextVersion);
			}

			const event: BusinessExecutionEvent = { type: 'execution_retry_requested' };
			await transaction.insert(agentBusinessExecutionEvent).values({
				id: this.generateId(),
				businessExecutionId: current.id,
				conversationId: current.conversationId,
				ownerEmployeeId: principal.employeeId,
				type: event.type,
				payload: {
					type: event.type,
					previousStatus: currentState.status,
					nextStatus: nextState.status,
					version: nextVersion
				},
				createdAt: now
			});

			const message: typeof agentMessage.$inferInsert = {
				id: this.generateId(),
				conversationId: current.conversationId,
				businessExecutionId: current.id,
				role: 'user',
				content: '重新尝试上次请求',
				ui: null,
				createdAt: now
			};
			const runId = this.generateId();
			await transaction.insert(agentMessage).values(message);
			await transaction.insert(agentRun).values({
				id: runId,
				conversationId: current.conversationId,
				ownerEmployeeId: principal.employeeId,
				clientRequestId: input.clientRequestId,
				userMessageId: message.id,
				businessExecutionId: current.id,
				retryOfRunId: failedRun.id,
				status: 'running',
				createdAt: now
			});
			await transaction
				.update(agentConversation)
				.set({ updatedAt: now })
				.where(eq(agentConversation.id, current.conversationId));
			return {
				response: {
					runId,
					businessExecutionId: current.id,
					userMessage: toMessage(message)
				},
				created: true
			};
		});
	}

	async getRunContext(principal: AgentPrincipal, runId: string) {
		const rows = await this.database
			.select({ run: agentRun, conversation: agentConversation })
			.from(agentRun)
			.innerJoin(agentConversation, eq(agentRun.conversationId, agentConversation.id))
			.where(and(eq(agentRun.id, runId), eq(agentRun.ownerEmployeeId, principal.employeeId)))
			.limit(1);
		if (!rows[0]) throw new AgentAccessDeniedError('Agent run was not found');
		return rows[0];
	}

	async getBusinessExecution(
		principal: AgentPrincipal,
		businessExecutionId: string
	): Promise<
		Readonly<{
			summary: AgentBusinessExecutionSummary;
			state: BusinessExecutionState;
			version: number;
		}>
	> {
		const rows = await this.database
			.select()
			.from(agentBusinessExecution)
			.where(
				and(
					eq(agentBusinessExecution.id, businessExecutionId),
					eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId)
				)
			)
			.limit(1);
		const row = rows[0];
		if (!row) throw new AgentAccessDeniedError('Agent business execution was not found');
		return {
			summary: toBusinessExecutionSummary(row),
			state: businessExecutionStateSchema.parse(row.state),
			version: row.version
		};
	}

	async transitionBusinessExecution(
		principal: AgentPrincipal,
		businessExecutionId: string,
		expectedVersion: number,
		event: BusinessExecutionEvent
	): Promise<
		Readonly<{
			summary: AgentBusinessExecutionSummary;
			state: BusinessExecutionState;
			version: number;
		}>
	> {
		return this.database.transaction(async (transaction) => {
			const rows = await transaction
				.select()
				.from(agentBusinessExecution)
				.where(
					and(
						eq(agentBusinessExecution.id, businessExecutionId),
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId)
					)
				)
				.limit(1);
			const current = rows[0];
			if (!current) throw new AgentAccessDeniedError('Agent business execution was not found');
			if (current.version !== expectedVersion) {
				throw new StaleBusinessExecutionVersionError(expectedVersion, current.version);
			}
			const currentState = businessExecutionStateSchema.parse(current.state);
			const nextState = transitionBusinessExecution(currentState, event);
			const nextVersion = expectedVersion + 1;
			const now = this.now();
			const route = executionRoute(nextState, current.routeKind, current.intent);
			const terminal = isTerminalBusinessExecutionStatus(nextState.status);
			const updated = await transaction
				.update(agentBusinessExecution)
				.set({
					routeKind: route.routeKind,
					intent: route.intent,
					status: nextState.status,
					state: nextState,
					version: nextVersion,
					expiresAt:
						nextState.status === 'awaiting_clarification'
							? new Date(nextState.clarification.expiresAt)
							: null,
					updatedAt: now,
					completedAt: terminal ? now : null
				})
				.where(
					and(
						eq(agentBusinessExecution.id, businessExecutionId),
						eq(agentBusinessExecution.ownerEmployeeId, principal.employeeId),
						eq(agentBusinessExecution.version, expectedVersion)
					)
				)
				.returning();
			const saved = updated[0];
			if (!saved) throw new StaleBusinessExecutionVersionError(expectedVersion, nextVersion);
			await transaction.insert(agentBusinessExecutionEvent).values({
				id: this.generateId(),
				businessExecutionId,
				conversationId: current.conversationId,
				ownerEmployeeId: principal.employeeId,
				type: event.type,
				payload: {
					type: event.type,
					previousStatus: currentState.status,
					nextStatus: nextState.status,
					version: nextVersion
				},
				createdAt: now
			});
			return {
				summary: toBusinessExecutionSummary(saved),
				state: nextState,
				version: nextVersion
			};
		});
	}

	async finalizeRunSuccess(
		runId: string,
		conversationId: string,
		content: string,
		ui: GenerativeUiSpec | null
	): Promise<AgentMessage | null> {
		const now = this.now();
		const message: typeof agentMessage.$inferInsert = {
			id: this.generateId(),
			conversationId,
			businessExecutionId: null,
			role: 'assistant',
			content,
			ui,
			createdAt: now
		};
		return this.database.transaction(async (transaction) => {
			const completed = await transaction
				.update(agentRun)
				.set({ status: 'completed', completedAt: now })
				.where(and(eq(agentRun.id, runId), eq(agentRun.status, 'running')))
				.returning({ id: agentRun.id, businessExecutionId: agentRun.businessExecutionId });
			if (completed.length === 0) return null;
			message.businessExecutionId = completed[0]?.businessExecutionId ?? null;
			await transaction.insert(agentMessage).values(message);
			await transaction
				.update(agentConversation)
				.set({ updatedAt: now })
				.where(eq(agentConversation.id, conversationId));
			return toMessage(message);
		});
	}

	async appendEvent(event: AgentRunEvent, principal: AgentPrincipal): Promise<void> {
		await this.database.insert(agentRunEvent).values({
			id: event.id,
			runId: event.runId,
			conversationId: event.conversationId,
			ownerEmployeeId: principal.employeeId,
			type: event.type,
			payload: event,
			createdAt: new Date(event.createdAt)
		});
	}

	async listEvents(
		principal: AgentPrincipal,
		runId: string,
		lastEventId?: string | null
	): Promise<readonly AgentRunEvent[]> {
		await this.getRunContext(principal, runId);
		let afterSequence: number | null = null;
		if (lastEventId) {
			const cursors = await this.database
				.select({ sequence: agentRunEvent.sequence })
				.from(agentRunEvent)
				.where(
					and(
						eq(agentRunEvent.id, lastEventId),
						eq(agentRunEvent.runId, runId),
						eq(agentRunEvent.ownerEmployeeId, principal.employeeId)
					)
				)
				.limit(1);
			afterSequence = cursors[0]?.sequence ?? null;
		}
		const conditions = [
			eq(agentRunEvent.runId, runId),
			eq(agentRunEvent.ownerEmployeeId, principal.employeeId)
		];
		if (afterSequence !== null) conditions.push(gt(agentRunEvent.sequence, afterSequence));
		const rows = await this.database
			.select({ payload: agentRunEvent.payload })
			.from(agentRunEvent)
			.where(and(...conditions))
			.orderBy(asc(agentRunEvent.sequence));
		return rows.map((row) => row.payload);
	}

	async completeRun(
		runId: string,
		status: 'failed' | 'cancelled',
		failure: Readonly<{ reasonCode: string; retryable: boolean }> = {
			reasonCode: 'run_failed',
			retryable: true
		}
	): Promise<boolean> {
		return this.database.transaction(async (transaction) => {
			const now = this.now();
			const completed = await transaction
				.update(agentRun)
				.set({ status, completedAt: now })
				.where(and(eq(agentRun.id, runId), eq(agentRun.status, 'running')))
				.returning({ id: agentRun.id, businessExecutionId: agentRun.businessExecutionId });
			const executionId = completed[0]?.businessExecutionId;
			if (executionId) {
				const rows = await transaction
					.select()
					.from(agentBusinessExecution)
					.where(eq(agentBusinessExecution.id, executionId))
					.limit(1);
				const current = rows[0];
				if (current && !isTerminalBusinessExecutionStatus(current.status)) {
					const previous = businessExecutionStateSchema.parse(current.state);
					const next = transitionBusinessExecution(
						previous,
						status === 'cancelled'
							? { type: 'execution_cancelled' }
							: { type: 'execution_failed', ...failure }
					);
					await transaction
						.update(agentBusinessExecution)
						.set({
							status: next.status,
							state: next,
							version: current.version + 1,
							updatedAt: now,
							completedAt: now,
							expiresAt: null
						})
						.where(eq(agentBusinessExecution.id, executionId));
					await transaction.insert(agentBusinessExecutionEvent).values({
						id: this.generateId(),
						businessExecutionId: current.id,
						conversationId: current.conversationId,
						ownerEmployeeId: current.ownerEmployeeId,
						type: status === 'cancelled' ? 'execution_cancelled' : 'execution_failed',
						payload: {
							type: status === 'cancelled' ? 'execution_cancelled' : 'execution_failed',
							previousStatus: previous.status,
							nextStatus: next.status,
							version: current.version + 1
						},
						createdAt: now
					});
				}
			}
			return completed.length === 1;
		});
	}

	async cancelRun(
		principal: AgentPrincipal,
		runId: string
	): Promise<
		Readonly<{
			runId: string;
			conversationId: string;
			status: 'completed' | 'failed' | 'cancelled';
			transitioned: boolean;
		}>
	> {
		const cancelled = await this.database.transaction(async (transaction) => {
			const now = this.now();
			const runs = await transaction
				.update(agentRun)
				.set({ status: 'cancelled', completedAt: now })
				.where(
					and(
						eq(agentRun.id, runId),
						eq(agentRun.ownerEmployeeId, principal.employeeId),
						eq(agentRun.status, 'running')
					)
				)
				.returning({
					runId: agentRun.id,
					conversationId: agentRun.conversationId,
					businessExecutionId: agentRun.businessExecutionId
				});
			const run = runs[0];
			if (!run?.businessExecutionId) return runs;
			const rows = await transaction
				.select()
				.from(agentBusinessExecution)
				.where(eq(agentBusinessExecution.id, run.businessExecutionId))
				.limit(1);
			const current = rows[0];
			if (current && !isTerminalBusinessExecutionStatus(current.status)) {
				const previous = businessExecutionStateSchema.parse(current.state);
				const next = transitionBusinessExecution(previous, { type: 'execution_cancelled' });
				await transaction
					.update(agentBusinessExecution)
					.set({
						status: next.status,
						state: next,
						version: current.version + 1,
						updatedAt: now,
						completedAt: now,
						expiresAt: null
					})
					.where(eq(agentBusinessExecution.id, run.businessExecutionId));
				await transaction.insert(agentBusinessExecutionEvent).values({
					id: this.generateId(),
					businessExecutionId: current.id,
					conversationId: current.conversationId,
					ownerEmployeeId: current.ownerEmployeeId,
					type: 'execution_cancelled',
					payload: {
						type: 'execution_cancelled',
						previousStatus: previous.status,
						nextStatus: next.status,
						version: current.version + 1
					},
					createdAt: now
				});
			}
			return runs;
		});
		if (cancelled[0]) return { ...cancelled[0], status: 'cancelled', transitioned: true };

		const rows = await this.database
			.select({
				runId: agentRun.id,
				conversationId: agentRun.conversationId,
				status: agentRun.status
			})
			.from(agentRun)
			.where(and(eq(agentRun.id, runId), eq(agentRun.ownerEmployeeId, principal.employeeId)))
			.limit(1);
		const existing = rows[0];
		if (!existing) throw new AgentAccessDeniedError('Agent run was not found');
		if (existing.status === 'running') {
			throw new Error('Agent run cancellation did not reach a terminal state');
		}
		return { ...existing, status: existing.status, transitioned: false };
	}

	async listMemories(principal: AgentPrincipal, limit = 20): Promise<readonly AgentMemoryRecord[]> {
		return this.database
			.select({
				key: agentMemory.key,
				content: agentMemory.content,
				importance: agentMemory.importance
			})
			.from(agentMemory)
			.where(eq(agentMemory.ownerEmployeeId, principal.employeeId))
			.orderBy(desc(agentMemory.importance), desc(agentMemory.updatedAt))
			.limit(limit);
	}

	async remember(principal: AgentPrincipal, memory: AgentMemoryRecord): Promise<void> {
		const now = this.now();
		await this.database
			.insert(agentMemory)
			.values({
				id: this.generateId(),
				ownerEmployeeId: principal.employeeId,
				ownerOrgId: principal.orgId,
				key: memory.key,
				content: memory.content,
				importance: memory.importance,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: [agentMemory.ownerEmployeeId, agentMemory.key],
				set: { content: memory.content, importance: memory.importance, updatedAt: now }
			});
	}
}
