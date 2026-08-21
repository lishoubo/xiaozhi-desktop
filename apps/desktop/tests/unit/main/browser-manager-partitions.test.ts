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
    readonly setVisible = vi.fn();
    readonly setBackgroundColor = vi.fn();

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
  const sessionForLogin = vi.fn((channel: string) => {
    loginCounter += 1;
    const partitionName = `persist:xiaozhi:dev:${channel}:generated-${loginCounter}`;
    const created = createMockSession(partitionName);
    sessions.set(partitionName, created);
    return { session: created, partitionName };
  });
  const clearAccountSession = vi.fn(async () => {});
  return { sessionForAccount, sessionForLogin, sessions, clearAccountSession };
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
      toChannelId('douyin'),
      'https://life.douyin.com/p/login',
    );

    expect(partitionName).toMatch(/^persist:xiaozhi:dev:douyin:/);
    expect(tab.channelId).toBe('douyin');
    expect(sessionFactory.sessionForLogin).toHaveBeenCalledWith('douyin');
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

/**
 * 退休 = 「这份登录态已经被另一份替换掉了」。清空它的存储是不可逆的，因此下手前
 * 必须确认没人还在用它 —— 真机上这里出过事故：连续绑定多个美团账号后，5 个
 * credential 指向的 partition 被清空，用户点账号只能看到登录页。
 */
describe('BrowserManager — 退休 partition 的清理守卫', () => {
  const CLAIMED = 'persist:xiaozhi:prod:meituan:claimed';
  const ORPHAN = 'persist:xiaozhi:prod:meituan:orphan';

  function createManager(claimed: readonly string[] = []) {
    const sessionFactory = createSessionFactoryStub();
    const logger = createLogger();
    const manager = new BrowserManager(createWindow() as never, logger, sessionFactory as never, {
      isPartitionClaimed: (name: string) => claimed.includes(name),
    });
    return { manager, sessionFactory, logger };
  }

  it('无人引用的退休 partition 正常清理', async () => {
    const { manager, sessionFactory } = createManager();

    await manager.retirePartition(ORPHAN);

    expect(sessionFactory.clearAccountSession).toHaveBeenCalledWith(ORPHAN);
  });

  /**
   * 🔴 事故本体：credential 已经指向这个 partition，说明它是某个账号**当前**的
   * 登录态，退休标记本身就是错的。清了 = 用户掉登录。
   */
  it('仍被 credential 引用的 partition 绝不清理', async () => {
    const { manager, sessionFactory, logger } = createManager([CLAIMED]);

    await manager.retirePartition(CLAIMED);

    expect(sessionFactory.clearAccountSession).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('claimed'),
      expect.anything(),
    );
  });

  /**
   * 撤销标记而不是留着：留着的话它会被之后**每一次** close() 反复重扫，
   * 一旦某刻 credential 短暂不指向它（例如归并中途），就会被清掉。
   */
  it('被认领而取消退休后，后续关闭标签页不会再尝试清理它', async () => {
    const { manager, sessionFactory } = createManager([CLAIMED]);
    await manager.retirePartition(CLAIMED);

    const tab = manager.createWithAlreadyPartition(CLAIMED, 'meituan', 'https://a.example/');
    manager.close(tab.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionFactory.clearAccountSession).not.toHaveBeenCalled();
  });

  /** 有标签页正在用就先不清，等它关闭；此时退休标记要保留（与「被认领」不同）。 */
  it('仍有标签页占用时延迟清理，标签页关闭后补清', async () => {
    const { manager, sessionFactory } = createManager();
    const tab = manager.createWithAlreadyPartition(ORPHAN, 'meituan', 'https://a.example/');

    await manager.retirePartition(ORPHAN);
    expect(sessionFactory.clearAccountSession).not.toHaveBeenCalled();

    manager.close(tab.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionFactory.clearAccountSession).toHaveBeenCalledWith(ORPHAN);
  });

  /**
   * close() 只该重试**本次关闭的 tab 自己的** partition。原实现遍历整个退休集合，
   * 于是「关掉 A 的标签页」会顺带清掉集合里毫不相干的 B —— 事故的放大器。
   */
  it('close 只重试本 tab 的 partition，不牵连集合里其他条目', async () => {
    const { manager, sessionFactory } = createManager();
    const other = 'persist:xiaozhi:prod:meituan:other';

    // other 退休时有标签页占用 → 留在集合里
    const otherTab = manager.createWithAlreadyPartition(other, 'meituan', 'https://o.example/');
    await manager.retirePartition(other);
    expect(sessionFactory.clearAccountSession).not.toHaveBeenCalled();

    // 关掉与 other 无关的另一个 tab
    const unrelated = manager.createWithAlreadyPartition(ORPHAN, 'meituan', 'https://u.example/');
    manager.close(unrelated.id);
    await Promise.resolve();
    await Promise.resolve();

    // other 仍有标签页占用，不该被这次关闭波及
    expect(sessionFactory.clearAccountSession).not.toHaveBeenCalledWith(other);
    manager.close(otherTab.id);
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

    await manager.createAndNewPartition(
      toChannelId('douyin'),
      'https://life.douyin.com/p/login',
    );
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
