import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';

type AgentEventPayload = Readonly<{
	type: string;
	toolName?: string;
	message?: string;
}>;

function eventType(event: AgentEventPayload | null): string | null {
	return event?.type ?? null;
}

const conversationResponseSchema = z.object({
	result: z.object({ data: z.object({ id: z.string().uuid() }) })
});
const runResponseSchema = z.object({
	result: z.object({ data: z.object({ runId: z.string().uuid() }) })
});
const conversationMessagesResponseSchema = z.object({
	result: z.object({
		data: z.object({
			messages: z.array(z.object({ role: z.string(), content: z.string() })),
			activeBusinessExecution: z
				.object({
					id: z.string().uuid(),
					pendingClarification: z.object({
						interactionId: z.string().uuid(),
						version: z.number().int(),
						fields: z.array(z.object({ slot: z.string() }))
					})
				})
				.nullable()
		})
	})
});

test('completes the 7-day trend quick action after rendering its validated UI', async ({
	request
}) => {
	test.setTimeout(180_000);
	expect(
		process.env.AI_KIMI_API_KEY,
		'AI_KIMI_API_KEY is required for the real Agent E2E'
	).toBeTruthy();
	expect(
		process.env.AI_DMS_MCP_BEARER_TOKEN,
		'AI_DMS_MCP_BEARER_TOKEN is required for the real Agent E2E'
	).toBeTruthy();

	const databaseUrl = process.env.DATABASE_URL;
	expect(databaseUrl, 'DATABASE_URL is required for the Agent E2E').toBeTruthy();
	if (!databaseUrl) throw new Error('DATABASE_URL is required for the Agent E2E');
	const database = postgres(databaseUrl, { max: 1 });

	try {
		const login = await request.post('/api/trpc/auth.loginWithPhoneCode', {
			data: { phone: '13800138000', code: '654321' }
		});
		expect(login.status()).toBe(200);

		const created = await request.post('/api/trpc/agent.createConversation', {
			data: { title: '7 日经营趋势 E2E' }
		});
		expect(created.status()).toBe(200);
		const conversation = conversationResponseSchema.parse(await created.json()).result.data;

		const started = await request.post('/api/trpc/agent.startRun', {
			data: {
				conversationId: conversation.id,
				clientRequestId: randomUUID(),
				quickActionId: 'last_7_days_operating_trend'
			}
		});
		expect(started.status()).toBe(200);
		const run = runResponseSchema.parse(await started.json()).result.data;

		let terminalEvent: AgentEventPayload | null = null;
		await expect
			.poll(
				async () => {
					const rows = await database<{ payload: AgentEventPayload }[]>`
						SELECT payload
						FROM agent_run_event
						WHERE run_id = ${run.runId}
						  AND type IN ('run_completed', 'run_failed')
						ORDER BY sequence DESC
						LIMIT 1
					`;
					terminalEvent = rows[0]?.payload ?? null;
					return terminalEvent?.type ?? null;
				},
				{ intervals: [1_000, 2_000, 5_000], timeout: 150_000 }
			)
			.toMatch(/run_completed|run_failed/);

		expect(terminalEvent, `Agent terminal event: ${JSON.stringify(terminalEvent)}`).toMatchObject({
			type: 'run_completed'
		});

		let dataRunId = run.runId;
		let loaded = await request.get(
			`/api/trpc/agent.getConversation?input=${encodeURIComponent(
				JSON.stringify({ conversationId: conversation.id })
			)}`
		);
		expect(loaded.status()).toBe(200);
		let conversationState = conversationMessagesResponseSchema.parse(await loaded.json()).result
			.data;
		const clarification = conversationState.activeBusinessExecution?.pendingClarification;
		if (clarification) {
			const answers = Object.fromEntries(
				clarification.fields.map((field) => [
					field.slot,
					field.slot === 'hotelReference'
						? '银际酒店（包头青山文化路王府井店）'
						: field.slot === 'dateRange'
							? { start: '2026-07-01', end: '2026-07-31' }
							: 'GMV'
				])
			);
			const resumed = await request.post('/api/trpc/agent.submitClarification', {
				data: {
					businessExecutionId: conversationState.activeBusinessExecution?.id,
					interactionId: clarification.interactionId,
					expectedVersion: clarification.version,
					clientRequestId: randomUUID(),
					answers
				}
			});
			expect(resumed.status()).toBe(200);
			dataRunId = runResponseSchema.parse(await resumed.json()).result.data.runId;
			await expect
				.poll(
					async () => {
						const rows = await database<{ payload: AgentEventPayload }[]>`
							SELECT payload FROM agent_run_event
							WHERE run_id = ${dataRunId} AND type IN ('run_completed', 'run_failed')
							ORDER BY sequence DESC LIMIT 1
						`;
						terminalEvent = rows[0]?.payload ?? null;
						return terminalEvent?.type ?? null;
					},
					{ intervals: [1_000, 2_000, 5_000], timeout: 150_000 }
				)
				.toMatch(/run_completed|run_failed/);
			expect(eventType(terminalEvent)).toMatch(/run_completed|run_failed/);
		}

		const eventRows = await database<{ payload: AgentEventPayload }[]>`
			SELECT payload
			FROM agent_run_event
			WHERE run_id = ${dataRunId}
			ORDER BY sequence
		`;
		const startedToolNames = eventRows
			.map((row) => row.payload)
			.filter((event) => event.type === 'tool_started')
			.map((event) => event.toolName);
		const completedToolNames = eventRows
			.map((row) => row.payload)
			.filter((event) => event.type === 'tool_completed')
			.map((event) => event.toolName);
		expect(startedToolNames).toContain('query_hotel_operating_data_sql');
		expect(completedToolNames).toContain('query_hotel_operating_data_sql');
		expect(startedToolNames).toContain('render_hotel_ui');
		expect(completedToolNames).toContain('render_hotel_ui');
		expect(startedToolNames).toContain('upstream_llm_analysis');
		expect(eventRows.map((row) => row.payload.type)).toContain('ui_spec');

		loaded = await request.get(
			`/api/trpc/agent.getConversation?input=${encodeURIComponent(
				JSON.stringify({ conversationId: conversation.id })
			)}`
		);
		expect(loaded.status()).toBe(200);
		conversationState = conversationMessagesResponseSchema.parse(await loaded.json()).result.data;
		if (eventType(terminalEvent) === 'run_completed') {
			const messages = conversationState.messages;
			const assistant = messages.findLast((message) => message.role === 'assistant');
			expect(assistant?.content).toMatch(/成交金额合计.+核销金额/);
			expect(assistant?.content).toContain('数据来源：RMS 经营数据');
			expect(assistant?.content).not.toContain('暂时无法');
		} else {
			expect(terminalEvent).toMatchObject({ type: 'run_failed', retryable: true });
		}
	} finally {
		await database.end();
	}
});

