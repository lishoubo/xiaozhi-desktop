import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import postgres, { type Sql } from 'postgres';
import { z } from 'zod';

type AgentEventPayload = Readonly<{
	type: string;
	toolName?: string;
	message?: string;
}>;

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
			activeBusinessExecution: z.unknown().nullable()
		})
	})
});

async function startPrompt(
	request: APIRequestContext,
	conversationId: string,
	prompt: string
): Promise<string> {
	const started = await request.post('/api/trpc/agent.startRun', {
		data: { conversationId, clientRequestId: randomUUID(), prompt }
	});
	expect(started.status(), await started.text()).toBe(200);
	return runResponseSchema.parse(await started.json()).result.data.runId;
}

async function waitForTerminal(database: Sql, runId: string): Promise<AgentEventPayload> {
	let terminalEvent: AgentEventPayload | null = null;
	await expect
		.poll(
			async () => {
				const rows = await database<{ payload: AgentEventPayload }[]>`
					SELECT payload
					FROM agent_run_event
					WHERE run_id = ${runId}
					  AND type IN ('run_completed', 'run_failed')
					ORDER BY sequence DESC
					LIMIT 1
				`;
				terminalEvent = rows[0]?.payload ?? null;
				return terminalEvent?.type ?? null;
			},
			{ intervals: [1_000, 2_000, 5_000], timeout: 180_000 }
		)
		.toMatch(/run_completed|run_failed/);
	if (!terminalEvent) throw new Error(`Run ${runId} reached no terminal event`);
	return terminalEvent;
}

async function runEvents(database: Sql, runId: string): Promise<readonly AgentEventPayload[]> {
	const rows = await database<{ payload: AgentEventPayload }[]>`
		SELECT payload FROM agent_run_event WHERE run_id = ${runId} ORDER BY sequence
	`;
	return rows.map((row) => row.payload);
}

async function latestAssistantMessage(
	request: APIRequestContext,
	conversationId: string
): Promise<Readonly<{ content: string; activeBusinessExecution: unknown | null }>> {
	const loaded = await request.get(
		`/api/trpc/agent.getConversation?input=${encodeURIComponent(
			JSON.stringify({ conversationId })
		)}`
	);
	expect(loaded.status(), await loaded.text()).toBe(200);
	const conversation = conversationMessagesResponseSchema.parse(await loaded.json()).result.data;
	const assistant = conversation.messages.findLast((message) => message.role === 'assistant');
	if (!assistant) throw new Error('Conversation has no assistant response');
	return {
		content: assistant.content,
		activeBusinessExecution: conversation.activeBusinessExecution
	};
}

test('handles a natural multi-turn operating-to-traffic conversation without losing scope', async ({
	request
}) => {
	test.setTimeout(420_000);
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
			data: { title: '酒店运营自然多轮 E2E' }
		});
		expect(created.status()).toBe(200);
		const conversationId = conversationResponseSchema.parse(await created.json()).result.data.id;

		const operatingRunId = await startPrompt(
			request,
			conversationId,
			'我马上开晨会。先帮我看看银际酒店(包头青山王府井文化路店)最近 7 个完整自然日生意怎么样，成交、核销和退款哪里不对就直说。'
		);
		expect(await waitForTerminal(database, operatingRunId)).toMatchObject({
			type: 'run_completed'
		});
		const operatingReply = await latestAssistantMessage(request, conversationId);
		expect(operatingReply.activeBusinessExecution).toBeNull();
		expect(operatingReply.content).not.toContain('查询结果未返回可验证的酒店范围');
		expect(operatingReply.content).not.toContain('查询结果未返回可验证的业务日期范围');

		const trafficRunId = await startPrompt(
			request,
			conversationId,
			'那流量呢？还是刚才那几天。别只甩一堆数，帮我看看从曝光、访问到支付到底掉在哪。'
		);
		expect(await waitForTerminal(database, trafficRunId)).toMatchObject({ type: 'run_completed' });
		const trafficEvents = await runEvents(database, trafficRunId);
		const trafficQueries = trafficEvents.filter(
			(event) =>
				event.type === 'tool_started' && event.toolName === 'query_hotel_operating_data_sql'
		);
		expect(trafficQueries.length).toBeGreaterThan(0);
		expect(trafficQueries.length).toBeLessThanOrEqual(16);
		const [trafficExecution] = await database<
			{ route_kind: string; intent: string | null; status: string }[]
		>`
			SELECT execution.route_kind, execution.intent, execution.status
			FROM agent_run run
			JOIN agent_business_execution execution ON execution.id = run.business_execution_id
			WHERE run.id = ${trafficRunId}
		`;
		expect(trafficExecution).toMatchObject({
			route_kind: 'business_read',
			intent: 'generic_hotel_data_query',
			status: 'completed'
		});
		const trafficReply = await latestAssistantMessage(request, conversationId);
		expect(trafficReply.activeBusinessExecution).toBeNull();
		expect(trafficReply.content).not.toContain('本次查询没有获得足够的可验证数据');
		expect(trafficReply.content).not.toContain('查询结果未返回可验证的酒店范围');
		expect(trafficReply.content).not.toContain('查询结果未返回可验证的业务日期范围');

		const adviceRunId = await startPrompt(
			request,
			conversationId,
			'行，别再查了，就按刚才查到的给我三个今天能落地的动作，短一点。'
		);
		expect(await waitForTerminal(database, adviceRunId)).toMatchObject({ type: 'run_completed' });
		const adviceEvents = await runEvents(database, adviceRunId);
		expect(
			adviceEvents.filter(
				(event) =>
					event.type === 'tool_started' && event.toolName === 'query_hotel_operating_data_sql'
			)
		).toHaveLength(0);
		const [adviceExecution] = await database<
			{ route_kind: string; intent: string | null; status: string }[]
		>`
			SELECT execution.route_kind, execution.intent, execution.status
			FROM agent_run run
			JOIN agent_business_execution execution ON execution.id = run.business_execution_id
			WHERE run.id = ${adviceRunId}
		`;
		expect(adviceExecution?.route_kind).not.toBe('business_read');
		expect(adviceExecution?.route_kind).not.toBe('business_write');
		expect(adviceExecution?.status).toBe('completed');
		const adviceReply = await latestAssistantMessage(request, conversationId);
		expect(adviceReply.content.length).toBeGreaterThan(0);
	} finally {
		await database.end();
	}
});
