import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaAccountId, toOtaHotelId } from '../../../src/domain/identity';
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
    hide: vi.fn(),
    list: vi.fn(),
    reload: vi.fn(),
    setBounds: vi.fn(),
  };
}

describe('otaAccount.listByChannel / openExisting handlers', () => {
  it('listByChannel 透传 repository 结果', () => {
    const sender = {};
    const accounts = [
      {
        id: toOtaAccountId('a1'),
        channel: toChannelId('douyin'),
        otaHotelId: toOtaHotelId('dy-1'),
        otaHotelName: '门店A',
        partitionName: 'persist:xiaozhi:prod:douyin:short',
        channelContext: 'group-1',
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
    });

    const result = invoke(IPC_CHANNELS.otaAccount.listByChannel, sender, 'douyin');

    expect(otaAccountRepository.listByChannel).toHaveBeenCalledWith(toChannelId('douyin'));
    expect(result).toBe(accounts);
  });

  it('openExisting 对抖音账号拼出带 groupid 的落地 URL 并调用 createWithAlreadyPartition', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a1'),
      channel: toChannelId('douyin'),
      otaHotelId: toOtaHotelId('dy-1'),
      otaHotelName: '门店A',
      partitionName: 'persist:xiaozhi:prod:douyin:short',
      channelContext: 'group-1',
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
      channel: toChannelId('ctrip'),
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '测试酒店',
      partitionName: 'persist:xiaozhi:prod:ctrip:short',
      channelContext: null,
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
    });

    invoke(IPC_CHANNELS.otaAccount.openExisting, sender, 'a2');

    expect(manager.createWithAlreadyPartition).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:ctrip:short',
      'ctrip',
      'https://ebooking.ctrip.com/home/mainland',
    );
  });

  it('openExisting 对 channelContext 缺失的抖音账号退化到不带 groupid 的落地 URL，而不是报错', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a3'),
      channel: toChannelId('douyin'),
      otaHotelId: toOtaHotelId('dy-2'),
      otaHotelName: '门店B',
      partitionName: 'persist:xiaozhi:prod:douyin:short2',
      channelContext: null,
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
    });

    expect(() => invoke(IPC_CHANNELS.otaAccount.openExisting, sender, 'missing')).toThrow(
      '未找到该账号',
    );
  });
});

describe('otaAccount.createFromExistingSession handler', () => {
  it('对抖音账号复用其 partition，挂载 loginUrlMatcher/onUrlPastLogin，落地到不带 groupid 的首页', () => {
    const sender = {};
    const account = {
      id: toOtaAccountId('a1'),
      channel: toChannelId('douyin'),
      otaHotelId: toOtaHotelId('dy-1'),
      otaHotelName: '门店A',
      partitionName: 'persist:xiaozhi:prod:douyin:short',
      channelContext: 'group-1',
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
      channel: toChannelId('ctrip'),
      otaHotelId: toOtaHotelId('12345'),
      otaHotelName: '测试酒店',
      partitionName: 'persist:xiaozhi:prod:ctrip:short',
      channelContext: null,
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
    });

    expect(() =>
      invoke(IPC_CHANNELS.otaAccount.createFromExistingSession, sender, { accountId: 'missing' }),
    ).toThrow('未找到该账号');
  });
});
