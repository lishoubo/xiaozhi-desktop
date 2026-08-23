import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const views: MockWebContentsView[] = [];
  let nextLoadError: Error | null = null;
  let beforeRequestListener:
    | ((
        details: { url: string; webContentsId?: number },
        callback: (response: { cancel?: boolean }) => void,
      ) => void)
    | null = null;
  const browserSession = {
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    closeAllConnections: vi.fn().mockResolvedValue(undefined),
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    webRequest: {
      onBeforeRequest: vi.fn(
        (
          _filter: unknown,
          listener:
            | ((
                details: { url: string },
                callback: (response: { cancel?: boolean }) => void,
              ) => void)
            | null,
        ) => {
          beforeRequestListener = listener;
        },
      ),
    },
  };

  class MockWebContentsView {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly windowOpenHandler = vi.fn();
    readonly webContents = {
      close: vi.fn(),
      getTitle: vi.fn(() => 'Page title'),
      getURL: vi.fn(() => 'https://example.com/'),
      id: views.length + 1,
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async () => {
        const error = nextLoadError;
        nextLoadError = null;
        if (error) throw error;
      }),
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
      setWindowOpenHandler: vi.fn((listener: (...args: unknown[]) => unknown) => {
        this.windowOpenHandler.mockImplementation(listener);
      }),
    };
    readonly setBounds = vi.fn();
    readonly setVisible = vi.fn();
    readonly setBackgroundColor = vi.fn();

    constructor(readonly options: unknown) {
      views.push(this);
    }
  }

  return {
    browserSession,
    getBeforeRequestListener: () => beforeRequestListener,
    MockWebContentsView,
    session: { fromPartition: vi.fn(() => browserSession) },
    setNextLoadError: (error: Error) => {
      nextLoadError = error;
    },
    views,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: electron.MockWebContentsView,
  session: electron.session,
}));

import { BrowserManager } from '../../../src/main/browser/browser-manager';
import { SessionFactory } from '../../../src/main/browser/session-factory';
import { toChannelId } from '../../../src/main/ids';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

type WindowInputHandler = (
  event: { preventDefault: () => void },
  input: { alt: boolean; control: boolean; key: string; meta: boolean; type: string },
) => void;

function createWindow() {
  const handlers = new Map<string, WindowInputHandler>();
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    handlers,
    webContents: {
      send: vi.fn(),
      on: vi.fn((event: string, listener: WindowInputHandler) => {
        handlers.set(event, listener);
      }),
      removeListener: vi.fn((event: string, listener: WindowInputHandler) => {
        if (handlers.get(event) === listener) handlers.delete(event);
      }),
    },
  };
}

function createBrowserManager(
  window: ReturnType<typeof createWindow>,
  logger: ReturnType<typeof createLogger>,
) {
  return new BrowserManager(window as never, logger, new SessionFactory(logger));
}

beforeEach(() => {
  electron.views.splice(0);
  electron.session.fromPartition.mockClear();
  electron.browserSession.setPermissionCheckHandler.mockClear();
  electron.browserSession.setPermissionRequestHandler.mockClear();
  electron.browserSession.webRequest.onBeforeRequest.mockClear();
  electron.browserSession.clearCache.mockClear();
  electron.browserSession.clearStorageData.mockClear();
  electron.browserSession.closeAllConnections.mockClear();
});

