import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../src/domain/identity';
import { OtaTabOpener } from '../../../src/main/features/ota-tab-opener/ota-tab-opener';
import { TabEventBus } from '../../../src/main/browser/tab-event-bus';
import { readImportedCookies, writeImportedCookies } from '../../../src/main/cookie-import/store';

const temporaryDirectories: string[] = [];

function tempUserDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaozhi-ota-tab-opener-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

/** 真实 EventEmitter 充当 mock BrowserManager，保留 tab:navigated/tab:closed 订阅语义。 */
function createBrowserManagerStub() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    createAndNewPartition: vi.fn(),
    createWithAlreadyPartition: vi.fn(),
  });
}

/** handleTabNavigated 是 fire-and-forget 的 async，emit 后需要 flush microtask 队列。 */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('OtaTabOpener — open / createFromCookie', () => {
  it('open() 登记 loginUrlMatcher 后，tab:navigated 命中登录判据即触发 discovery 并广播 checked', async () => {
    const channel = toChannelId('ctrip');
    const matcher = { channel, isPastLogin: (url: string) => !url.includes('/login/') };
    const browserManager = createBrowserManagerStub();
    browserManager.createAndNewPartition.mockResolvedValue({
      tab: { id: 'tab-1' },
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    });
    const tabEventBus = new TabEventBus();
    const checkedListener = vi.fn();
    tabEventBus.on('tab:credential-checked', checkedListener);
    const triggerDiscovery = vi.fn().mockResolvedValue({ id: 'credential-1' });

    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([[channel, matcher]]),
      otaCredentialRepository: { findById: vi.fn() },
      triggerDiscovery,
    });

    await opener.open('prod', channel, 'https://ebooking.ctrip.com/login/');

    const webContents = {} as never;
    browserManager.emit('tab:navigated', {
      tabId: 'tab-1',
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
      channelId: channel,
      url: 'https://ebooking.ctrip.com/home/mainland',
      webContents,
    });
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledExactlyOnceWith(
      'persist:xiaozhi:prod:ctrip:aaa',
      channel,
      'https://ebooking.ctrip.com/home/mainland',
      webContents,
    );
    expect(checkedListener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: { kind: 'checked', credential: { id: 'credential-1' } } }),
    );
  });

  it('URL 未过登录页时广播 not-yet-past-login，不触发 discovery', async () => {
    const channel = toChannelId('ctrip');
    const matcher = { channel, isPastLogin: (url: string) => !url.includes('/login/') };
    const browserManager = createBrowserManagerStub();
    browserManager.createAndNewPartition.mockResolvedValue({
      tab: { id: 'tab-1' },
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    });
    const tabEventBus = new TabEventBus();
    const checkedListener = vi.fn();
    tabEventBus.on('tab:credential-checked', checkedListener);
    const triggerDiscovery = vi.fn();

    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([[channel, matcher]]),
      otaCredentialRepository: { findById: vi.fn() },
      triggerDiscovery,
    });

    await opener.open('prod', channel, 'https://ebooking.ctrip.com/login/');
    browserManager.emit('tab:navigated', {
      tabId: 'tab-1',
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
      channelId: channel,
      url: 'https://ebooking.ctrip.com/login/',
      webContents: {} as never,
    });
    await flush();

    expect(triggerDiscovery).not.toHaveBeenCalled();
    expect(checkedListener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: { kind: 'not-yet-past-login' } }),
    );
  });

  it('命中一次后再次导航不重复触发 discovery', async () => {
    const channel = toChannelId('ctrip');
    const matcher = { channel, isPastLogin: (url: string) => !url.includes('/login/') };
    const browserManager = createBrowserManagerStub();
    browserManager.createAndNewPartition.mockResolvedValue({
      tab: { id: 'tab-1' },
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    });
    const tabEventBus = new TabEventBus();
    const triggerDiscovery = vi.fn().mockResolvedValue(null);

    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([[channel, matcher]]),
      otaCredentialRepository: { findById: vi.fn() },
      triggerDiscovery,
    });

    await opener.open('prod', channel, 'https://ebooking.ctrip.com/login/');
    const navigate = (url: string) =>
      browserManager.emit('tab:navigated', {
        tabId: 'tab-1',
        partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
        channelId: channel,
        url,
        webContents: {} as never,
      });
    navigate('https://ebooking.ctrip.com/home/mainland');
    await flush();
    navigate('https://ebooking.ctrip.com/home/mainland?tab=2');
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledTimes(1);
  });

  it('渠道未注册 loginUrlMatcher 时，导航广播 not-applicable，不触发 discovery', async () => {
    const channel = toChannelId('douyin');
    const browserManager = createBrowserManagerStub();
    browserManager.createAndNewPartition.mockResolvedValue({
      tab: { id: 'tab-1' },
      partitionName: 'persist:xiaozhi:prod:douyin:bbb',
    });
    const tabEventBus = new TabEventBus();
    const checkedListener = vi.fn();
    tabEventBus.on('tab:credential-checked', checkedListener);
    const triggerDiscovery = vi.fn();

    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map(),
      otaCredentialRepository: { findById: vi.fn() },
      triggerDiscovery,
    });

    await opener.open('prod', channel, 'https://life.douyin.com/p/login');
    browserManager.emit('tab:navigated', {
      tabId: 'tab-1',
      partitionName: 'persist:xiaozhi:prod:douyin:bbb',
      channelId: channel,
      url: 'https://life.douyin.com/dashboard',
      webContents: {} as never,
    });
    await flush();

    expect(triggerDiscovery).not.toHaveBeenCalled();
    expect(checkedListener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: { kind: 'not-applicable' } }),
    );
  });

  it('tab:closed 后清理登记状态，同一 tabId 再次导航视为未登记', async () => {
    const channel = toChannelId('ctrip');
    const matcher = { channel, isPastLogin: () => true };
    const browserManager = createBrowserManagerStub();
    browserManager.createAndNewPartition.mockResolvedValue({
      tab: { id: 'tab-1' },
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
    });
    const tabEventBus = new TabEventBus();
    const checkedListener = vi.fn();
    tabEventBus.on('tab:credential-checked', checkedListener);
    const triggerDiscovery = vi.fn().mockResolvedValue(null);

    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([[channel, matcher]]),
      otaCredentialRepository: { findById: vi.fn() },
      triggerDiscovery,
    });

    await opener.open('prod', channel, 'https://ebooking.ctrip.com/login/');
    browserManager.emit('tab:closed', { tabId: 'tab-1' });
    browserManager.emit('tab:navigated', {
      tabId: 'tab-1',
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
      channelId: channel,
      url: 'https://ebooking.ctrip.com/home/mainland',
      webContents: {} as never,
    });
    await flush();

    expect(triggerDiscovery).not.toHaveBeenCalled();
    expect(checkedListener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: { kind: 'not-applicable' } }),
    );
  });

  describe('createFromCookie', () => {
    it('没有已导入 cookie 时拒绝', async () => {
      const channel = toChannelId('ctrip');
      const browserManager = createBrowserManagerStub();
      const opener = new OtaTabOpener({
        userDataDir: tempUserDataDir(),
        browserManager: browserManager as never,
        tabEventBus: new TabEventBus(),
        loginUrlMatchers: new Map(),
        otaCredentialRepository: { findById: vi.fn() },
        triggerDiscovery: vi.fn(),
      });

      await expect(
        opener.createFromCookie('prod', channel, 'https://ebooking.ctrip.com/'),
      ).rejects.toThrow('该渠道尚未导入 Cookie');
    });

    it('注入已导入 cookie，不删除该渠道 cookie（允许反复登录）', async () => {
      const channel = toChannelId('ctrip');
      const userDataDir = tempUserDataDir();
      await writeImportedCookies(userDataDir, channel, [{ name: 'a', value: '1' } as never], {
        importedAt: '2026-08-04T00:00:00.000Z',
        sourceId: 'chrome',
      });
      const browserManager = createBrowserManagerStub();
      browserManager.createAndNewPartition.mockResolvedValue({
        tab: { id: 'tab-1' },
        partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
      });

      const opener = new OtaTabOpener({
        userDataDir,
        browserManager: browserManager as never,
        tabEventBus: new TabEventBus(),
        loginUrlMatchers: new Map(),
        otaCredentialRepository: { findById: vi.fn() },
        triggerDiscovery: vi.fn(),
      });

      await opener.createFromCookie('prod', channel, 'https://ebooking.ctrip.com/');

      expect(browserManager.createAndNewPartition).toHaveBeenCalledExactlyOnceWith(
        'prod',
        channel,
        'https://ebooking.ctrip.com/',
        { importedCookies: [{ name: 'a', value: '1' }] },
      );
      await expect(readImportedCookies(userDataDir, channel)).resolves.not.toBeNull();
    });
  });
});

