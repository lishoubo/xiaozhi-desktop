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
    const manager = new BrowserManager(createWindow() as never, createLogger());
    manager.createWithAlreadyPartition('persist:test-shared', 'ctrip', 'https://ebooking.ctrip.com/');
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
    const manager = new BrowserManager(createWindow() as never, logger);
    manager.createWithAlreadyPartition('persist:test-shared', 'ctrip', 'https://ebooking.ctrip.com/');
    manager.createWithAlreadyPartition('persist:test-shared', 'douyin', 'https://life.douyin.com/p/home');
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
    const manager = new BrowserManager(window as never, logger);

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
    const manager = new BrowserManager(createWindow() as never, createLogger());
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
    const manager = new BrowserManager(createWindow() as never, logger);

    manager.createWithAlreadyPartition('persist:test-shared', 'ctrip', 'https://ebooking.ctrip.com/');

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
    const manager = new BrowserManager(createWindow() as never, logger);
    manager.createWithAlreadyPartition('persist:test-shared', 'ctrip', 'https://ebooking.ctrip.com/');
    const preventDefault = vi.fn();

    electron.views[0].handlers.get('will-navigate')?.({ preventDefault }, 'javascript:alert(1)');

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('Blocked invalid browser navigation', {
      channelId: 'ctrip',
    });
  });




  it('reattaches an active tab when the workspace activates it after being hidden', () => {
    const window = createWindow();
    const manager = new BrowserManager(window as never, createLogger());
    const tab = manager.createWithAlreadyPartition('persist:test-shared', 'ctrip', 'https://ebooking.ctrip.com/');

    manager.hide();
    manager.activate(tab.id);

    expect(window.contentView.addChildView).toHaveBeenCalledTimes(2);
    expect(window.contentView.addChildView).toHaveBeenLastCalledWith(electron.views[0]);
  });



  it('routes Cmd+R to the active embedded tab and blocks it outside the browser workspace', () => {
    const window = createWindow();
    const manager = new BrowserManager(window as never, createLogger());
    manager.createWithAlreadyPartition('persist:test-shared', 'ctrip', 'https://ebooking.ctrip.com/');
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
    new BrowserManager(window as never, createLogger());
    const preventDefault = vi.fn();

    window.handlers.get('before-input-event')?.(
      { preventDefault },
      { type: 'keyDown', key: 'f', meta: true, control: false, alt: false },
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