describe('BrowserManager', () => {
  it('applies one audio state to every existing tab and lets new tabs inherit it', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.createWithAlreadyPartition(
      'persist:test-shared',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );
    manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:douyin:account',
      'douyin',
      'https://life.douyin.com/p/home',
    );

    manager.setAudioMuted(true);

    expect(manager.getAudioMuted()).toBe(true);
    expect(electron.views[0].webContents.setAudioMuted).toHaveBeenLastCalledWith(true);
    expect(electron.views[1].webContents.setAudioMuted).toHaveBeenLastCalledWith(true);

    manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:meituan:account',
      'meituan',
      'https://me.meituan.com/',
    );

    expect(electron.views[2].webContents.setAudioMuted).toHaveBeenCalledWith(true);
  });

  it('keeps the global preference and updates remaining tabs when one tab cannot be muted', () => {
    const logger = createLogger();
    const manager = createBrowserManager(createWindow(), logger);
    manager.createWithAlreadyPartition(
      'persist:test-shared',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );
    manager.createWithAlreadyPartition(
      'persist:test-shared',
      'douyin',
      'https://life.douyin.com/p/home',
    );
    electron.views[0].webContents.setAudioMuted.mockImplementationOnce(() => {
      throw new Error('tab unavailable');
    });

    expect(manager.setAudioMuted(true)).toBe(true);

    expect(electron.views[1].webContents.setAudioMuted).toHaveBeenLastCalledWith(true);
    expect(logger.warn).toHaveBeenCalledWith('Browser tab audio state could not be changed', {
      channelId: 'ctrip',
      errorName: 'Error',
    });
  });

  it('creates secure managed tabs and releases them explicitly', () => {
    const logger = createLogger();
    const window = createWindow();
    const manager = createBrowserManager(window, logger);

    // 复用构造器创建的默认 session，断言权限 handler 只被安装一次。
    const tab = manager.createWithAlreadyPartition(
      'persist:hotel-butler-browser',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );
    manager.close(tab.id);

    expect(electron.session.fromPartition).toHaveBeenCalledWith('persist:hotel-butler-browser');
    expect(electron.browserSession.setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(electron.browserSession.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(electron.views[0].options).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    expect(logger.info.mock.calls).toEqual([
      [
        'Browser tab created',
        { channelId: 'ctrip', partitionName: 'persist:hotel-butler-browser' },
      ],
      ['Browser tab closed', { channelId: 'ctrip' }],
    ]);
    expect(electron.views[0].webContents.close).toHaveBeenCalledOnce();
  });

  it('退休 partition 仍有标签时延迟到最后一个标签关闭后清空', async () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    const partitionName = 'persist:xiaozhi:prod:meituan:retired';
    const tab = manager.createWithAlreadyPartition(
      partitionName,
      'meituan',
      'https://me.meituan.com/',
    );

    await manager.retirePartition(partitionName);
    expect(electron.browserSession.clearStorageData).not.toHaveBeenCalled();

    manager.close(tab.id);
    await vi.waitFor(() => expect(electron.browserSession.clearStorageData).toHaveBeenCalledOnce());
    expect(electron.browserSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(electron.browserSession.clearCache).toHaveBeenCalledOnce();
  });

  it('reports page load failures without logging the rejected URL or error message', async () => {
    electron.setNextLoadError(new Error('failed https://private.example/path?token=secret'));
    const logger = createLogger();
    const manager = createBrowserManager(createWindow(), logger);

    manager.createWithAlreadyPartition(
      'persist:test-shared',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );

    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith('Browser page load failed', {
        channelId: 'ctrip',
        errorName: 'Error',
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private.example');
  });

  it('blocks non-web navigation and records only the channel category', () => {
    const logger = createLogger();
    const manager = createBrowserManager(createWindow(), logger);
    manager.createWithAlreadyPartition(
      'persist:test-shared',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );
    const preventDefault = vi.fn();

    electron.views[0].handlers.get('will-navigate')?.({ preventDefault }, 'javascript:alert(1)');

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('Blocked invalid browser navigation', {
      channelId: 'ctrip',
    });
  });

  it('reattaches an active tab when the workspace activates it after being hidden', () => {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    const tab = manager.createWithAlreadyPartition(
      'persist:test-shared',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );

    manager.hide();
    manager.activate(tab.id);

    expect(window.contentView.addChildView).toHaveBeenCalledTimes(2);
    expect(window.contentView.addChildView).toHaveBeenLastCalledWith(electron.views[0]);
  });

  it('routes Cmd+R to the active embedded tab and blocks it outside the browser workspace', () => {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    manager.createWithAlreadyPartition(
      'persist:test-shared',
      'ctrip',
      'https://ebooking.ctrip.com/',
    );
    const preventDefault = vi.fn();
    const input = {
      type: 'keyDown',
      key: 'r',
      meta: true,
      control: false,
      alt: false,
    };

    window.handlers.get('before-input-event')?.({ preventDefault }, input);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electron.views[0].webContents.reload).toHaveBeenCalledOnce();

    preventDefault.mockClear();
    electron.views[0].webContents.reload.mockClear();
    manager.hide();
    window.handlers.get('before-input-event')?.({ preventDefault }, input);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(electron.views[0].webContents.reload).not.toHaveBeenCalled();
  });

  it('does not intercept unrelated main-window shortcuts', () => {
    const window = createWindow();
    createBrowserManager(window, createLogger());
    const preventDefault = vi.fn();

    window.handlers.get('before-input-event')?.(
      { preventDefault },
      { type: 'keyDown', key: 'f', meta: true, control: false, alt: false },
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('BrowserManager viewport visibility', () => {
  const CTRIP = 'https://ebooking.ctrip.com/';

  /**
   * 🔴 回归：让位与尺寸同步曾共用 `setBounds` 一个通道，靠渲染进程的一个布尔量
   * 互斥。两者是并发异步链，守卫读取与 IPC 落地之间存在窗口，零尺寸最后落地时
   * 视图就此不可见——标题照常更新，内容区却空白，且不可稳定复现。
   *
   * 现在可见性独立表达：让位**不得**改动尺寸。
   */
  it('hides the active view without touching its bounds', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    manager.setBounds({ x: 0, y: 64, width: 1200, height: 700 });
    const view = electron.views[0];
    view.setBounds.mockClear();

    manager.setViewportVisible(false);

    expect(view.setVisible).toHaveBeenLastCalledWith(false);
    expect(view.setBounds).not.toHaveBeenCalled();
  });

  /**
   * 🔴 回归：让位期间打开的标签页若默认可见，会直接盖在弹窗上——绑定流程正是
   * 这个形状（弹窗先让位，再在弹窗里开标签页）。
   */
  it('makes a tab activated while suspended inherit the hidden state', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.setViewportVisible(false);

    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);

    expect(electron.views[0].setVisible).toHaveBeenLastCalledWith(false);
  });

  /**
   * 🔴 `hide()` **不得**顺手复位让位状态。它有三个调用方，只有一个是「离开工作区」：
   * 切到空渠道、账号切换弹窗都会调它，在那里复位会清掉别人（如绑定弹窗）的让位。
   *
   * 复位的责任在渲染进程 `releaseViewportSession()`，那个方法的语义就是离开工作区。
   */
  it('does not resurrect visibility on hide, since hide has non-workspace callers', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    manager.setViewportVisible(false);

    manager.hide();
    manager.activate(manager.list()[0].id);

    // 让位仍然有效——只有显式 setViewportVisible(true) 才解除。
    expect(electron.views[0].setVisible).toHaveBeenLastCalledWith(false);

    manager.setViewportVisible(true);
    expect(electron.views[0].setVisible).toHaveBeenLastCalledWith(true);
  });

  /**
   * `setViewportVisible` 只作用于当前活动视图，因此让位期间被顶下去的旧标签页会
   * 留在 setVisible(false) 上——实测确认可见性是**每个 view 各自持有**的状态，
   * 且移出/加回视图树都不会重置它。
   *
   * 兜底靠 `activate()` 每次都无条件重设可见性（不只在切换时）。这是个隐式不变量：
   * 全类只有 activate 一处 addChildView，所以「上屏必经 activate」成立。这条用例
   * 就是钉住它——若有人日后在 activate 之外新增上屏路径，或把这行改成只在切换时
   * 执行，旧标签页会永久隐身。
   */
  it('re-asserts visibility on every activate, even for an already-active tab', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    const first = manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    manager.setViewportVisible(false);
    // 让位期间开第二个标签页：它顶掉了 first，此后 setViewportVisible 再也够不到 first。
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:b', 'ctrip', CTRIP);
    manager.setViewportVisible(true);
    expect(electron.views[0].setVisible).toHaveBeenLastCalledWith(false);

    // 用户点回第一个标签页 —— 必须把它救回来。
    manager.activate(first.id);

    expect(electron.views[0].setVisible).toHaveBeenLastCalledWith(true);
  });

  it('restores visibility on resume', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);

    manager.setViewportVisible(false);
    manager.setViewportVisible(true);

    expect(electron.views[0].setVisible).toHaveBeenLastCalledWith(true);
  });
});

