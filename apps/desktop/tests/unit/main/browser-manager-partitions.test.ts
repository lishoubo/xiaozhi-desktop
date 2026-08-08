import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const views: MockWebContentsView[] = [];

  class MockWebContentsView {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly webContents = {
      close: vi.fn(),
      getTitle: vi.fn(() => 'Page title'),
      getURL: vi.fn(() => 'https://example.com/'),
      id: views.length + 1,
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => {}),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
      },
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        this.handlers.set(event, listener);
      }),
      reload: vi.fn(),
      setAudioMuted: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    readonly setBounds = vi.fn();

    constructor(readonly options: { webPreferences: { session: unknown } }) {
      views.push(this);
    }
  }

  return { MockWebContentsView, views };
});

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: electron.MockWebContentsView,
}));

import { toChannelId } from '../../../src/main/ids';
import { BrowserManager, type TabNavigatedEvent } from '../../../src/main/browser/browser-manager';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createWindow() {
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  };
}

function createMockSession(partition: string, setCookie = vi.fn().mockResolvedValue(undefined)) {
  return {
    partition,
    cookies: { set: setCookie },
    webRequest: { onBeforeRequest: vi.fn() },
  };
}

function createSessionFactoryStub() {
  const sessions = new Map<string, ReturnType<typeof createMockSession>>();
  const sessionForAccount = vi.fn((partitionName: string) => {
    const existing = sessions.get(partitionName);
    if (existing) return existing;
    const created = createMockSession(partitionName);
    sessions.set(partitionName, created);
    return created;
  });
  let loginCounter = 0;
  const sessionForLogin = vi.fn((environment: string, channel: string) => {
    loginCounter += 1;
    const partitionName = `persist:xiaozhi:${environment}:${channel}:generated-${loginCounter}`;
    const created = createMockSession(partitionName);
    sessions.set(partitionName, created);
    return { session: created, partitionName };
  });
  return { sessionForAccount, sessionForLogin, sessions };
}

beforeEach(() => {
  electron.views.splice(0);
});

describe('BrowserManager — partition-aware tab creation', () => {
  it('createWithAlreadyPartition 用给定 partitionName 换取 session，不同账号得到不同 session', () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );

    manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:douyin:aaa',
      'douyin',
      'https://a.example/',
    );
    manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:douyin:bbb',
      'douyin',
      'https://b.example/',
    );

    expect(sessionFactory.sessionForAccount).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:douyin:aaa',
    );
    expect(sessionFactory.sessionForAccount).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:douyin:bbb',
    );
    expect(electron.views[0].options.webPreferences.session).not.toBe(
      electron.views[1].options.webPreferences.session,
    );
  });

  it('createAndNewPartition 新建 partition 并返回 partitionName', async () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );

    const { tab, partitionName } = await manager.createAndNewPartition(
      'prod',
      toChannelId('douyin'),
      'https://life.douyin.com/p/login',
    );

    expect(partitionName).toMatch(/^persist:xiaozhi:prod:douyin:/);
    expect(tab.channelId).toBe('douyin');
    expect(sessionFactory.sessionForLogin).toHaveBeenCalledWith('prod', 'douyin');
  });

  it('createAndNewPartition 传入已导入 cookie 时，逐条注入新 session 后才算创建完成', async () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );
    const importedCookies = [
      { name: 'a', value: '1', domain: '.douyin.com' } as never,
      { name: 'b', value: '2', domain: '.douyin.com' } as never,
    ];

    const { partitionName } = await manager.createAndNewPartition(
      'prod',
      toChannelId('douyin'),
      'https://life.douyin.com/p/login',
      { importedCookies },
    );

    const tabSession = sessionFactory.sessions.get(partitionName);
    expect(tabSession?.cookies.set).toHaveBeenCalledTimes(2);
    expect(tabSession?.cookies.set).toHaveBeenCalledWith(importedCookies[0]);
    expect(tabSession?.cookies.set).toHaveBeenCalledWith(importedCookies[1]);
  });
});

describe('BrowserManager — tab:navigated / tab:closed 事件广播', () => {
  it('did-navigate 时广播 tab:navigated，带上 tabId/partitionName/channelId/url/webContents', async () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );
    const listener = vi.fn();
    manager.on('tab:navigated', listener);

    const { tab, partitionName } = await manager.createAndNewPartition(
      'prod',
      toChannelId('ctrip'),
      'https://ebooking.ctrip.com/login/',
    );
    const view = electron.views[0];
    view.handlers.get('did-navigate')?.({}, 'https://ebooking.ctrip.com/home/mainland');

    expect(listener).toHaveBeenCalledExactlyOnceWith({
      tabId: tab.id,
      partitionName,
      channelId: 'ctrip',
      url: 'https://ebooking.ctrip.com/home/mainland',
      webContents: view.webContents,
    } as unknown as TabNavigatedEvent);
  });

  it('did-navigate-in-page 同样广播 tab:navigated', async () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );
    const listener = vi.fn();
    manager.on('tab:navigated', listener);

    await manager.createAndNewPartition('prod', toChannelId('douyin'), 'https://life.douyin.com/p/login');
    const view = electron.views[0];
    view.handlers.get('did-navigate-in-page')?.({}, 'https://life.douyin.com/p/home?groupid=123');

    expect(listener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ url: 'https://life.douyin.com/p/home?groupid=123' }),
    );
  });

  it('close(tabId) 时广播 tab:closed', () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );
    const listener = vi.fn();
    manager.on('tab:closed', listener);

    const tab = manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:douyin:aaa',
      'douyin',
      'https://a.example/',
    );
    manager.close(tab.id);

    expect(listener).toHaveBeenCalledExactlyOnceWith({ tabId: tab.id });
  });

  it('createWithAlreadyPartition 打开的标签页也广播 tab:navigated（不区分是否登录场景）', () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );
    const listener = vi.fn();
    manager.on('tab:navigated', listener);

    manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:douyin:aaa',
      'douyin',
      'https://life.douyin.com/p/home',
    );
    const view = electron.views[0];
    view.handlers.get('did-navigate')?.({}, 'https://life.douyin.com/p/home?groupid=123');

    expect(listener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        partitionName: 'persist:xiaozhi:prod:douyin:aaa',
        channelId: 'douyin',
        url: 'https://life.douyin.com/p/home?groupid=123',
      }),
    );
  });
});
