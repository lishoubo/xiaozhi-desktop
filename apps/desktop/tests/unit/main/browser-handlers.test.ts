import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  toChannelId,
  toOtaAccountId,
  toOtaCredentialId,
  toOtaHotelId,
} from '../../../src/domain/identity';
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
    create: vi.fn(),
    createAndNewPartition: vi.fn(),
    createWithAlreadyPartition: vi.fn(),
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

function credentialRepository(
  partitionName = 'persist:xiaozhi:prod:douyin:short',
  channel = toChannelId('douyin'),
) {
  return {
    listByChannel: vi.fn((requestedChannel) =>
      requestedChannel === channel
        ? [
            {
              id: toOtaCredentialId('credential-1'),
              channel,
              channelAccountId: null,
              partitionName,
              credentialExtra: null,
              discoveredAt: 1,
              lastRefreshedAt: null,
            },
          ]
        : [],
    ),
    findById: vi.fn((id) =>
      id === toOtaCredentialId('credential-1')
        ? {
            id: toOtaCredentialId('credential-1'),
            channel,
            channelAccountId: null,
            partitionName,
            credentialExtra: null,
            discoveredAt: 1,
            lastRefreshedAt: null,
          }
        : null,
    ),
  };
}

describe('browser audio handlers', () => {
  it('reads and updates the single workspace audio state with boolean validation', () => {
    const sender = {};
    const manager = baseManager();
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository: { listByChannel: vi.fn(() => []), findById: vi.fn(() => null) },
      otaCredentialRepository: credentialRepository(),
    });

    expect(invoke(IPC_CHANNELS.browser.getAudioMuted, sender)).toBe(false);
    expect(invoke(IPC_CHANNELS.browser.setAudioMuted, sender, true)).toBe(true);
    expect(manager.setAudioMuted).toHaveBeenCalledWith(true);
    expect(() => invoke(IPC_CHANNELS.browser.setAudioMuted, sender, 'yes')).toThrow('声音状态无效');
  });
});

describe('otaAccount.listByChannel / openExisting handlers', () => {
  it('listByChannel 透传 repository 结果', () => {
    const sender = {};
    const accounts = [
      {
        id: toOtaAccountId('a1'),
        credentialId: toOtaCredentialId('credential-1'),
        channel: toChannelId('douyin'),
        otaHotelId: toOtaHotelId('dy-1'),
        otaHotelName: '门店A',
        bindExtra: { merchantGroupId: 'group-1' },
        discoveredAt: 1000,
      },
    ];
    const otaAccountRepository = {
      listByChannel: vi.fn(() => accounts),
      findById: vi.fn(() => null),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager: baseManager(),
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository(),
    });

    const result = invoke(IPC_CHANNELS.otaAccount.listByChannel, sender, 'douyin');

    expect(otaAccountRepository.listByChannel).toHaveBeenCalledWith(toChannelId('douyin'));
    expect(result).toEqual([
      {
        ...accounts[0],
        partitionName: 'persist:xiaozhi:prod:douyin:short',
      },
    ]);
  });

  it('openExisting 对抖音账号拼出带 groupid 的落地 URL 并调用 createWithAlreadyPartition', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a1'),
      credentialId: toOtaCredentialId('credential-1'),
      channel: toChannelId('douyin'),
      otaHotelId: toOtaHotelId('dy-1'),
      otaHotelName: '门店A',
      bindExtra: { merchantGroupId: 'group-1' },
      discoveredAt: 1000,
    };
    const manager = baseManager();
    const otaAccountRepository = {
      listByChannel: vi.fn(() => []),
      findById: vi.fn(() => account),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository(),
    });

    invoke(IPC_CHANNELS.otaAccount.openExisting, sender, 'a1');

    expect(otaAccountRepository.findById).toHaveBeenCalledWith(toOtaAccountId('a1'));
    expect(manager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:douyin:short',
      'douyin',
      'https://life.douyin.com/p/home?groupid=group-1',
    );
  });

  it('openExisting 对携程账号使用渠道默认落地 URL', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a2'),
      credentialId: toOtaCredentialId('credential-1'),
      channel: toChannelId('ctrip'),
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '测试酒店',
      bindExtra: null,
      discoveredAt: 2000,
    };
    const manager = baseManager();
    const otaAccountRepository = {
      listByChannel: vi.fn(() => []),
      findById: vi.fn(() => account),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository(
        'persist:xiaozhi:prod:ctrip:short',
        toChannelId('ctrip'),
      ),
    });

    invoke(IPC_CHANNELS.otaAccount.openExisting, sender, 'a2');

    expect(manager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:ctrip:short',
      'ctrip',
      'https://ebooking.ctrip.com/home/mainland',
    );
  });

  it('openExisting 对 bindExtra 缺失的抖音账号退化到不带 groupid 的落地 URL，而不是报错', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a3'),
      credentialId: toOtaCredentialId('credential-1'),
      channel: toChannelId('douyin'),
      otaHotelId: toOtaHotelId('dy-2'),
      otaHotelName: '门店B',
      bindExtra: null,
      discoveredAt: 3000,
    };
    const manager = baseManager();
    const otaAccountRepository = {
      listByChannel: vi.fn(() => []),
      findById: vi.fn(() => account),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository('persist:xiaozhi:prod:douyin:short2'),
    });

    invoke(IPC_CHANNELS.otaAccount.openExisting, sender, 'a3');

    expect(manager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:douyin:short2',
      'douyin',
      'https://life.douyin.com/p/home',
    );
  });

  it('openExisting 对不存在的账号 id 抛错', () => {
    const sender = {};
    const otaAccountRepository = {
      listByChannel: vi.fn(() => []),
      findById: vi.fn(() => null),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager: baseManager(),
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository(),
    });

    expect(() => invoke(IPC_CHANNELS.otaAccount.openExisting, sender, 'missing')).toThrow(
      '未找到该账号',
    );
  });

  it('openExisting 对缺失 credential 的账号明确报错且不创建临时 partition', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a1'),
      credentialId: toOtaCredentialId('credential-1'),
      channel: toChannelId('douyin'),
      otaHotelId: toOtaHotelId('dy-1'),
      otaHotelName: '门店A',
      bindExtra: { merchantGroupId: 'group-1' },
      discoveredAt: 1000,
    };
    const manager = baseManager();
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository: {
        listByChannel: vi.fn(() => []),
        findById: vi.fn(() => account),
      },
      otaCredentialRepository: {
        listByChannel: vi.fn(() => []),
        findById: vi.fn(() => null),
      },
    });

    expect(() => invoke(IPC_CHANNELS.otaAccount.openExisting, sender, 'a1')).toThrow(
      'credential credential-1 不存在',
    );
    expect(manager.createWithAlreadyPartition).not.toHaveBeenCalled();
  });
});

