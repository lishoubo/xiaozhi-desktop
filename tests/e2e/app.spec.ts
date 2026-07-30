import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let electronApp: ElectronApplication;
let page: Page;
let runtimeDirectory: string;

test.beforeAll(async () => {
  runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-butler-e2e-'));
  const launchEnvironment = { ...process.env };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  delete launchEnvironment.NO_COLOR;

  electronApp = await electron.launch({
    args: [path.resolve('.e2e/build/main.js')],
    cwd: path.resolve('.'),
    env: {
      ...launchEnvironment,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      HOTEL_BUTLER_DATABASE_PATH: path.join(runtimeDirectory, 'hotel-butler.sqlite3'),
    },
  });
  page = await electronApp.firstWindow();
});

test.afterAll(async () => {
  await electronApp?.close();
  fs.rmSync(runtimeDirectory, { force: true, recursive: true });
});

test('persists settings through preload, IPC, Drizzle and SQLite', async () => {
  const result = await page.evaluate(async () => {
    const created = await window.hotelButler.settings.set('browser.homepage', {
      url: 'https://example.com',
    });
    const loaded = await window.hotelButler.settings.get('browser.homepage');
    const listed = await window.hotelButler.settings.list();
    const deleted = await window.hotelButler.settings.delete('browser.homepage');
    const afterDelete = await window.hotelButler.settings.get('browser.homepage');

    return { created, loaded, listed, deleted, afterDelete };
  });

  expect(result.created.value).toEqual({ url: 'https://example.com' });
  expect(result.loaded).toEqual(result.created);
  expect(result.listed).toContainEqual(result.created);
  expect(result.deleted).toBe(true);
  expect(result.afterDelete).toBeNull();
});

test('starts the Electron window with the Svelte browser shell', async () => {
  await expect(page).toHaveTitle('Hotel Butler');
  await expect(page.getByRole('heading', { name: '开始浏览' })).toBeVisible();
  await expect(page.getByText('在地址栏输入网址即可开始。')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '网址' })).toHaveValue('https://example.com');

  const versions = await electronApp.evaluate(({ app }) => ({
    electron: process.versions.electron,
    name: app.getName(),
  }));

  expect(versions.electron).toBeTruthy();
  expect(versions.name).toBeTruthy();
});

test('navigates static routes and loads settings through TanStack Query', async () => {
  await page.getByRole('link', { name: '设置' }).click();

  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByText('目前还没有保存任何设置。')).toBeVisible();

  await page.getByRole('link', { name: '浏览器' }).click();
  await expect(page).toHaveURL(/#\/$/);
});
