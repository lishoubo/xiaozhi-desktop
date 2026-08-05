import { defineConfig } from '@playwright/test';

const baseURL = 'https://localhost:4173';

export default defineConfig({
	globalSetup: './tests/e2e/global-setup.ts',
	webServer: {
		command: 'npm run build && npm run preview',
			env: {
				...process.env,
				DATABASE_URL: 'postgres://root:testpassword@localhost:55432/test',
			INITIAL_ADMIN_NAME: 'E2E Administrator',
			INITIAL_ADMIN_PASSWORD: 'admin123',
				INITIAL_ADMIN_USERNAME: 'admin',
				LOCAL_PHONE_OTP_CODE: '123456',
				ORIGIN: baseURL,
				RMS_DATABASE_URL: 'mysql://hotel_butler:testpassword@localhost:53306/rms_test'
		},
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
