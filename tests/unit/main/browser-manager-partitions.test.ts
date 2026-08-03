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

import { toChannelId } from '../../../src/domain/identity';
import { BrowserManager } from '../../../src/main/browser/browser-manager';

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

    manager.createWithAlreadyPartition('persist:xiaozhi:prod:douyin:aaa', 'douyin', 'https://a.example/');
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:douyin:bbb', 'douyin', 'https://b.example/');

    expect(sessionFactory.sessionForAccount).toHaveBeenCalledWith('persist:xiaozhi:prod:douyin:aaa');
    expect(sessionFactory.sessionForAccount).toHaveBeenCalledWith('persist:xiaozhi:prod:douyin:bbb');
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

  it('标签页关闭时触发 onTabClosed，并带上这份登录态的 partitionName', async () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );
    const onTabClosed = vi.fn();

    const { tab, partitionName } = await manager.createAndNewPartition(
      'prod',
      toChannelId('douyin'),
      'https://life.douyin.com/p/login',
      { onTabClosed },
    );
    manager.close(tab.id);

    expect(onTabClosed).toHaveBeenCalledWith(partitionName);
  });

  it('createWithAlreadyPartition 打开的标签页关闭时不触发探测（没有 onTabClosed）', () => {
    const sessionFactory = createSessionFactoryStub();
    const manager = new BrowserManager(
      createWindow() as never,
      createLogger(),
      sessionFactory as never,
    );

    const tab = manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:douyin:aaa',
      'douyin',
      'https://a.example/',
    );

    expect(() => manager.close(tab.id)).not.toThrow();
  });
});
