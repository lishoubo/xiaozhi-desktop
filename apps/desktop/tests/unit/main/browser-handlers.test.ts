import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { writeImportedCookies } from '../../../src/main/cookie-import/store';

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
import { registerOtaCredentialHandlers } from '../../../src/main/ipc/ota-credential-handlers';
import { CookieImportService } from '../../../src/main/services/cookie-import-service';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function invoke(channel: string, sender: unknown, ...args: unknown[]): unknown {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing test IPC handler: ${channel}`);
  return handler({ sender }, ...args);
}

function baseManager() {
  return {
    acknowledgeInterception: vi.fn(),
    activate: vi.fn(),
    close: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    getAudioMuted: vi.fn(() => false),
    hide: vi.fn(),
    list: vi.fn(),
    reload: vi.fn(),
    setBounds: vi.fn(),
    setAudioMuted: vi.fn((muted: boolean) => muted),
  };
}

describe('browser audio handlers', () => {
  it('reads and updates the single workspace audio state with boolean validation', () => {
    const sender = {};
    const manager = baseManager();
    registerBrowserHandlers({ window: { webContents: sender }, manager, logger: createLogger() });

    expect(invoke(IPC_CHANNELS.browser.getAudioMuted, sender)).toBe(false);
    expect(invoke(IPC_CHANNELS.browser.setAudioMuted, sender, true)).toBe(true);
    expect(manager.setAudioMuted).toHaveBeenCalledWith(true);
    expect(() => invoke(IPC_CHANNELS.browser.setAudioMuted, sender, 'yes')).toThrow('声音状态无效');
  });
});

describe('otaCredential.listByChannel handler', () => {
  it('lists credentials without requiring linked OTA accounts', () => {
    const sender = {};
    const service = {
      listByChannel: vi.fn(() => [
        { id: 'credential-1', channel: toChannelId('ctrip') } as never,
      ]),
    };
    registerOtaCredentialHandlers({
      window: { webContents: sender },
      service,
      logger: createLogger(),
    });

    expect(invoke(IPC_CHANNELS.otaCredential.listByChannel, sender, 'ctrip')).toEqual([
      expect.objectContaining({ id: 'credential-1', channel: 'ctrip' }),
    ]);
    expect(service.listByChannel).toHaveBeenCalledWith(toChannelId('ctrip'));
  });
});

describe('CookieImportService.listImportedChannels', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { force: true, recursive: true });
    }
  });

  function tempUserDataDir(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaozhi-browser-handlers-test-'));
    temporaryDirectories.push(directory);
    return directory;
  }

  it('返回已导入渠道的落盘记录', async () => {
    const userDataDir = tempUserDataDir();
    await writeImportedCookies(
      userDataDir,
      toChannelId('meituan'),
      [{ name: 'a', value: '1' } as never],
      {
        importedAt: '2026-08-05T00:00:00.000Z',
        sourceId: 'chrome',
      },
    );
    const service = new CookieImportService({
      importer: { listSources: vi.fn(), readCookies: vi.fn() } as never,
      userDataDir,
      logger: createLogger(),
    });

    await expect(service.listImportedChannels()).resolves.toEqual([
      { channel: toChannelId('meituan'), importedAt: '2026-08-05T00:00:00.000Z' },
    ]);
  });
});