test('completes a latest hotel orders query through the real DMS MCP', async ({ request }) => {
	test.setTimeout(180_000);
	expect(
		process.env.AI_KIMI_API_KEY,
		'AI_KIMI_API_KEY is required for the real Agent E2E'
	).toBeTruthy();
	expect(
		process.env.AI_DMS_MCP_BEARER_TOKEN,
		'AI_DMS_MCP_BEARER_TOKEN is required for the real Agent E2E'
	).toBeTruthy();

	const databaseUrl = process.env.DATABASE_URL;
	expect(databaseUrl, 'DATABASE_URL is required for the Agent E2E').toBeTruthy();
	if (!databaseUrl) throw new Error('DATABASE_URL is required for the Agent E2E');
	const database = postgres(databaseUrl, { max: 1 });

	try {
		const login = await request.post('/api/trpc/auth.loginWithPhoneCode', {
			data: { phone: '13800138000', code: '654321' }
		});
		expect(login.status()).toBe(200);

		const created = await request.post('/api/trpc/agent.createConversation', {
			data: { title: '最新订单 E2E' }
		});
		expect(created.status()).toBe(200);
		const conversation = conversationResponseSchema.parse(await created.json()).result.data;

		const started = await request.post('/api/trpc/agent.startRun', {
			data: {
				conversationId: conversation.id,
				clientRequestId: randomUUID(),
				prompt: '查询银际酒店（包头青山文化路王府井店）的最新订单'
			}
		});
		expect(started.status()).toBe(200);
		const run = runResponseSchema.parse(await started.json()).result.data;

		let terminalEvent: AgentEventPayload | null = null;
		await expect
			.poll(
				async () => {
					const rows = await database<{ payload: AgentEventPayload }[]>`
						SELECT payload FROM agent_run_event
						WHERE run_id = ${run.runId} AND type IN ('run_completed', 'run_failed')
						ORDER BY sequence DESC LIMIT 1
					`;
					terminalEvent = rows[0]?.payload ?? null;
					return terminalEvent?.type ?? null;
				},
				{ intervals: [1_000, 2_000, 5_000], timeout: 150_000 }
			)
			.toMatch(/run_completed|run_failed/);

		expect(terminalEvent, `Agent terminal event: ${JSON.stringify(terminalEvent)}`).toMatchObject({
			type: 'run_completed'
		});
		const eventRows = await database<{ payload: AgentEventPayload }[]>`
			SELECT payload FROM agent_run_event WHERE run_id = ${run.runId} ORDER BY sequence
		`;
		const startedToolNames = eventRows
			.map((row) => row.payload)
			.filter((event) => event.type === 'tool_started')
			.map((event) => event.toolName);
		const completedToolNames = eventRows
			.map((row) => row.payload)
			.filter((event) => event.type === 'tool_completed')
			.map((event) => event.toolName);
		expect(startedToolNames).toContain('query_hotel_operating_data_sql');
		expect(completedToolNames).toContain('query_hotel_operating_data_sql');

		const loaded = await request.get(
			`/api/trpc/agent.getConversation?input=${encodeURIComponent(
				JSON.stringify({ conversationId: conversation.id })
			)}`
		);
		expect(loaded.status()).toBe(200);
		const conversationState = conversationMessagesResponseSchema.parse(await loaded.json()).result
			.data;
		const assistant = conversationState.messages.findLast(
			(message) => message.role === 'assistant'
		);
		expect(assistant?.content).not.toContain('暂时没有响应');
	} finally {
		await database.end();
	}
});
