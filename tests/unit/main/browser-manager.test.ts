import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const views: MockWebContentsView[] = [];
  let nextLoadError: Error | null = null;
  const browserSession = {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  };

  class MockWebContentsView {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly windowOpenHandler = vi.fn();
    readonly webContents = {
      close: vi.fn(),
      getTitle: vi.fn(() => 'Page title'),
      getURL: vi.fn(() => 'https://example.com/'),
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

function createWindow() {
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };
}

beforeEach(() => {
  electron.views.splice(0);
  electron.session.fromPartition.mockClear();
  electron.browserSession.setPermissionCheckHandler.mockClear();
  electron.browserSession.setPermissionRequestHandler.mockClear();
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
      ['Browser tab created', { channelId: 'ctrip' }],
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
});
