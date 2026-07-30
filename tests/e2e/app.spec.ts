import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import path from 'node:path';

let electronApp: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const launchEnvironment = { ...process.env };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  delete launchEnvironment.NO_COLOR;

  electronApp = await electron.launch({
    args: [path.resolve('.e2e/build/main.js')],
    cwd: path.resolve('.'),
    env: {
      ...launchEnvironment,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });
  page = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('starts the Electron window with the Svelte browser shell', async () => {
  await expect(page).toHaveTitle('Hotel Butler');
  await expect(page.getByText('Svelte renderer 已连接')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '网址' })).toHaveValue('https://example.com');

  const versions = await electronApp.evaluate(({ app }) => ({
    electron: process.versions.electron,
    name: app.getName(),
  }));

  expect(versions.electron).toBeTruthy();
  expect(versions.name).toBeTruthy();
});
