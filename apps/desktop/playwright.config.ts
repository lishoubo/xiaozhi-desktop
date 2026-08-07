import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { e2ePostgresHostPort, e2eRmsHostPort } from '../server/tests/e2e/ports.ts';

const serverOrigin = 'https://localhost:4173';

export default defineConfig({
  globalSetup: '../server/tests/e2e/global-setup.ts',
  webServer: {
    command: 'npm run build && npm run preview',
    cwd: path.resolve('../server'),
    env: {
      ...process.env,
      DATABASE_URL: `postgres://root:testpassword@localhost:${e2ePostgresHostPort}/test`,
      INITIAL_ADMIN_NAME: 'E2E Administrator',
      INITIAL_ADMIN_PASSWORD: 'admin123',
      INITIAL_ADMIN_USERNAME: 'admin',
      ORIGIN: serverOrigin,
      RMS_DATABASE_URL: `mysql://hotel_butler:testpassword@localhost:${e2eRmsHostPort}/rms`,
    },
    port: 4173,
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: 120_000,
  },
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: serverOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
