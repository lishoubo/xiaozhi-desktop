import { expect, test } from '@playwright/test';

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
		quickActionCount: 3
	});

	const quickActions = await request.get('/api/trpc/agent.quickActions');
	expect(quickActions.status()).toBe(200);
	const actionCatalog = (await quickActions.json()).result.data;
	expect(actionCatalog.map((action: { id: string }) => action.id)).toEqual([
		'today_weather',
		'weather_outlook',
		'air_quality'
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
	expect((await loaded.json()).result.data).toEqual({ conversation, messages: [] });

	const forgedOwner = await request.get(
		`/api/trpc/agent.getConversation?input=${encodeURIComponent(
			JSON.stringify({ conversationId: conversation.id, ownerEmployeeId: 'another-user' })
		)}`
	);
	expect(forgedOwner.status()).toBe(400);
});
