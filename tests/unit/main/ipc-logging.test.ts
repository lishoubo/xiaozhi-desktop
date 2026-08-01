import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  return {
    handlers,
    app: {
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
      getVersion: vi.fn(() => '1.0.0'),
      setLoginItemSettings: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(
        (
          channel: string,
          listener: (event: { sender: unknown }, ...args: unknown[]) => unknown,
        ) => {
          handlers.set(channel, listener);
        },
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

vi.mock('electron', () => ({ app: electron.app, ipcMain: electron.ipcMain }));

import { registerBrowserHandlers } from '../../../src/main/ipc/browser-handlers';

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function invoke(channel: string, sender: unknown, ...args: unknown[]): unknown {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing test IPC handler: ${channel}`);
  return handler({ sender }, ...args);
}

beforeEach(() => {
  electron.handlers.clear();
  electron.app.getLoginItemSettings.mockReturnValue({ openAtLogin: false });
  electron.app.setLoginItemSettings.mockClear();
});

describe('IPC operational logging', () => {
  it('warns when an untrusted browser sender is rejected without logging its payload', () => {
    const logger = createLogger();
    const trustedSender = {};
    const acknowledgeInterception = vi.fn();
    registerBrowserHandlers({
      window: { webContents: trustedSender },
      manager: {
        browserSession: { cookies: { set: vi.fn() } },
        acknowledgeInterception,
        activate: vi.fn(),
        close: vi.fn(),
        create: vi.fn(),
        goBack: vi.fn(),
        goForward: vi.fn(),
        hide: vi.fn(),
        list: vi.fn(),
        reload: vi.fn(),
        setBounds: vi.fn(),
      },
      cookieImporter: { listSources: vi.fn(), readCookies: vi.fn() },
      logger,
    });

    expect(() =>
      invoke(IPC_CHANNELS.browser.create, {}, { channelId: 'ctrip', url: 'secret-value' }),
    ).toThrow('拒绝来自非主应用窗口的请求');
    expect(logger.warn).toHaveBeenCalledWith('Rejected untrusted IPC request', {
      channel: IPC_CHANNELS.browser.create,
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-value');

    invoke(IPC_CHANNELS.browser.acknowledgeInterception, trustedSender);
    expect(acknowledgeInterception).toHaveBeenCalledOnce();
  });

  it('records Cookie application counts and auto-launch changes', async () => {
    const logger = createLogger();
    const sender = {};
    const setCookie = vi.fn().mockResolvedValue(undefined);
    registerBrowserHandlers({
      window: { webContents: sender },
      manager: {
        browserSession: { cookies: { set: setCookie } },
        acknowledgeInterception: vi.fn(),
        activate: vi.fn(),
        close: vi.fn(),
        create: vi.fn(),
        goBack: vi.fn(),
        goForward: vi.fn(),
        hide: vi.fn(),
        list: vi.fn(),
        reload: vi.fn(),
        setBounds: vi.fn(),
      },
      cookieImporter: {
        listSources: vi.fn(),
        readCookies: vi.fn().mockResolvedValue({
          cookies: [{ name: 'session', value: 'secret-cookie' }],
          failed: 2,
        }),
      },
      logger,
    });

    await invoke(IPC_CHANNELS.cookies.import, sender, 'firefox');
    invoke(IPC_CHANNELS.system.setAutoLaunch, sender, true);

    expect(logger.info.mock.calls).toEqual([
      ['Cookies applied to browser session', { source: 'firefox', imported: 1, failed: 2 }],
      ['Auto-launch preference changed', { enabled: true }],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret-cookie');
  });
});
