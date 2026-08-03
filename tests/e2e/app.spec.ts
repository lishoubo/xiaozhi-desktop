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

test.beforeEach(async () => {
  runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-butler-e2e-'));
  const launchEnvironment = { ...process.env };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  delete launchEnvironment.NO_COLOR;

  electronApp = await electron.launch({
    args: [
      path.resolve('.e2e/build/main.js'),
      `--user-data-dir=${path.join(runtimeDirectory, 'user-data')}`,
    ],
    cwd: path.resolve('.'),
    env: {
      ...launchEnvironment,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      // 开机自动化默认关闭（opt-in），e2e 不设 HOTEL_BUTLER_ENABLE_STARTUP_AUTOMATION 即不会运行
    },
  });
  page = await electronApp.firstWindow();
});

test.afterEach(async () => {
  await electronApp?.close();
  fs.rmSync(runtimeDirectory, { force: true, recursive: true });
});

async function login(): Promise<void> {
  await page.getByRole('textbox', { name: '手机号' }).fill('13800138000');
  await page.getByRole('button', { name: '获取验证码' }).click();
  await page.getByRole('textbox', { name: '验证码' }).fill('123456');
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check();
  await page.getByRole('button', { name: '登录' }).click();
}

test('animates Xiaozhi ambiently and honors reduced-motion preferences', async () => {
  const avatar = page.locator('[data-agent-avatar][data-motion="float"]');
  const status = page.locator('[data-agent-status="breathing"]');

  await expect(avatar).toBeVisible();
  await expect(status).toBeVisible();
  expect(await avatar.evaluate((element) => getComputedStyle(element).animationName)).toContain(
    'agent-float',
  );
  expect(
    await status.evaluate((element) => getComputedStyle(element, '::after').animationName),
  ).toContain('agent-status-breathe');

  await page.emulateMedia({ reducedMotion: 'reduce' });

  expect(await avatar.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  expect(
    await status.evaluate((element) => getComputedStyle(element, '::after').animationName),
  ).toBe('none');
});

test('logs in with the local phone verification flow', async () => {
  await login();

  await expect(page.getByRole('button', { name: '携程酒店 eBooking' })).toBeVisible();
  await expect(page.getByText('导入已有浏览器 Cookie')).toBeVisible();
  await page.getByRole('button', { name: '导入 Cookie' }).click();
  await expect(page.getByRole('dialog', { name: '从浏览器导入 Cookie' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '暂不导入' }).click();
});

test('starts the Electron window with the Svelte browser shell', async () => {
  await login();
  await expect(page).toHaveTitle('小智酒店管家');
  await expect(page.getByRole('button', { name: '携程酒店 eBooking' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '网址' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新' })).toBeVisible();

  const versions = await electronApp.evaluate(({ app }) => ({
    electron: process.versions.electron,
    name: app.getName(),
  }));

  expect(versions.electron).toBeTruthy();
  expect(versions.name).toBeTruthy();
});

test('opens the AI concierge from the icon sidebar', async () => {
  await login();
  await page.getByRole('link', { name: '小智AI 管家' }).click();

  await expect(page).toHaveURL(/#\/agent$/);
  await expect(page.getByRole('heading', { name: '小智AI 管家' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今天想先处理什么？' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '给小智AI 管家发消息' })).toBeVisible();
});

test('opens the localized calendar with the seeded holiday group', async () => {
  await login();
  await page.evaluate(async () => {
    for (let index = 0; index < 8; index += 1) {
      await window.hotelButler.calendar.createEvent({
        id: `e2e-overflow-${index}`,
        calendarId: 'personal',
        title: `满房日运营事项 ${index + 1}`,
        startsAt: '2026-08-15T00:00:00.000',
        endsAt: '2026-08-16T00:00:00.000',
        allDay: true,
        notes: '',
      });
    }
  });
  await page.getByRole('link', { name: '日历' }).click();

  await expect(page).toHaveURL(/#\/calendar$/);
  await expect(page.getByRole('region', { name: '酒店运营日历' })).toBeVisible();
  await expect(page.getByText('中国大陆节假日')).toBeVisible();
  await expect(page.getByText('我的日历')).toBeVisible();
  await expect(page.getByText('酒店运营示例')).toBeVisible();
  await expect(page.getByText('每日运营晨会')).toBeVisible();
  await expect(page.getByRole('button', { name: '今天' })).toBeVisible();
  await expect(page.getByRole('button', { name: '上一个时段' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一个时段' })).toBeVisible();

  const panelFitsSidebar = await page.evaluate(() => {
    const sidebar = document.querySelector('.wx-calendar-sidebar');
    const panel = document.querySelector('[data-slot="calendar-panel"]');
    if (!sidebar || !panel) return false;
    return panel.getBoundingClientRect().right <= sidebar.getBoundingClientRect().right + 1;
  });
  expect(panelFitsSidebar).toBe(true);

  const groupColors = await page
    .locator('.wx-calendar-name')
    .evaluateAll((groups) => groups.map((group) => getComputedStyle(group).backgroundColor));
  expect(groupColors).toHaveLength(3);
  expect(new Set(groupColors).size).toBe(3);

  await page.locator('[data-date="2026-08-15"]').dblclick();
  const allDayCheckbox = page.getByRole('checkbox', { name: '全天' });
  const allDayLabel = page.getByText('全天', { exact: true });
  const calendarGroupCheckboxes = page
    .getByRole('group', { name: '日历筛选' })
    .getByRole('checkbox');
  await expect(allDayCheckbox).toBeChecked();
  await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '完成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '取消' })).toHaveCount(0);
  expect(
    await page
      .locator(
        '.wx-editor-calendar input[type="checkbox"], [aria-label="日历筛选"] input[type="checkbox"]',
      )
      .evaluateAll((checkboxes) => new Set(checkboxes.map((checkbox) => checkbox.id)).size),
  ).toBe(4);

  await allDayLabel.click();
  await expect(allDayCheckbox).not.toBeChecked();
  await expect(page.locator('.wx-editor-calendar .wx-timepicker').first()).toBeVisible();
  await expect(calendarGroupCheckboxes).toHaveCount(3);
  for (const checkbox of await calendarGroupCheckboxes.all()) await expect(checkbox).toBeChecked();

  await allDayLabel.click();
  await expect(allDayCheckbox).toBeChecked();
  await allDayLabel.click();
  await expect(allDayCheckbox).not.toBeChecked();
  await expect(page.locator('.wx-editor-calendar .wx-timepicker').first()).toBeVisible();
  for (const checkbox of await calendarGroupCheckboxes.all()) await expect(checkbox).toBeChecked();

  await page.locator('[data-date="2026-08-02"]').click();
  await expect(page.getByRole('textbox', { name: '备注' })).toHaveCount(0);
  await page.locator('[data-date="2026-08-02"]').click();
  await expect(page.getByRole('textbox', { name: '备注' })).toHaveCount(0);
  await page.locator('[data-date="2026-08-02"]').click();
  await expect(page.getByRole('textbox', { name: '备注' })).toBeVisible();
  await page.getByRole('button', { name: '完成' }).click();

  const moreButton = page.locator('.wx-more-button').first();
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  await expect(page.getByRole('complementary', { name: '2026年8月15日日程' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^编辑满房日运营事项/ })).toHaveCount(8);
  const stableGrid = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.wx-grid-section .wx-grid-cell'));
    const rowsByTop = new Map<number, DOMRect[]>();
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      const key = Math.round(rect.top);
      const row = rowsByTop.get(key) ?? [];
      row.push(rect);
      rowsByTop.set(key, row);
    }
    const rows = [...rowsByTop.values()].sort((left, right) => left[0].top - right[0].top);
    const alignedWithinRows = rows.every((row) => {
      const tops = row.map((cell) => cell.top);
      const heights = row.map((cell) => cell.height);
      return (
        row.length === 7 &&
        Math.max(...tops) - Math.min(...tops) <= 1 &&
        Math.max(...heights) - Math.min(...heights) <= 1
      );
    });
    const continuousRows = rows.slice(0, -1).every((row, index) => {
      const nextRow = rows[index + 1];
      return Math.abs(row[0].bottom - nextRow[0].top) <= 1;
    });
    return {
      alignedWithinRows,
      continuousRows,
      rowCount: rows.length,
    };
  });
  expect(stableGrid).toEqual({
    alignedWithinRows: true,
    continuousRows: true,
    rowCount: 6,
  });
  await page.getByRole('button', { name: '关闭当日日程' }).click();

  await page.getByRole('button', { name: '周视图' }).click();
  await expect(page.getByRole('button', { name: '周视图' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: '新建日程' }).click();
  await expect(page.getByRole('button', { name: '完成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '取消' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '关闭' })).toHaveCount(0);
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('textbox', { name: '备注' })).toHaveCount(0);
  await expect(page.getByText('新日程')).toHaveCount(2);

  await page.getByText('每日运营晨会').click();
  const existingTitle = page.getByRole('textbox', { name: '文本' });
  await existingTitle.fill('自动保存的晨会标题');
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByText('自动保存的晨会标题')).toBeVisible();

  await page.getByText('自动保存的晨会标题').click();
  await expect(page.getByRole('button', { name: '删除' })).toBeVisible();
  await page.getByRole('button', { name: '删除' }).click();
  await expect(page.getByText('自动保存的晨会标题')).toHaveCount(0);

  await page.getByRole('button', { name: '今天' }).click();
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: '下一个时段' }).click();
  }
  await expect(page.getByRole('heading', { level: 2 })).toContainText('2026年8月30日–9月5日');
  await expect(page.getByTestId('mini-calendar-month')).toHaveText('2026年8月');

  await page.getByRole('button', { name: '迷你日历下一个月' }).click();
  await expect(page.getByTestId('mini-calendar-month')).toHaveText('2026年9月');
  await page.locator('.hotel-mini-calendar .wx-day:not(.wx-out)', { hasText: /^15$/ }).click();
  await expect(page.getByRole('heading', { level: 2 })).toContainText('9月');
});

test('previews generated hotel UI with static data', async () => {
  await login();
  await page.getByRole('link', { name: '小智AI 管家' }).click();
  await page.getByRole('button', { name: '预览房态库存' }).click();

  await expect(page.getByRole('heading', { name: '房态与库存' })).toBeVisible();
  await expect(page.getByText('高级双床房库存偏紧')).toBeVisible();
  await expect(page.getByText('Mock 数据')).toBeVisible();
  await expect(page.locator('[data-generative-ui="hotel"]')).toBeVisible();
});

test('navigates between the browser workspace and settings', async () => {
  await login();
  await page.getByRole('link', { name: '设置' }).click();

  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByText('客户端版本')).toBeVisible();
  await page.getByRole('button', { name: '导入 Cookie' }).click();
  await expect(page.getByRole('dialog', { name: '从浏览器导入 Cookie' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();

  await page.getByRole('link', { name: '浏览器' }).click();
  await expect(page).toHaveURL(/#\/$/);
});