describe('BrowserManager page-opened tabs', () => {
  const CTRIP = 'https://ebooking.ctrip.com/';

  /**
   * 🔴 回归：网页 `window.open` 开的标签页此前由主进程直接激活，界面不知情，
   * 无人为它同步视口尺寸——新视图拿到主进程当时的 bounds（让位期间就是零）。
   * 现在只建不激活，改为广播给界面走统一收尾。
   */
  it('creates the tab without activating it and notifies the renderer', () => {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    window.contentView.addChildView.mockClear();
    window.webContents.send.mockClear();

    const result = electron.views[0].windowOpenHandler({ url: 'https://ebooking.ctrip.com/order' });

    expect(result).toEqual({ action: 'deny' });
    expect(electron.views).toHaveLength(2);
    // 没有激活：内容区仍是原来那个视图。
    expect(window.contentView.addChildView).not.toHaveBeenCalled();
    const sent = window.webContents.send.mock.calls.find(
      ([channel]) => channel === 'browser:tab-opened',
    );
    expect(sent?.[1]).toMatchObject({ channelId: 'ctrip', failure: null });
  });

  it('keeps the opener partition so popups stay in the same login session', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);

    electron.views[0].windowOpenHandler({ url: 'https://ebooking.ctrip.com/order' });

    expect(manager.list()[1].partitionName).toBe('persist:xiaozhi:prod:ctrip:a');
  });

  it('throttles a page that opens windows in a tight loop', () => {
    const logger = createLogger();
    const manager = createBrowserManager(createWindow(), logger);
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);

    for (let index = 0; index < 6; index += 1) {
      electron.views[0].windowOpenHandler({ url: `https://ebooking.ctrip.com/p/${index}` });
    }

    // 1 个原始标签 + 阈值 3 个，其余被节流拦掉。
    expect(manager.list()).toHaveLength(4);
    expect(logger.warn).toHaveBeenCalledWith('Browser popup throttled', expect.anything());
  });
});

