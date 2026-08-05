import { defineConfig } from '@playwright/test';

export default defineConfig({
	globalSetup: './tests/e2e/global-setup.ts',
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		timeout: 120_000
	},
	testMatch: '**/*.e2e.{ts,js}'
});
