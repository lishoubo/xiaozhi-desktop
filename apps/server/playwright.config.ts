import { defineConfig } from '@playwright/test';

const baseURL = 'https://localhost:4173';

export default defineConfig({
	globalSetup: './tests/e2e/global-setup.ts',
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		stderr: 'pipe',
		stdout: 'pipe',
		timeout: 120_000
	},
	use: {
		baseURL,
		// Playwright's API request client has a separate trust configuration. Browser
		// and Electron traffic still validate against the host-installed mkcert CA.
		ignoreHTTPSErrors: true
	},
	testMatch: '**/*.e2e.{ts,js}'
});
