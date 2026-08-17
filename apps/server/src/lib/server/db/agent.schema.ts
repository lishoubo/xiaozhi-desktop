import {
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { AgentRunEvent, GenerativeUiSpec } from '@hotel-butler/api';
import type {
	BusinessExecutionState,
	PersistedBusinessExecutionEvent
} from '$lib/server/agent/execution/business-execution-state';

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
		businessExecutionId: text('business_execution_id').references(
			(): AnyPgColumn => agentBusinessExecution.id,
			{ onDelete: 'set null' }
		),
		role: text('role', { enum: ['user', 'assistant'] }).notNull(),
		content: text('content').notNull(),
		ui: jsonb('ui').$type<GenerativeUiSpec | null>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('agentMessage_conversation_created_idx').on(table.conversationId, table.createdAt)
	]
);

export const agentBusinessExecution = pgTable(
	'agent_business_execution',
	{
		id: text('id').primaryKey(),
		conversationId: text('conversation_id')
			.notNull()
			.references(() => agentConversation.id, { onDelete: 'cascade' }),
		triggerUserMessageId: text('trigger_user_message_id')
			.notNull()
			.references(() => agentMessage.id, { onDelete: 'cascade' }),
		ownerEmployeeId: text('owner_employee_id').notNull(),
		ownerOrgId: text('owner_org_id').notNull(),
		routeKind: text('route_kind', {
			enum: [
				'general_conversation',
				'hotel_knowledge',
				'business_read',
				'business_write',
				'unclear'
			]
		}).notNull(),
		intent: text('intent', {
			enum: [
				'weather_operations_advice',
				'hotel_operating_summary',
				'public_hotel_rates',
				'generic_hotel_data_query'
			]
		}),
		status: text('status', {
			enum: [
				'routing',
				'resolving_slots',
				'awaiting_clarification',
				'ready',
				'executing',
				'validating_evidence',
				'answering',
				'completed',
				'failed',
				'cancelled'
			]
		}).notNull(),
		state: jsonb('state').$type<BusinessExecutionState>().notNull(),
		version: integer('version').notNull().default(1),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('agentBusinessExecution_conversation_active_uidx')
			.on(table.conversationId)
			.where(sql`${table.status} not in ('completed', 'failed', 'cancelled')`),
		index('agentBusinessExecution_owner_updated_idx').on(table.ownerEmployeeId, table.updatedAt)
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
		businessExecutionId: text('business_execution_id').references(() => agentBusinessExecution.id, {
			onDelete: 'set null'
		}),
		retryOfRunId: text('retry_of_run_id').references((): AnyPgColumn => agentRun.id, {
			onDelete: 'set null'
		}),
		status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true })
	},
	(table) => [
		uniqueIndex('agentRun_owner_clientRequest_uidx').on(
			table.ownerEmployeeId,
			table.clientRequestId
		),
		index('agentRun_conversation_created_idx').on(table.conversationId, table.createdAt),
		index('agentRun_retry_of_idx').on(table.retryOfRunId)
	]
);

export const agentBusinessExecutionEvent = pgTable(
	'agent_business_execution_event',
	{
		sequence: serial('sequence').primaryKey(),
		id: text('id').notNull().unique(),
		businessExecutionId: text('business_execution_id')
			.notNull()
			.references(() => agentBusinessExecution.id, { onDelete: 'cascade' }),
		conversationId: text('conversation_id')
			.notNull()
			.references(() => agentConversation.id, { onDelete: 'cascade' }),
		ownerEmployeeId: text('owner_employee_id').notNull(),
		type: text('type').notNull(),
		payload: jsonb('payload').$type<PersistedBusinessExecutionEvent>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('agentBusinessExecutionEvent_execution_sequence_idx').on(
			table.businessExecutionId,
			table.sequence
		)
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
