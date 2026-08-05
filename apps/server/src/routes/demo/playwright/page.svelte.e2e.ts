import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import postgres from 'postgres';

test('has expected h1', async ({ page }) => {
	await page.goto('/demo/playwright');
	await expect(page.locator('h1')).toBeVisible();
});

test('runs with isolated PostgreSQL and RMS databases', async () => {
	const postgresUrl = process.env.DATABASE_URL;
	const rmsUrl = process.env.RMS_DATABASE_URL;
	if (!postgresUrl || !rmsUrl) throw new Error('Test database URLs were not configured');
	expect(postgresUrl).toMatch(/^postgres:\/\//);
	expect(rmsUrl).toMatch(/^mysql:\/\//);

	const postgresClient = postgres(postgresUrl, { max: 1 });
	const rmsClient = await createConnection(rmsUrl);

	try {
		const [postgresRows, rmsResult] = await Promise.all([
			postgresClient`select 1 as value`,
			rmsClient.query('select 1 as value')
		]);
		expect(postgresRows).toEqual([{ value: 1 }]);
		expect(rmsResult[0]).toEqual([{ value: 1 }]);
	} finally {
		await Promise.all([postgresClient.end(), rmsClient.end()]);
	}
});
