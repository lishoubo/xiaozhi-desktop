import { expect, test } from '@playwright/test';

test('correlates a tRPC request with the response', async ({ request }) => {
	const response = await request.get('/api/trpc/system.health', {
		headers: { 'x-request-id': 'server-e2e-request' }
	});

	expect(new URL(response.url()).protocol).toBe('https:');
	expect(response.status()).toBe(200);
	expect(response.headers()['x-request-id']).toBe('server-e2e-request');
});

test('returns a safe active RMS employee identity by phone', async ({ request }) => {
	const input = encodeURIComponent(JSON.stringify({ phone: '13800138000' }));
	const response = await request.get(`/api/trpc/identity.employeeByPhone?input=${input}`);

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
});
