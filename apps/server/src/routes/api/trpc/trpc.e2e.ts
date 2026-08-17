import { expect, test } from '@playwright/test';
import mysql, { type ResultSetHeader } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

test('correlates a tRPC request with the response', async ({ request }) => {
	const response = await request.get('/api/trpc/system.health', {
		headers: { 'x-request-id': 'server-e2e-request' }
	});

	expect(new URL(response.url()).protocol).toBe('https:');
	expect(response.status()).toBe(200);
	expect(response.headers()['x-request-id']).toBe('server-e2e-request');
});

test('requests a temporary phone code and logs in an active RMS employee', async ({ request }) => {
	const requestCodeResponse = await request.post('/api/trpc/auth.requestPhoneCode', {
		data: { phone: '13800138000' }
	});

	expect(requestCodeResponse.status()).toBe(200);
	expect((await requestCodeResponse.json()).result.data).toEqual({
		accepted: true,
		expiresInSeconds: 300
	});

	const unauthenticatedLogoutResponse = await request.post('/api/trpc/auth.logout', {
		data: {}
	});
	expect(unauthenticatedLogoutResponse.status()).toBe(401);
	expect((await unauthenticatedLogoutResponse.json()).error.data.code).toBe('UNAUTHORIZED');

	const response = await request.post('/api/trpc/auth.loginWithPhoneCode', {
		data: { phone: '13800138000', code: '654321' }
	});

	expect(response.status()).toBe(200);
	const payload = await response.json();
	expect(payload.result.data).toEqual({
		id: '2',
		orgId: '42',
		username: 'desktop-demo',
		fullName: '桌面体验员工',
		phone: '13800138000',
		roleCode: 'FRONT_DESK'
	});
	expect(JSON.stringify(payload)).not.toContain('password');
	expect(JSON.stringify(payload)).not.toContain('654321');

	const sessionCookie = response.headers()['set-cookie'];
	expect(sessionCookie).toContain('__Host-xiaozhi_desktop_session=');
	expect(sessionCookie).toContain('Path=/');
	expect(sessionCookie).toContain('HttpOnly');
	expect(sessionCookie).toContain('Secure');
	expect(sessionCookie).toContain('SameSite=Strict');
	expect(sessionCookie).toContain('Max-Age=604800');
	expect(sessionCookie).not.toContain('Domain=');

	const currentSessionResponse = await request.get('/api/trpc/auth.currentSession');
	expect(currentSessionResponse.status()).toBe(200);
	expect((await currentSessionResponse.json()).result.data).toEqual(payload.result.data);

	const logoutResponse = await request.post('/api/trpc/auth.logout', { data: {} });
	expect(logoutResponse.status()).toBe(200);
	expect((await logoutResponse.json()).result.data).toEqual({ success: true });
	expect(logoutResponse.headers()['set-cookie']).toContain('Max-Age=0');

	const revokedSessionResponse = await request.get('/api/trpc/auth.currentSession');
	expect(revokedSessionResponse.status()).toBe(200);
	expect((await revokedSessionResponse.json()).result.data).toBeNull();
});

