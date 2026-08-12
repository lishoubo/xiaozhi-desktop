import type {
	AgentConversation,
	AgentConversationSummary,
	AgentMessage,
	AgentPrincipal,
	AgentRunEvent,
	GenerativeUiSpec,
	StartAgentRunResponse
} from '@hotel-butler/api';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import {
	agentConversation,
	agentMemory,
	agentMessage,
	agentRun,
	agentRunEvent
} from '$lib/server/db/agent.schema';
import type { StoredConversationContext } from './conversation-context';
import { buildActiveRunDraft, buildAgentExecutionTraces } from './agent-execution-trace';

const toIso = (value: Date): string => value.toISOString();

const toConversationSummary = (
	row: Pick<typeof agentConversation.$inferSelect, 'id' | 'title' | 'createdAt' | 'updatedAt'>,
	activeRunId: string | null = null
): AgentConversationSummary => ({
	id: row.id,
	title: row.title,
	activeRunId,
	createdAt: toIso(row.createdAt),
	updatedAt: toIso(row.updatedAt)
});

const toMessage = (
	row: Omit<typeof agentMessage.$inferSelect, 'ui'> & { ui?: GenerativeUiSpec | null }
): AgentMessage => ({
	id: row.id,
	conversationId: row.conversationId,
	role: row.role,
	content: row.content,
	ui: row.ui ?? null,
	createdAt: toIso(row.createdAt)
});

export class AgentAccessDeniedError extends Error {}

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
		const [rows, runningRuns] = await Promise.all([
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
				.orderBy(desc(agentRun.createdAt))
		]);
		const activeRunByConversation = new Map<string, string>();
		for (const run of runningRuns) {
			if (!activeRunByConversation.has(run.conversationId)) {
				activeRunByConversation.set(run.conversationId, run.id);
			}
		}
		return rows.map((row) =>
			toConversationSummary(row, activeRunByConversation.get(row.id) ?? null)
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
		const [runs, events] = await Promise.all([
			this.database
				.select({
					id: agentRun.id,
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
				.orderBy(asc(agentRunEvent.sequence))
		]);
		const activeRun = [...runs].reverse().find((run) => run.status === 'running') ?? null;
		const payloads = events.map((event) => event.payload);
		return {
			conversation: toConversationSummary(conversation, activeRun?.id ?? null),
			messages: messages.map(toMessage),
			executions: buildAgentExecutionTraces(runs, payloads),
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
		input: Readonly<{ conversationId: string; prompt: string; clientRequestId: string }>
	): Promise<Readonly<{ response: StartAgentRunResponse; created: boolean }>> {
		return this.database.transaction(async (transaction) => {
			const existing = await transaction
				.select({ runId: agentRun.id, userMessage: agentMessage })
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
				return {
					response: { runId: existing[0].runId, userMessage: toMessage(existing[0].userMessage) },
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

			const now = this.now();
			const message: typeof agentMessage.$inferInsert = {
				id: this.generateId(),
				conversationId: input.conversationId,
				role: 'user',
				content: input.prompt,
				ui: null,
				createdAt: now
			};
			const runId = this.generateId();
			await transaction.insert(agentMessage).values(message);
			await transaction.insert(agentRun).values({
				id: runId,
				conversationId: input.conversationId,
				ownerEmployeeId: principal.employeeId,
				clientRequestId: input.clientRequestId,
				userMessageId: message.id,
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
			return { response: { runId, userMessage: toMessage(message) }, created: true };
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
				.returning({ id: agentRun.id });
			if (completed.length === 0) return null;
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

	async completeRun(runId: string, status: 'failed' | 'cancelled'): Promise<boolean> {
		const completed = await this.database
			.update(agentRun)
			.set({ status, completedAt: this.now() })
			.where(and(eq(agentRun.id, runId), eq(agentRun.status, 'running')))
			.returning({ id: agentRun.id });
		return completed.length === 1;
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
		const cancelled = await this.database
			.update(agentRun)
			.set({ status: 'cancelled', completedAt: this.now() })
			.where(
				and(
					eq(agentRun.id, runId),
					eq(agentRun.ownerEmployeeId, principal.employeeId),
					eq(agentRun.status, 'running')
				)
			)
			.returning({ runId: agentRun.id, conversationId: agentRun.conversationId });
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
