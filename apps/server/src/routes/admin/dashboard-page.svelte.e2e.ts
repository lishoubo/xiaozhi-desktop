import { expect, test } from '@playwright/test';

test('administrator dashboard has no desktop-user management surface', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('用户名').fill('admin');
	await page.getByLabel('密码').fill('admin123');
	await page.getByRole('button', { name: '登录' }).click();

	await expect(page).toHaveURL(/\/admin$/);
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByRole('link', { name: '桌面用户管理' })).toHaveCount(0);
	await expect(page.getByText('桌面用户总数')).toHaveCount(0);
});