describe('BrowserManager tab limit', () => {
  it('refuses to exceed the tab ceiling on every creation path', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    for (let index = 0; index < 12; index += 1) {
      manager.createWithAlreadyPartition(
        `persist:xiaozhi:prod:ctrip:a${index}`,
        'ctrip',
        `https://ebooking.ctrip.com/p/${index}`,
      );
    }

    expect(() =>
      manager.createWithAlreadyPartition(
        'persist:xiaozhi:prod:ctrip:overflow',
        'ctrip',
        'https://ebooking.ctrip.com/',
      ),
    ).toThrow('最多同时打开');
    expect(manager.list()).toHaveLength(12);
  });

  /**
   * 🔴 达上限时**不得**先建 partition 再拒绝：`sessionForLogin` 会在磁盘上落一份
   * 登录态，随后还写入 cookie。若等到 createTab 才抛，这份 partition 既无标签页
   * 引用、也没进账本，就成了孤儿 —— 本仓库出过事故的那一类。
   */
  it('refuses before creating a partition, so nothing is orphaned', async () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    for (let index = 0; index < 12; index += 1) {
      manager.createWithAlreadyPartition(
        `persist:xiaozhi:prod:ctrip:a${index}`,
        'ctrip',
        `https://ebooking.ctrip.com/p/${index}`,
      );
    }
    electron.session.fromPartition.mockClear();

    await expect(
      manager.createAndNewPartition(toChannelId('ctrip'), 'https://ebooking.ctrip.com/'),
    ).rejects.toThrow('最多同时打开');

    // 一次都不该去换 session —— 换了就意味着 partition 已经落盘。
    expect(electron.session.fromPartition).not.toHaveBeenCalled();
  });
});

describe('BrowserManager failure state', () => {
  const CTRIP = 'https://ebooking.ctrip.com/';

  function openTab() {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    return { manager, view: electron.views[0] };
  }

  it('marks a crashed renderer and stops the loading state', () => {
    const { manager, view } = openTab();

    view.handlers.get('render-process-gone')?.({}, { reason: 'crashed' });

    expect(manager.list()[0]).toMatchObject({ failure: 'crashed', loading: false });
  });

  it('marks a failed main-frame load', () => {
    const { manager, view } = openTab();

    view.handlers.get('did-fail-load')?.({}, -105, 'ERR_NAME_NOT_RESOLVED', CTRIP, true);

    expect(manager.list()[0]).toMatchObject({ failure: 'load-failed', loading: false });
  });

  /**
   * 🔴 ERR_ABORTED 是单页应用内部导航的常态——渠道后台每切一次路由就报一次。
   * 把它算作故障会让故障提示彻底失去意义。
   */
  it('ignores aborted loads and subframe failures', () => {
    const { manager, view } = openTab();

    view.handlers.get('did-fail-load')?.({}, -3, 'ERR_ABORTED', CTRIP, true);
    view.handlers.get('did-fail-load')?.({}, -105, 'ERR_NAME_NOT_RESOLVED', CTRIP, false);

    expect(manager.list()[0].failure).toBeNull();
  });

  it('clears the unresponsive flag when the page recovers', () => {
    const { manager, view } = openTab();

    view.handlers.get('unresponsive')?.();
    expect(manager.list()[0].failure).toBe('unresponsive');

    view.handlers.get('responsive')?.();
    expect(manager.list()[0].failure).toBeNull();
  });

  it('does not let a responsive event clear a crash', () => {
    const { manager, view } = openTab();

    view.handlers.get('render-process-gone')?.({}, { reason: 'crashed' });
    view.handlers.get('responsive')?.();

    expect(manager.list()[0].failure).toBe('crashed');
  });

  it('leaves the failure state when the tab starts loading again', () => {
    const { manager, view } = openTab();
    view.handlers.get('render-process-gone')?.({}, { reason: 'crashed' });

    view.handlers.get('did-start-loading')?.();

    expect(manager.list()[0]).toMatchObject({ failure: null, loading: true });
  });
});