test('persists Agent conversations under the authenticated desktop session', async ({
	request
}) => {
	const unauthenticated = await request.get('/api/trpc/agent.listConversations');
	expect(unauthenticated.status()).toBe(401);

	const login = await request.post('/api/trpc/auth.loginWithPhoneCode', {
		data: { phone: '13800138000', code: '654321' }
	});
	expect(login.status()).toBe(200);

	const capabilities = await request.get('/api/trpc/agent.capabilities');
	expect(capabilities.status()).toBe(200);
	expect((await capabilities.json()).result.data).toMatchObject({
		model: 'kimi-k3',
		generativeUi: true,
		longTermMemory: true,
		skillCount: 0,
		quickActionCount: 5
	});

	const quickActions = await request.get('/api/trpc/agent.quickActions');
	expect(quickActions.status()).toBe(200);
	const actionCatalog = (await quickActions.json()).result.data;
	expect(actionCatalog.map((action: { id: string }) => action.id)).toEqual([
		'yesterday_operating_review',
		'last_7_days_operating_trend',
		'month_to_date_operating_progress',
		'channel_operating_comparison',
		'hotel_operating_data'
	]);
	expect(actionCatalog).not.toContainEqual(expect.objectContaining({ prompt: expect.anything() }));

	const created = await request.post('/api/trpc/agent.createConversation', {
		data: { title: 'E2E Agent 会话' }
	});
	expect(created.status()).toBe(200);
	const conversation = (await created.json()).result.data;

	const loaded = await request.get(
		`/api/trpc/agent.getConversation?input=${encodeURIComponent(JSON.stringify({ conversationId: conversation.id }))}`
	);
	expect(loaded.status()).toBe(200);
	expect((await loaded.json()).result.data).toEqual({
		conversation,
		messages: [],
		executions: [],
		businessExecutions: [],
		activeBusinessExecution: null,
		activeRun: null
	});

	const forgedOwner = await request.get(
		`/api/trpc/agent.getConversation?input=${encodeURIComponent(
			JSON.stringify({ conversationId: conversation.id, ownerEmployeeId: 'another-user' })
		)}`
	);
	expect(forgedOwner.status()).toBe(400);
});

test('creates an owned retry attempt from a persisted execution checkpoint', async ({
	request
}) => {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('DATABASE_URL is required for the Agent retry E2E');
	const sql = postgres(databaseUrl);
	const conversationId = randomUUID();
	const messageId = randomUUID();
	const executionId = randomUUID();
	const failedRunId = randomUUID();
	const clientRequestId = randomUUID();

	try {
		const login = await request.post('/api/trpc/auth.loginWithPhoneCode', {
			data: { phone: '13800138000', code: '654321' }
		});
		expect(login.status()).toBe(200);
		const employeeId = String((await login.json()).result.data.id);
		await sql`
			INSERT INTO agent_conversation
				(id, owner_employee_id, owner_org_id, title, created_at, updated_at)
			VALUES
				(${conversationId}, ${employeeId}, '42', '重试 E2E', NOW(), NOW())
		`;
		await sql`
			INSERT INTO agent_message
				(id, conversation_id, role, content, ui, created_at)
			VALUES
				(${messageId}, ${conversationId}, 'user', '昨日经营复盘', NULL, NOW())
		`;
		const checkpoint = {
			status: 'failed',
			reasonCode: 'mcp_timeout',
			retryable: true,
			retryCheckpoint: {
				kind: 'routing',
				inputKind: 'quick_action',
				inputValue: 'yesterday_operating_review'
			}
		};
		await sql`
			INSERT INTO agent_business_execution
				(id, conversation_id, trigger_user_message_id, owner_employee_id, owner_org_id,
				 route_kind, intent, status, state, version, created_at, updated_at, completed_at)
			VALUES
				(${executionId}, ${conversationId}, ${messageId}, ${employeeId}, '42',
				 'business_read', 'hotel_operating_summary', 'failed', ${sql.json(checkpoint)}, 2,
				 NOW(), NOW(), NOW())
		`;
		await sql`
			UPDATE agent_message SET business_execution_id = ${executionId} WHERE id = ${messageId}
		`;
		await sql`
			INSERT INTO agent_run
				(id, conversation_id, owner_employee_id, client_request_id, user_message_id,
				 business_execution_id, status, created_at, completed_at)
			VALUES
				(${failedRunId}, ${conversationId}, ${employeeId}, ${randomUUID()}, ${messageId},
				 ${executionId}, 'failed', NOW(), NOW())
		`;

		const retried = await request.post('/api/trpc/agent.retryRun', {
			data: { failedRunId, clientRequestId }
		});
		expect(retried.status()).toBe(200);
		const retryRunId = (await retried.json()).result.data.runId as string;
		expect(retryRunId).not.toBe(failedRunId);
		expect(
			await sql`
				SELECT retry_of_run_id, business_execution_id
				FROM agent_run
				WHERE id = ${retryRunId}
			`
		).toEqual([{ retry_of_run_id: failedRunId, business_execution_id: executionId }]);
		expect(await sql`SELECT status FROM agent_run WHERE id = ${failedRunId}`).toEqual([
			{ status: 'failed' }
		]);
		const repeated = await request.post('/api/trpc/agent.retryRun', {
			data: { failedRunId, clientRequestId }
		});
		expect((await repeated.json()).result.data.runId).toBe(retryRunId);
		await request.post('/api/trpc/agent.cancelRun', { data: { runId: retryRunId } });
	} finally {
		await sql`DELETE FROM agent_conversation WHERE id = ${conversationId}`;
		await sql.end();
	}
});

