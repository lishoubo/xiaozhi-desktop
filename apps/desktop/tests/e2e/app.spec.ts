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
import Database from 'better-sqlite3';

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
      HOTEL_BUTLER_SERVER_URL: 'https://localhost:4173',
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
  await expect(page.getByRole('button', { name: /秒后重新获取/ })).toBeDisabled();
  await page.getByRole('textbox', { name: '验证码' }).fill('123456');
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).check();
  await page.getByRole('button', { name: '登录', exact: true }).click();
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

test('logs in through the server and stores a hardened persistent session cookie', async () => {
  await login();

  await expect(page.getByRole('button', { name: '携程酒店 eBooking' })).toBeVisible();
  const sessionCookies = await electronApp.evaluate(async ({ session }) => {
    const cookies = await session
      .fromPartition('persist:xiaozhi:server-api')
      .cookies.get({ name: '__Host-xiaozhi_desktop_session' });
    return cookies.map(({ httpOnly, name, sameSite, secure, session: isSessionCookie }) => ({
      httpOnly,
      name,
      sameSite,
      secure,
      isSessionCookie,
    }));
  });
  expect(sessionCookies).toEqual([
    {
      httpOnly: true,
      name: '__Host-xiaozhi_desktop_session',
      sameSite: 'strict',
      secure: true,
      isSessionCookie: false,
    },
  ]);
  expect(await page.evaluate(() => window.hotelButler.auth.currentSession())).toMatchObject({
    phone: '13800138000',
    username: 'desktop-demo',
  });
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

test('uses credential-backed account switching and shared-session tabs', async ({
  browserName: _browserName,
}, testInfo) => {
  await login();
  await page.getByRole('button', { name: '暂不导入' }).click();

  const databasePath = path.join(runtimeDirectory, 'user-data', 'hotel-butler.sqlite');
  const insertCredentialSql = `
    INSERT INTO ota_credential
      (id, channel, channel_account_id, partition_name, credential_extra,
       discovered_at, last_refreshed_at)
    VALUES
      (@id, 'ctrip', @channelAccountId, @partitionName, @credentialExtra,
       @discoveredAt, @discoveredAt)
  `;
  const credentialB = {
    id: 'e2e-credential-b',
    channelAccountId: 'e2e-account-b',
    partitionName: 'persist:xiaozhi:prod:ctrip:e2e-b',
    credentialExtra: JSON.stringify({ hotelName: '测试登录账号 B' }),
    discoveredAt: 1,
  };
  const database = new Database(databasePath);
  const insertCredential = database.prepare(insertCredentialSql);
  insertCredential.run({
    id: 'e2e-credential-a',
    channelAccountId: 'e2e-account-a',
    partitionName: 'persist:xiaozhi:prod:ctrip:e2e-a',
    credentialExtra: JSON.stringify({ hotelName: '测试登录账号 A' }),
    discoveredAt: 2,
  });
  insertCredential.run(credentialB);
  database.close();

  await page.getByRole('button', { name: '美团酒店' }).click();
  await page.getByRole('button', { name: '携程酒店 eBooking' }).click();
  const accountArea = page.getByLabel('当前登录账号');
  const accountSwitcher = page.getByRole('button', { name: '切换登录账号' });
  await expect(accountArea).toContainText('携程酒店 eBooking');

  await accountSwitcher.click();
  const dialog = page.getByRole('dialog', { name: '已登录账号列表' });
  await expect(dialog.getByRole('button', { name: /测试登录账号 A/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /测试登录账号 B/ })).toBeVisible();
  await dialog.screenshot({
    path: testInfo.outputPath('browser-workspace-credential-dialog.png'),
  });
  await page.screenshot({
    path: testInfo.outputPath('browser-workspace-credential-list-wide.png'),
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(860, 700);
  });
  await expect(accountSwitcher).toBeVisible();
  await expect(accountArea).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('browser-workspace-empty-narrow.png'),
  });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 800);
  });

  await accountSwitcher.click();
  await dialog.getByRole('button', { name: /测试登录账号 A/ }).click();
  await expect(accountArea).toContainText('测试登录账号 A');
  await expect(page.getByRole('tab')).toHaveCount(1);

  await page.getByRole('button', { name: '新建标签页' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await accountSwitcher.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab')).toHaveCount(2);

  await accountSwitcher.click();
  const failureDatabase = new Database(databasePath);
  failureDatabase.prepare('DELETE FROM ota_credential WHERE id = ?').run(credentialB.id);
  failureDatabase.close();
  await dialog.getByRole('button', { name: /测试登录账号 B/ }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByText('打开账号页面失败，请重试')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(accountArea).toContainText('测试登录账号 A');

  const restoredDatabase = new Database(databasePath);
  restoredDatabase.prepare(insertCredentialSql).run(credentialB);
  restoredDatabase.close();
  await accountSwitcher.click();
  await dialog.getByRole('button', { name: /测试登录账号 B/ }).click();
  await expect(accountArea).toContainText('测试登录账号 B');
  await expect(page.getByRole('tab')).toHaveCount(1);

  await page.locator('button[aria-label^="关闭 "]').click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(accountArea).toContainText('携程酒店 eBooking');
  await expect(page.getByRole('button', { name: '新建标签页' })).toBeDisabled();
});

test('opens the AI concierge from the icon sidebar', async () => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await login();
  await expect(page.getByRole('button', { name: '携程酒店 eBooking' })).toBeVisible();
  await page.evaluate(() => window.hotelButler.agent.createConversation('历史经营复盘'));
  await page.evaluate(() => window.hotelButler.agent.createConversation('待清空的历史会话'));
  await page.getByRole('link', { name: '小智AI 管家' }).click();

  await expect(page).toHaveURL(/#\/agent$/);
  await expect(page.getByText('小智 AI 管家', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今天想处理什么？' })).toBeVisible();
  const newConversation = page.getByRole('button', { name: '开始新会话' });
  const historicalConversation = page.getByRole('button', {
    name: '历史经营复盘',
    exact: true,
  });
  await expect(newConversation).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('历史会话', { exact: true })).toBeVisible();
  await expect(historicalConversation).toHaveAttribute('aria-pressed', 'false');

  await historicalConversation.click();
  await expect(historicalConversation).toHaveAttribute('aria-pressed', 'true');
  await expect(newConversation).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('历史经营复盘', { exact: true })).toHaveCount(2);

  await newConversation.click();
  await expect(newConversation).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '今天想处理什么？' })).toBeVisible();
  expect(pageErrors).toEqual([]);

  await historicalConversation.click();
  await expect(historicalConversation).toHaveAttribute('aria-pressed', 'true');

  await historicalConversation.hover();
  await page.getByRole('button', { name: '删除会话：历史经营复盘' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('删除后无法恢复，长期记忆不受影响。');
  await expect(page.getByRole('alertdialog')).not.toContainText('消息和执行记录');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '历史经营复盘', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '新会话' })).toBeVisible();

  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('1 次会话');
  await page.getByRole('button', { name: '全部清空' }).click();
  await expect(page.getByText('暂无历史会话')).toBeVisible();
  await expect(page.getByRole('button', { name: '待清空的历史会话', exact: true })).toHaveCount(0);

  await newConversation.click();
  await expect(newConversation).toHaveAttribute('aria-pressed', 'true');
  const composer = page.getByRole('textbox');
  await expect(composer).toBeVisible();

  await composer.fill('分析今天的经营情况');
  await page.getByRole('button', { name: '发送消息' }).click();
  const stopRun = page.getByRole('button', { name: '停止执行' });
  await expect(stopRun).toBeEnabled();
  await newConversation.click();
  await expect(composer).toBeEnabled();
  await expect(stopRun).toHaveCount(0);
  const runningConversation = page.getByRole('button', {
    name: '分析今天的经营情况',
    exact: true,
  });
  await expect(runningConversation.locator('..')).toContainText('运行中');
  await runningConversation.click();
  await expect(stopRun).toBeEnabled();
  await stopRun.click();
  await expect(page.getByText('已停止', { exact: true })).toBeVisible();
  await expect(composer).toBeEnabled();
  const firstPromptRow = page.locator('article[data-agent-message-role="user"]', {
    hasText: '分析今天的经营情况',
  });
  const firstPromptId = await firstPromptRow.getAttribute('data-agent-message-id');
  expect(firstPromptId).not.toBeNull();
  const firstExecution = page.locator(
    `article[data-agent-execution-for-message="${firstPromptId}"] [data-agent-execution-status="cancelled"]`,
  );
  await expect(firstExecution).toHaveCount(1);

  await composer.fill('继续');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(stopRun).toBeEnabled();
  await stopRun.click();
  await expect(page.getByText('已停止', { exact: true })).toHaveCount(2);
  const continueRow = page.locator('article[data-agent-message-role="user"]', { hasText: '继续' });
  const continueMessageId = await continueRow.getAttribute('data-agent-message-id');
  expect(continueMessageId).not.toBeNull();
  await expect(
    page.locator(
      `article[data-agent-execution-for-message="${continueMessageId}"] [data-agent-execution-status="cancelled"]`,
    ),
  ).toHaveCount(1);
  await expect(firstExecution).toHaveCount(1);
  expect(pageErrors).toEqual([]);
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

  const existingUntitledEventCount = await page.getByText('新日程', { exact: true }).count();
  await page.getByRole('button', { name: '新建日程' }).click();
  await expect(page.getByRole('button', { name: '完成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '取消' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '关闭' })).toHaveCount(0);
  await page.getByRole('button', { name: '完成' }).click();
  await expect(page.getByRole('textbox', { name: '备注' })).toHaveCount(0);
  await expect(page.getByText('新日程', { exact: true })).toHaveCount(
    existingUntitledEventCount + 1,
  );

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
  const periodHeading = page.getByRole('heading', { level: 2 });
  for (let index = 0; index < 8; index += 1) {
    if ((await periodHeading.textContent())?.includes('2026年8月30日–9月5日')) break;
    await page.getByRole('button', { name: '下一个时段' }).click();
  }
  await expect(periodHeading).toContainText('2026年8月30日–9月5日');
  await expect(page.getByTestId('mini-calendar-month')).toHaveText('2026年9月');

  await page.getByRole('button', { name: '迷你日历下一个月' }).click();
  await expect(page.getByTestId('mini-calendar-month')).toHaveText('2026年10月');
  await page.locator('.hotel-mini-calendar .wx-day:not(.wx-out)', { hasText: /^15$/ }).click();
  await expect(page.getByRole('heading', { level: 2 })).toContainText('10月');
});

test('shows only executable public MCP quick actions', async () => {
  await login();
  await page.getByRole('link', { name: '小智AI 管家' }).click();

  const yesterdayReview = page.getByRole('button', { name: '昨日经营复盘', exact: true });
  const sevenDayTrend = page.getByRole('button', { name: '近 7 日经营趋势', exact: true });
  await expect(yesterdayReview).toBeVisible();
  await expect(sevenDayTrend).toBeVisible();
  await expect(page.getByRole('button', { name: '本月经营进度', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '渠道经营对比', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看酒店经营概览', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看今日天气', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '未来七天天气', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '空气质量提醒', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预览房态库存' })).toHaveCount(0);

  await yesterdayReview.click();
  await expect(page.getByRole('form', { name: '补充任务信息' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消', exact: true })).toBeVisible();
  await expect(sevenDayTrend).toBeEnabled();
  const userMessageCount = await page.locator('article[data-agent-message-role="user"]').count();

  await sevenDayTrend.click();

  await expect(
    page.getByText('当前任务正在等待补充信息，请先确认或取消当前任务。', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('article[data-agent-message-role="user"]')).toHaveCount(
    userMessageCount,
  );
  await expect(page.getByRole('form', { name: '补充任务信息' })).toBeVisible();
  await expect(page.getByText(/快捷操作启动失败/)).toHaveCount(0);

  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(
    page.getByText('当前任务正在等待补充信息，请先确认或取消当前任务。', { exact: true }),
  ).toHaveCount(0);
});

test('keeps the Agent conversation at the latest content without interrupting history reading', async () => {
  await login();
  await page.getByRole('link', { name: '小智AI 管家' }).click();

  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: '昨日经营复盘', exact: true }).click();
    await expect(page.getByRole('form', { name: '补充任务信息' })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('form', { name: '补充任务信息' })).toHaveCount(0);
  }

  const viewport = page.getByRole('region', { name: '对话内容' });
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(2);

  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
    const filler = document.createElement('div');
    filler.dataset.scrollTestFiller = 'true';
    filler.style.height = '200px';
    element.firstElementChild?.append(filler);
  });
  await page.waitForTimeout(100);
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(0);
  await viewport.evaluate((element) => {
    element.querySelector('[data-scroll-test-filler]')?.remove();
  });

  await page.getByRole('button', { name: '开始新会话' }).click();
  await page.locator('aside button[aria-pressed="false"]').first().click();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(2);
});

test('navigates between the browser workspace and settings', async () => {
  await login();
  await page.getByRole('link', { name: '设置' }).click();

  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await expect(page.getByText('客户端版本')).toBeVisible();
  await page.getByRole('button', { name: '已登录 Cookie 列表' }).click();
  await page.getByRole('button', { name: '导入 Cookie' }).click();
  await expect(page.getByRole('dialog', { name: '从浏览器导入 Cookie' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  const cookieListDialog = page.getByRole('dialog', { name: '已登录 Cookie 列表' });
  await cookieListDialog.getByRole('button', { name: '关闭' }).click();
  await expect(cookieListDialog).toHaveCount(0);

  await page.getByRole('link', { name: '浏览器' }).click();
  await expect(page).toHaveURL(/#\/$/);
});
