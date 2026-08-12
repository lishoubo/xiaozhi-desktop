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
		quickActionCount: 2
	});

	const quickActions = await request.get('/api/trpc/agent.quickActions');
	expect(quickActions.status()).toBe(200);
	const actionCatalog = (await quickActions.json()).result.data;
	expect(actionCatalog.map((action: { id: string }) => action.id)).toEqual([
		'today_weather',
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
		executions: []
	});

	const forgedOwner = await request.get(
		`/api/trpc/agent.getConversation?input=${encodeURIComponent(
			JSON.stringify({ conversationId: conversation.id, ownerEmployeeId: 'another-user' })
		)}`
	);
	expect(forgedOwner.status()).toBe(400);
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
