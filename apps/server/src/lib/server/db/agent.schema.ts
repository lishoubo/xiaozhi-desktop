import {
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import type { AgentRunEvent, GenerativeUiSpec } from '@hotel-butler/api';

export const agentConversation = pgTable(
	'agent_conversation',
	{
		id: text('id').primaryKey(),
		ownerEmployeeId: text('owner_employee_id').notNull(),
		ownerOrgId: text('owner_org_id').notNull(),
		title: text('title').notNull(),
		contextSummary: text('context_summary'),
		summarizedThroughMessageId: text('summarized_through_message_id'),
		summaryUpdatedAt: timestamp('summary_updated_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('agentConversation_owner_updated_idx').on(table.ownerEmployeeId, table.updatedAt)
	]
);

export const agentMessage = pgTable(
	'agent_message',
	{
		id: text('id').primaryKey(),
		conversationId: text('conversation_id')
			.notNull()
			.references(() => agentConversation.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['user', 'assistant'] }).notNull(),
		content: text('content').notNull(),
		ui: jsonb('ui').$type<GenerativeUiSpec | null>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('agentMessage_conversation_created_idx').on(table.conversationId, table.createdAt)
	]
);

export const agentRun = pgTable(
	'agent_run',
	{
		id: text('id').primaryKey(),
		conversationId: text('conversation_id')
			.notNull()
			.references(() => agentConversation.id, { onDelete: 'cascade' }),
		ownerEmployeeId: text('owner_employee_id').notNull(),
		clientRequestId: text('client_request_id').notNull(),
		userMessageId: text('user_message_id')
			.notNull()
			.references(() => agentMessage.id, { onDelete: 'cascade' }),
		status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('agentRun_owner_clientRequest_uidx').on(
			table.ownerEmployeeId,
			table.clientRequestId
		),
		index('agentRun_conversation_created_idx').on(table.conversationId, table.createdAt)
	]
);

export const agentRunEvent = pgTable(
	'agent_run_event',
	{
		sequence: serial('sequence').primaryKey(),
		id: text('id').notNull().unique(),
		runId: text('run_id')
			.notNull()
			.references(() => agentRun.id, { onDelete: 'cascade' }),
		conversationId: text('conversation_id')
			.notNull()
			.references(() => agentConversation.id, { onDelete: 'cascade' }),
		ownerEmployeeId: text('owner_employee_id').notNull(),
		type: text('type').notNull(),
		payload: jsonb('payload').$type<AgentRunEvent>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(table) => [index('agentRunEvent_run_sequence_idx').on(table.runId, table.sequence)]
);

export const agentMemory = pgTable(
	'agent_memory',
	{
		id: text('id').primaryKey(),
		ownerEmployeeId: text('owner_employee_id').notNull(),
		ownerOrgId: text('owner_org_id').notNull(),
		key: text('key').notNull(),
		content: text('content').notNull(),
		importance: integer('importance').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
	},
	(table) => [
		uniqueIndex('agentMemory_owner_key_uidx').on(table.ownerEmployeeId, table.key),
		index('agentMemory_owner_updated_idx').on(table.ownerEmployeeId, table.updatedAt)
	]
);