describe('OtaTabOpener — openExisting / openView', () => {
  it('openExisting 不传 intent 时只开 tab，不登记登录判定', async () => {
    const channel = toChannelId('ctrip');
    const matcher = { channel, isPastLogin: () => true };
    const browserManager = createBrowserManagerStub();
    browserManager.createWithAlreadyPartition.mockReturnValue({ id: 'tab-1' });
    const tabEventBus = new TabEventBus();
    const checkedListener = vi.fn();
    tabEventBus.on('tab:credential-checked', checkedListener);
    const triggerDiscovery = vi.fn();

    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([[channel, matcher]]),
      otaCredentialRepository: {
        findById: vi.fn(() => ({
          id: toOtaCredentialId('credential-1'),
          channel,
          channelAccountId: null,
          partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
          credentialExtra: null,
          discoveredAt: 1,
          lastRefreshedAt: null,
        })),
      },
      triggerDiscovery,
    });

    const tab = opener.openExisting('credential-1');
    expect(tab).toEqual({ id: 'tab-1' });
    expect(browserManager.createWithAlreadyPartition).toHaveBeenCalledExactlyOnceWith(
      'persist:xiaozhi:prod:ctrip:aaa',
      channel,
      'https://ebooking.ctrip.com/home/mainland',
    );

    browserManager.emit('tab:navigated', {
      tabId: 'tab-1',
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
      channelId: channel,
      url: 'https://ebooking.ctrip.com/home/mainland',
      webContents: {} as never,
    });
    await flush();

    expect(triggerDiscovery).not.toHaveBeenCalled();
    expect(checkedListener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: { kind: 'not-applicable' } }),
    );
  });

  it('openExisting 传 intent 时登记登录判定，导航命中即触发 discovery', async () => {
    const channel = toChannelId('ctrip');
    const matcher = { channel, isPastLogin: () => true };
    const browserManager = createBrowserManagerStub();
    browserManager.createWithAlreadyPartition.mockReturnValue({ id: 'tab-1' });
    const tabEventBus = new TabEventBus();
    const triggerDiscovery = vi.fn().mockResolvedValue({ id: 'credential-1' });

    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus,
      loginUrlMatchers: new Map([[channel, matcher]]),
      otaCredentialRepository: {
        findById: vi.fn(() => ({
          id: toOtaCredentialId('credential-1'),
          channel,
          channelAccountId: null,
          partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
          credentialExtra: null,
          discoveredAt: 1,
          lastRefreshedAt: null,
        })),
      },
      triggerDiscovery,
    });

    opener.openExisting('credential-1', { kind: 'probe-hotel' });
    browserManager.emit('tab:navigated', {
      tabId: 'tab-1',
      partitionName: 'persist:xiaozhi:prod:ctrip:aaa',
      channelId: channel,
      url: 'https://ebooking.ctrip.com/home/mainland',
      webContents: {} as never,
    });
    await flush();

    expect(triggerDiscovery).toHaveBeenCalledOnce();
  });

  it('openExisting 找不到 credential 时报错', () => {
    const browserManager = createBrowserManagerStub();
    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus: new TabEventBus(),
      loginUrlMatchers: new Map(),
      otaCredentialRepository: { findById: vi.fn(() => null) },
      triggerDiscovery: vi.fn(),
    });

    expect(() => opener.openExisting('missing')).toThrow('未找到该登录凭据');
  });

  it('openView 用共享 partition 打开渠道页面，不参与登录判定', () => {
    const browserManager = createBrowserManagerStub();
    browserManager.createWithAlreadyPartition.mockReturnValue({ id: 'tab-1' });
    const opener = new OtaTabOpener({
      userDataDir: tempUserDataDir(),
      browserManager: browserManager as never,
      tabEventBus: new TabEventBus(),
      loginUrlMatchers: new Map(),
      otaCredentialRepository: { findById: vi.fn() },
      triggerDiscovery: vi.fn(),
    });

    opener.openView('ctrip', 'https://ebooking.ctrip.com/');

    expect(browserManager.createWithAlreadyPartition).toHaveBeenCalledExactlyOnceWith(
      'persist:hotel-butler-browser',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );
  });
});