describe('otaCredential.listByChannel / openExisting handlers', () => {
  it('lists credentials without requiring linked OTA accounts and opens the default channel URL', () => {
    const sender = {};
    const manager = baseManager();
    const otaCredentialRepository = credentialRepository(
      'persist:xiaozhi:prod:ctrip:credential-only',
      toChannelId('ctrip'),
    );
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository: { listByChannel: vi.fn(() => []), findById: vi.fn(() => null) },
      otaCredentialRepository,
    });

    expect(invoke(IPC_CHANNELS.otaCredential.listByChannel, sender, 'ctrip')).toEqual([
      expect.objectContaining({ id: 'credential-1', channel: 'ctrip' }),
    ]);
    invoke(IPC_CHANNELS.otaCredential.openExisting, sender, 'credential-1');

    expect(manager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:ctrip:credential-only',
      'ctrip',
      'https://ebooking.ctrip.com/home/mainland',
    );
  });
});

describe('otaAccount.createFromExistingSession handler', () => {
  it('对抖音账号复用其 partition，挂载 loginUrlMatcher/onUrlPastLogin，落地到不带 groupid 的首页', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a1'),
      credentialId: toOtaCredentialId('credential-1'),
      channel: toChannelId('douyin'),
      otaHotelId: toOtaHotelId('dy-1'),
      otaHotelName: '门店A',
      bindExtra: { merchantGroupId: 'group-1' },
      discoveredAt: 1000,
    };
    const manager = baseManager();
    const matcher = { channel: toChannelId('douyin'), isPastLogin: () => true };
    const otaAccountRepository = {
      listByChannel: vi.fn(() => []),
      findById: vi.fn(() => account),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map([[toChannelId('douyin'), matcher]]),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository(),
    });

    invoke(IPC_CHANNELS.otaAccount.createFromExistingSession, sender, { accountId: 'a1' });

    expect(manager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:douyin:short',
      'douyin',
      'https://life.douyin.com/p/home',
      expect.objectContaining({ loginUrlMatcher: matcher, onUrlPastLogin: expect.any(Function) }),
    );
  });

  it('对携程账号拒绝：该渠道不支持从其他登录态创建账号', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a2'),
      credentialId: toOtaCredentialId('credential-1'),
      channel: toChannelId('ctrip'),
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '测试酒店',
      bindExtra: null,
      discoveredAt: 2000,
    };
    const manager = baseManager();
    const otaAccountRepository = {
      listByChannel: vi.fn(() => []),
      findById: vi.fn(() => account),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager,
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository(
        'persist:xiaozhi:prod:ctrip:short',
        toChannelId('ctrip'),
      ),
    });

    expect(() =>
      invoke(IPC_CHANNELS.otaAccount.createFromExistingSession, sender, { accountId: 'a2' }),
    ).toThrow('该渠道不支持从其他登录态创建账号');
    expect(manager.createWithAlreadyPartition).not.toHaveBeenCalled();
  });

  it('对不存在的账号 id 抛错', () => {
    const sender = {};
    const otaAccountRepository = {
      listByChannel: vi.fn(() => []),
      findById: vi.fn(() => null),
    };
    registerBrowserHandlers({
      window: { webContents: sender },
      manager: baseManager(),
      logger: createLogger(),
      userDataDir: '/tmp/does-not-matter',
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository,
      otaCredentialRepository: credentialRepository(),
    });

    expect(() =>
      invoke(IPC_CHANNELS.otaAccount.createFromExistingSession, sender, { accountId: 'missing' }),
    ).toThrow('未找到该账号');
  });
});

describe('cookies.listImportedChannels handler', () => {
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

  it('透传 listImportedChannels 的查询结果', async () => {
    const sender = {};
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
    registerBrowserHandlers({
      window: { webContents: sender },
      manager: baseManager(),
      logger: createLogger(),
      userDataDir,
      loginUrlMatchers: new Map(),
      triggerDiscovery: vi.fn(),
      otaAccountRepository: { listByChannel: vi.fn(() => []), findById: vi.fn(() => null) },
      otaCredentialRepository: credentialRepository(),
    });

    const result = await invoke(IPC_CHANNELS.cookies.listImportedChannels, sender);

    expect(result).toEqual([
      { channel: toChannelId('meituan'), importedAt: '2026-08-05T00:00:00.000Z' },
    ]);
  });
});
