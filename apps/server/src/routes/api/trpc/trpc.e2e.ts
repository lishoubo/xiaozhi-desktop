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
