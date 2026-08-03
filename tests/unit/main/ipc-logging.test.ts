import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toChannelId } from '../../../src/domain/identity';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const temporaryDirectories: string[] = [];

function temporaryUserDataDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-butler-ipc-logging-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

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
        acknowledgeInterception,
        activate: vi.fn(),
        close: vi.fn(),
        create: vi.fn(),
        createAndNewPartition: vi.fn(),
        goBack: vi.fn(),
        goForward: vi.fn(),
        hide: vi.fn(),
        list: vi.fn(),
        reload: vi.fn(),
        setBounds: vi.fn(),
      },
      cookieImporter: { listSources: vi.fn(), readCookies: vi.fn() },
      logger,
      userDataDir: temporaryUserDataDir(),
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
    registerBrowserHandlers({
      window: { webContents: sender },
      manager: {
        acknowledgeInterception: vi.fn(),
        activate: vi.fn(),
        close: vi.fn(),
        create: vi.fn(),
        createAndNewPartition: vi.fn(),
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
          cookiesByChannel: new Map([
            [toChannelId('douyin'), [{ name: 'session', value: 'secret-cookie' }]],
          ]),
          failed: 2,
        }),
      },
      logger,
      userDataDir: temporaryUserDataDir(),
    });

    await invoke(IPC_CHANNELS.cookies.import, sender, 'firefox');
    invoke(IPC_CHANNELS.system.setAutoLaunch, sender, true);

    expect(logger.info.mock.calls).toEqual([
      ['Cookies imported to disk', { source: 'firefox', channels: 1, imported: 1, failed: 2 }],
      ['Auto-launch preference changed', { enabled: true }],
    ]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret-cookie');
  });

  it('rejects malformed trusted IPC input without exposing its payload or calling the manager', async () => {
    const logger = createLogger();
    const sender = {};
    const create = vi.fn();
    const setBounds = vi.fn();
    const readCookies = vi.fn();
    registerBrowserHandlers({
      window: { webContents: sender },
      manager: {
        acknowledgeInterception: vi.fn(),
        activate: vi.fn(),
        close: vi.fn(),
        create,
        createAndNewPartition: vi.fn(),
        goBack: vi.fn(),
        goForward: vi.fn(),
        hide: vi.fn(),
        list: vi.fn(),
        reload: vi.fn(),
        setBounds,
      },
      cookieImporter: { listSources: vi.fn(), readCookies },
      logger,
      userDataDir: temporaryUserDataDir(),
    });

    expect(() =>
      invoke(IPC_CHANNELS.browser.create, sender, {
        channelId: '',
        url: 'javascript:secret-value',
      }),
    ).toThrow('浏览器参数无效');
    expect(() =>
      invoke(IPC_CHANNELS.browser.setBounds, sender, {
        x: 0,
        y: 0,
        width: Number.NaN,
        height: 600,
      }),
    ).toThrow('浏览器区域尺寸无效');
    expect(() => invoke(IPC_CHANNELS.cookies.import, sender, 'unknown-browser')).toThrow(
      '浏览器类型无效',
    );

    expect(create).not.toHaveBeenCalled();
    expect(setBounds).not.toHaveBeenCalled();
    expect(readCookies).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls).toEqual([
      ['Rejected invalid IPC request', { channel: IPC_CHANNELS.browser.create }],
      ['Rejected invalid IPC request', { channel: IPC_CHANNELS.browser.setBounds }],
      ['Rejected invalid IPC request', { channel: IPC_CHANNELS.cookies.import }],
    ]);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('unknown-browser');
  });
});
