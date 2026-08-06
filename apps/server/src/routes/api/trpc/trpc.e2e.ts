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

	const response = await request.post('/api/trpc/auth.loginWithPhoneCode', {
		data: { phone: '13800138000', code: '654321' }
	});

	expect(response.status()).toBe(200);
	const payload = await response.json();
	expect(payload.result.data).toEqual({
		id: '2',
		orgId: '42',
		username: 'desktop-e2e-user',
		fullName: '测试桌面员工',
		phone: '13800138000',
		roleCode: 'FRONT_DESK'
	});
	expect(JSON.stringify(payload)).not.toContain('password');
	expect(JSON.stringify(payload)).not.toContain('654321');
});
