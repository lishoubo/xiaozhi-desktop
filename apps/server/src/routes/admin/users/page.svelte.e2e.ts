import { expect, test } from '@playwright/test';

test('initial administrator signs in with username and password and opens user management', async ({
	page
}) => {
	await page.goto('/login');
	await page.getByLabel('用户名').fill('admin');
	await page.getByLabel('密码').fill('admin123');
	await page.getByRole('button', { name: '登录' }).click();

	await expect(page).toHaveURL(/\/admin\/users$/);
	await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
	await expect(page.locator('tbody').getByText('admin', { exact: true })).toBeVisible();
	await expect(page.getByText('超级管理员', { exact: true })).toBeVisible();
});

test('public email and password registration is disabled', async ({ request }) => {
	const response = await request.post('/api/auth/sign-up/email', {
		data: {
			email: 'unexpected-admin@example.com',
			name: 'Unexpected administrator',
			password: 'not-an-admin-password'
		}
	});

	expect(response.status()).toBe(400);
});
