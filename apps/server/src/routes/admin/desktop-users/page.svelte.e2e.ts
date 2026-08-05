import { expect, test } from '@playwright/test';

test('administrator opens the dashboard and manages desktop users only', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByText('开发环境管理员')).not.toBeVisible();
	await page.getByLabel('用户名').fill('admin');
	await page.getByLabel('密码').fill('admin123');
	await page.getByRole('button', { name: '登录' }).click();

	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByText('桌面用户总数')).toBeVisible();
	await expect(page.getByRole('button', { name: '打开导航菜单' })).toBeHidden();
	await expect(page.getByRole('link', { name: '桌面用户管理' })).toBeVisible();

	await page.getByRole('link', { name: '桌面用户管理' }).click();
	await expect(page).toHaveURL(/\/admin\/desktop-users$/);
	await expect(page.getByRole('heading', { name: '桌面用户管理' })).toBeVisible();
	await expect(page.getByText('13800138000')).toBeVisible();
	await expect(page.getByText('测试桌面用户')).toBeVisible();
	await expect(page.locator('tbody').getByText('admin', { exact: true })).toHaveCount(0);

	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: '停用' }).click();
	await expect(page.getByText('桌面用户已停用')).toBeVisible();
	await expect(page.getByRole('table').getByText('已停用', { exact: true })).toBeVisible();
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