test('persists a visible transcript when a clarification is cancelled', async ({ request }) => {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error('DATABASE_URL is required for the Agent cancellation E2E');
	const sql = postgres(databaseUrl);
	const conversationId = randomUUID();
	const triggerMessageId = randomUUID();
	const promptMessageId = randomUUID();
	const executionId = randomUUID();
	const interactionId = randomUUID();

	try {
		const login = await request.post('/api/trpc/auth.loginWithPhoneCode', {
			data: { phone: '13800138000', code: '654321' }
		});
		expect(login.status()).toBe(200);
		const employeeId = String((await login.json()).result.data.id);
		await sql`
			INSERT INTO agent_conversation
				(id, owner_employee_id, owner_org_id, title, created_at, updated_at)
			VALUES
				(${conversationId}, ${employeeId}, '42', '取消补全 E2E', NOW(), NOW())
		`;
		await sql`
			INSERT INTO agent_message
				(id, conversation_id, role, content, ui, created_at)
			VALUES
				(${triggerMessageId}, ${conversationId}, 'user', '查看经营数据', NULL, NOW())
		`;
		const clarification = {
			interactionId,
			anchorMessageId: triggerMessageId,
			version: 2,
			prompt: '请补充酒店。',
			fields: [
				{
					kind: 'text',
					slot: 'hotelReference',
					label: '酒店',
					required: true,
					maxLength: 200
				}
			],
			expiresAt: new Date(Date.now() + 60_000).toISOString()
		};
		const state = {
			status: 'awaiting_clarification',
			routeKind: 'business_read',
			intent: 'hotel_operating_summary',
			slots: {
				hotelReference: { status: 'missing' },
				dateRange: { status: 'resolved', value: '昨天', source: { kind: 'quick_action' } }
			},
			clarification
		};
		await sql`
			INSERT INTO agent_business_execution
				(id, conversation_id, trigger_user_message_id, owner_employee_id, owner_org_id,
				 route_kind, intent, status, state, version, expires_at, created_at, updated_at)
			VALUES
				(${executionId}, ${conversationId}, ${triggerMessageId}, ${employeeId}, '42',
				 'business_read', 'hotel_operating_summary', 'awaiting_clarification',
				 ${sql.json(state)}, 2, ${new Date(clarification.expiresAt)}, NOW(), NOW())
		`;
		await sql`
			UPDATE agent_message SET business_execution_id = ${executionId}
			WHERE id = ${triggerMessageId}
		`;
		await sql`
			INSERT INTO agent_message
				(id, conversation_id, business_execution_id, role, content, ui, created_at)
			VALUES
				(${promptMessageId}, ${conversationId}, ${executionId}, 'assistant',
				 '请补充酒店。', NULL, NOW())
		`;

		const cancelled = await request.post('/api/trpc/agent.cancelBusinessExecution', {
			data: { businessExecutionId: executionId, expectedVersion: 2 }
		});
		expect(cancelled.status()).toBe(200);
		expect((await cancelled.json()).result.data).toMatchObject({
			businessExecutionId: executionId,
			status: 'cancelled',
			userMessage: { content: '取消本次任务' },
			assistantMessage: { content: '好的，本次任务已取消。' }
		});

		const loaded = await request.get(
			`/api/trpc/agent.getConversation?input=${encodeURIComponent(JSON.stringify({ conversationId }))}`
		);
		expect(loaded.status()).toBe(200);
		const snapshot = (await loaded.json()).result.data;
		expect(snapshot.activeBusinessExecution).toBeNull();
		expect(snapshot.messages.map((message: { content: string }) => message.content)).toEqual([
			'查看经营数据',
			'请补充酒店。',
			'取消本次任务',
			'好的，本次任务已取消。'
		]);
	} finally {
		await sql`DELETE FROM agent_conversation WHERE id = ${conversationId}`;
		await sql.end();
	}
});