describe('BrowserManager close hand-off', () => {
  const CTRIP = 'https://ebooking.ctrip.com/';

  /**
   * 🔴 关掉活动标签页后主进程曾停在「无活动标签页」，等界面再发一次 activate。
   * 那是一次额外的 IPC 往返（中间一帧空白）；而从别处发起的关闭（切换账号时
   * 收尾旧标签页）根本没有第二次请求，内容区会一直空着。
   */
  it('activates a same-channel neighbour when the active tab closes', () => {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    const second = manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:ctrip:b',
      'ctrip',
      CTRIP,
    );
    const third = manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:ctrip:c',
      'ctrip',
      CTRIP,
    );
    window.contentView.addChildView.mockClear();

    manager.close(third.id);

    expect(window.contentView.addChildView).toHaveBeenCalledWith(electron.views[1]);
    expect(manager.list().map((tab) => tab.id)).not.toContain(third.id);
    expect(second.id).toBeDefined();
  });

  it('does not hand off when the closed tab was not active', () => {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    const first = manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:ctrip:a',
      'ctrip',
      CTRIP,
    );
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:b', 'ctrip', CTRIP);
    window.contentView.addChildView.mockClear();

    manager.close(first.id);

    expect(window.contentView.addChildView).not.toHaveBeenCalled();
  });

  it('leaves the content area empty when the last tab of a channel closes', () => {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    const only = manager.createWithAlreadyPartition(
      'persist:xiaozhi:prod:ctrip:a',
      'ctrip',
      CTRIP,
    );
    window.contentView.addChildView.mockClear();

    manager.close(only.id);

    expect(window.contentView.addChildView).not.toHaveBeenCalled();
    expect(manager.list()).toHaveLength(0);
  });
});

describe('BrowserManager closed-tab silence', () => {
  const CTRIP = 'https://ebooking.ctrip.com/';

  /**
   * 🔴 幽灵标签页：`webContents.close()` 是异步的，实测（Electron 43）关闭后仍会
   * 收到 `did-stop-loading`（页面 unload 处理器里的跳转即可触发），且此刻
   * `isDestroyed()` 仍是 false —— `snapshot()` 不抛，照常广播。
   *
   * 事件回调持有的是闭包里的 tab 对象，从 map 里删掉拦不住它。渲染进程 `updateTab`
   * 对没见过的 id 一律 append 并设为活动标签，于是刚关掉的标签页自己长回标签栏、
   * 还抢走高亮，之后点它必然报「浏览器标签不存在」。
   */
  it('stops broadcasting state for a tab that was already closed', () => {
    const window = createWindow();
    const manager = createBrowserManager(window, createLogger());
    const tab = manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    manager.close(tab.id);
    window.webContents.send.mockClear();

    // 关闭之后迟到的事件
    electron.views[0].handlers.get('did-stop-loading')?.();
    electron.views[0].handlers.get('page-title-updated')?.({}, 'late title');

    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('stops broadcasting navigation for a closed tab', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    const tab = manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    const navigated = vi.fn();
    manager.on('tab:navigated', navigated);
    manager.close(tab.id);

    electron.views[0].handlers.get('did-navigate')?.({}, 'https://ebooking.ctrip.com/late');

    // 订阅方（登录判定）刚在 tab:closed 里清完状态，再来一条会让它为死 tab 重新登记。
    expect(navigated).not.toHaveBeenCalled();
  });
});

describe('BrowserManager failure precedence', () => {
  const CTRIP = 'https://ebooking.ctrip.com/';

  /**
   * 🔴 崩溃被「无响应」覆盖后，随后的 `responsive` 会把它清成 null（那条只认
   * unresponsive）—— 崩溃就此从界面消失，用户只剩一块空白页且没有恢复入口。
   */
  it('does not let unresponsive downgrade a crash', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    const view = electron.views[0];

    view.handlers.get('render-process-gone')?.({}, { reason: 'crashed' });
    view.handlers.get('unresponsive')?.();
    view.handlers.get('responsive')?.();

    expect(manager.list()[0].failure).toBe('crashed');
  });

  it('does not let unresponsive downgrade a load failure', () => {
    const manager = createBrowserManager(createWindow(), createLogger());
    manager.createWithAlreadyPartition('persist:xiaozhi:prod:ctrip:a', 'ctrip', CTRIP);
    const view = electron.views[0];

    view.handlers.get('did-fail-load')?.({}, -105, 'ERR_NAME_NOT_RESOLVED', CTRIP, true);
    view.handlers.get('unresponsive')?.();
    view.handlers.get('responsive')?.();

    expect(manager.list()[0].failure).toBe('load-failed');
  });
});
