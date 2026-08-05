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
});

describe('BrowserManager', () => {
  it('creates secure managed tabs and releases them explicitly', () => {
    const logger = createLogger();
    const window = createWindow();
    const manager = new BrowserManager(window as never, logger);

    const tab = manager.create('ctrip', 'https://ebooking.ctrip.com/');
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
      ['Browser tab created', { channelId: 'ctrip', partitionName: 'persist:hotel-butler-browser' }],
      ['Browser tab closed', { channelId: 'ctrip' }],
    ]);
    expect(electron.views[0].webContents.close).toHaveBeenCalledOnce();
  });

  it('reports page load failures without logging the rejected URL or error message', async () => {
    electron.setNextLoadError(new Error('failed https://private.example/path?token=secret'));
    const logger = createLogger();
    const manager = new BrowserManager(createWindow() as never, logger);

    manager.create('ctrip', 'https://ebooking.ctrip.com/');

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
    manager.create('ctrip', 'https://ebooking.ctrip.com/');
    const preventDefault = vi.fn();

    electron.views[0].handlers.get('will-navigate')?.({ preventDefault }, 'javascript:alert(1)');

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('Blocked invalid browser navigation', {
      channelId: 'ctrip',
    });
  });

  it('blocks matching Ctrip API requests and sends a non-blocking notification event', () => {
    const logger = createLogger();
    const window = createWindow();
    const manager = new BrowserManager(window as never, logger);
    manager.create('ctrip', 'https://ebooking.ctrip.com/');
    const callback = vi.fn();

    expect(electron.browserSession.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['https://m.ctrip.com/restapi/soa2/*'] },
      expect.any(Function),
    );

    electron.getBeforeRequestListener()?.(
      {
        url: 'https://m.ctrip.com/restapi/soa2/12345/json?token=private',
        webContentsId: electron.views[0].webContents.id,
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith({ cancel: true });
    expect(window.contentView.removeChildView).not.toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith('browser:request-intercepted', {
      ruleId: 'ctrip-soa2',
    });
    expect(logger.info).toHaveBeenCalledWith('Embedded browser request intercepted', {
      ruleId: 'ctrip-soa2',
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('token=private');
  });

  it('lets the renderer coalesce concurrent interception events by notification ID', () => {
    const window = createWindow();
    const manager = new BrowserManager(window as never, createLogger());
    manager.create('ctrip', 'https://ebooking.ctrip.com/');
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const webContentsId = electron.views[0].webContents.id;

    electron.getBeforeRequestListener()?.(
      { url: 'https://m.ctrip.com/restapi/soa2/first', webContentsId },
      firstCallback,
    );
    electron.getBeforeRequestListener()?.(
      { url: 'https://m.ctrip.com/restapi/soa2/second', webContentsId },
      secondCallback,
    );

    expect(firstCallback).toHaveBeenCalledWith({ cancel: true });
    expect(secondCallback).toHaveBeenCalledWith({ cancel: true });
    expect(window.webContents.send).toHaveBeenCalledTimes(2);
  });

  it('keeps the active embedded page mounted after request interception', () => {
    const window = createWindow();
    const manager = new BrowserManager(window as never, createLogger());
    manager.create('ctrip', 'https://ebooking.ctrip.com/');
    const webContentsId = electron.views[0].webContents.id;

    electron.getBeforeRequestListener()?.(
      { url: 'https://m.ctrip.com/restapi/soa2/request', webContentsId },
      vi.fn(),
    );
    expect(window.contentView.addChildView).toHaveBeenCalledOnce();
    expect(window.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it('reattaches an active tab when the workspace activates it after being hidden', () => {
    const window = createWindow();
    const manager = new BrowserManager(window as never, createLogger());
    const tab = manager.create('ctrip', 'https://ebooking.ctrip.com/');

    manager.hide();
    manager.activate(tab.id);

    expect(window.contentView.addChildView).toHaveBeenCalledTimes(2);
    expect(window.contentView.addChildView).toHaveBeenLastCalledWith(electron.views[0]);
  });

  it('allows matching requests from the unmanaged background automation view', () => {
    const window = createWindow();
    new BrowserManager(window as never, createLogger());
    const callback = vi.fn();

    electron.getBeforeRequestListener()?.(
      {
        url: 'https://m.ctrip.com/restapi/soa2/background-check-in',
        webContentsId: 999,
      },
      callback,
    );

    expect(callback).toHaveBeenCalledWith({});
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('removes the Ctrip request interceptor when the browser manager is destroyed', () => {
    const manager = new BrowserManager(createWindow() as never, createLogger());

    manager.destroy();

    expect(electron.browserSession.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(
      { urls: ['https://m.ctrip.com/restapi/soa2/*'] },
      null,
    );
  });

  it('routes Cmd+R to the active embedded tab and blocks it outside the browser workspace', () => {
    const window = createWindow();
    const manager = new BrowserManager(window as never, createLogger());
    manager.create('ctrip', 'https://ebooking.ctrip.com/');
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