test('cancels runs and deletes only owned conversations while preserving memory', async ({
	request
}) => {
	const rmsDatabaseUrl = process.env.RMS_DATABASE_URL;
	const databaseUrl = process.env.DATABASE_URL;
	if (!rmsDatabaseUrl || !databaseUrl) throw new Error('E2E database URLs are required');

	const suffix = randomUUID().slice(0, 8);
	const phone = `139${Math.floor(Math.random() * 10 ** 8)
		.toString()
		.padStart(8, '0')}`;
	const rms = await mysql.createConnection(rmsDatabaseUrl);
	const sql = postgres(databaseUrl);
	let employeeId: string | null = null;
	const foreignConversationId = randomUUID();
	const foreignMessageId = randomUUID();
	const foreignRunId = randomUUID();
	const memoryId = `memory-${suffix}`;

	try {
		const [inserted] = await rms.execute<ResultSetHeader>(
			`INSERT INTO employee
				(org_id, username, password_hash, full_name, phone, role_code, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[42, `agent-delete-${suffix}`, 'unused-phone-otp', '会话删除测试员工', phone, 'FRONT_DESK', 1]
		);
		employeeId = String(inserted.insertId);

		const login = await request.post('/api/trpc/auth.loginWithPhoneCode', {
			data: { phone, code: '654321' }
		});
		expect(login.status()).toBe(200);

		const firstCreated = await request.post('/api/trpc/agent.createConversation', {
			data: { title: '待单独删除' }
		});
		const secondCreated = await request.post('/api/trpc/agent.createConversation', {
			data: { title: '待批量清空' }
		});
		expect(firstCreated.status()).toBe(200);
		expect(secondCreated.status()).toBe(200);
		const firstConversation = (await firstCreated.json()).result.data;
		const secondConversation = (await secondCreated.json()).result.data;

		await sql`
			INSERT INTO agent_memory
				(id, owner_employee_id, owner_org_id, key, content, importance, created_at, updated_at)
			VALUES
				(${memoryId}, ${employeeId}, '42', ${`preference-${suffix}`}, '保留安静房偏好', 1, NOW(), NOW())
		`;

		const started = await request.post('/api/trpc/agent.startRun', {
			data: {
				conversationId: secondConversation.id,
				prompt: '分析本周经营情况',
				clientRequestId: randomUUID()
			}
		});
		expect(started.status()).toBe(200);
		const firstRun = (await started.json()).result.data;
		const cancelled = await request.post('/api/trpc/agent.cancelRun', {
			data: { runId: firstRun.runId }
		});
		expect(cancelled.status()).toBe(200);
		expect((await cancelled.json()).result.data).toEqual({
			runId: firstRun.runId,
			status: 'cancelled'
		});
		const repeatedCancellation = await request.post('/api/trpc/agent.cancelRun', {
			data: { runId: firstRun.runId }
		});
		expect((await repeatedCancellation.json()).result.data).toEqual({
			runId: firstRun.runId,
			status: 'cancelled'
		});

		const continued = await request.post('/api/trpc/agent.startRun', {
			data: {
				conversationId: secondConversation.id,
				prompt: '继续',
				clientRequestId: randomUUID()
			}
		});
		expect(continued.status()).toBe(200);
		const continuedRun = (await continued.json()).result.data;
		expect(continuedRun.runId).not.toBe(firstRun.runId);
		const continuedCancellation = await request.post('/api/trpc/agent.cancelRun', {
			data: { runId: continuedRun.runId }
		});
		expect(continuedCancellation.status()).toBe(200);
		expect((await continuedCancellation.json()).result.data.status).toBe('cancelled');

		const continuedConversation = await request.get(
			`/api/trpc/agent.getConversation?input=${encodeURIComponent(
				JSON.stringify({ conversationId: secondConversation.id })
			)}`
		);
		expect((await continuedConversation.json()).result.data.executions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ runId: firstRun.runId, status: 'cancelled' }),
				expect.objectContaining({ runId: continuedRun.runId, status: 'cancelled' })
			])
		);
		await sql`
			INSERT INTO agent_conversation
				(id, owner_employee_id, owner_org_id, title, created_at, updated_at)
			VALUES
				(${foreignConversationId}, 'another-employee', '42', '他人的会话', NOW(), NOW())
		`;
		await sql`
			INSERT INTO agent_message
				(id, conversation_id, role, content, ui, created_at)
			VALUES
				(${foreignMessageId}, ${foreignConversationId}, 'user', '他人的任务', NULL, NOW())
		`;
		await sql`
			INSERT INTO agent_run
				(id, conversation_id, owner_employee_id, client_request_id, user_message_id, status, created_at)
			VALUES
				(${foreignRunId}, ${foreignConversationId}, 'another-employee', ${randomUUID()}, ${foreignMessageId}, 'running', NOW())
		`;
		const forbiddenCancellation = await request.post('/api/trpc/agent.cancelRun', {
			data: { runId: foreignRunId }
		});
		expect(forbiddenCancellation.status()).toBe(404);
		expect(await sql`SELECT status FROM agent_run WHERE id = ${foreignRunId}`).toEqual([
			{ status: 'running' }
		]);

		const forbiddenDelete = await request.post('/api/trpc/agent.deleteConversation', {
			data: { conversationId: foreignConversationId }
		});
		expect(forbiddenDelete.status()).toBe(404);
		expect(
			await sql`SELECT id FROM agent_conversation WHERE id = ${foreignConversationId}`
		).toHaveLength(1);

		const deleted = await request.post('/api/trpc/agent.deleteConversation', {
			data: { conversationId: firstConversation.id }
		});
		expect(deleted.status()).toBe(200);
		expect((await deleted.json()).result.data).toEqual({ deletedCount: 1 });

		const remaining = await request.get('/api/trpc/agent.listConversations');
		expect(remaining.status()).toBe(200);
		expect((await remaining.json()).result.data.map((item: { id: string }) => item.id)).toEqual([
			secondConversation.id
		]);

		const cleared = await request.post('/api/trpc/agent.clearConversations', { data: {} });
		expect(cleared.status()).toBe(200);
		expect((await cleared.json()).result.data).toEqual({ deletedCount: 1 });
		expect(
			(await (await request.get('/api/trpc/agent.listConversations')).json()).result.data
		).toEqual([]);
		expect(await sql`SELECT id FROM agent_memory WHERE id = ${memoryId}`).toHaveLength(1);
	} finally {
		await sql`DELETE FROM agent_conversation WHERE id = ${foreignConversationId}`;
		await sql`DELETE FROM agent_conversation WHERE owner_employee_id = ${employeeId ?? ''}`;
		await sql`DELETE FROM agent_memory WHERE id = ${memoryId}`;
		await sql.end();
		if (employeeId) await rms.execute('DELETE FROM employee WHERE id = ?', [employeeId]);
		await rms.end();
	}
});
