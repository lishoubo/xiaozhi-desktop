import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const sessions = new Map<string, unknown>();
  function createMockSession(partition: string) {
    return {
      partition,
      clearCache: vi.fn().mockResolvedValue(undefined),
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      closeAllConnections: vi.fn().mockResolvedValue(undefined),
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
    };
  }
  return {
    session: {
      fromPartition: vi.fn((partition: string) => {
        const existing = sessions.get(partition);
        if (existing) return existing;
        const created = createMockSession(partition);
        sessions.set(partition, created);
        return created;
      }),
    },
    sessions,
  };
});

vi.mock('electron', () => ({ session: electron.session }));

import { toChannelId } from '../../../src/main/ids';
import { SessionFactory } from '../../../src/main/browser/session-factory';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  electron.sessions.clear();
  electron.session.fromPartition.mockClear();
});

describe('SessionFactory', () => {
  it('sessionForAccount 直接用传入的 partitionName，不重新拼接', () => {
    const factory = new SessionFactory(createLogger());
    factory.sessionForAccount('persist:xiaozhi:prod:douyin:abcd1234');
    expect(electron.session.fromPartition).toHaveBeenCalledWith(
      'persist:xiaozhi:prod:douyin:abcd1234',
    );
  });

  it('sessionForLogin 每次生成不同的 partitionName，并原样返回给调用方', () => {
    const factory = new SessionFactory(createLogger());
    const first = factory.sessionForLogin('prod', toChannelId('douyin'));
    const second = factory.sessionForLogin('prod', toChannelId('douyin'));

    expect(first.partitionName).not.toBe(second.partitionName);
    expect(first.partitionName).toMatch(/^persist:xiaozhi:prod:douyin:/);
    expect(electron.session.fromPartition).toHaveBeenCalledWith(first.partitionName);
  });

  it('相同 partition 名字拿到同一个 session', () => {
    const factory = new SessionFactory(createLogger());
    const a = factory.sessionForAccount('persist:xiaozhi:prod:douyin:abcd1234');
    const b = factory.sessionForAccount('persist:xiaozhi:prod:douyin:abcd1234');
    expect(a).toBe(b);
  });

  /**
   * 安全 handler 是**覆盖式** setter，装第二遍会把第一遍换掉。虽然两次装的是同一个
   * 「全部拒绝」、重复装无害，但这就是 `configuredPartitions` 存在的全部理由 ——
   * 它是「已配置过」的标记表，不是对象池（Session 对象由 Electron 全局持有）。
   */
  it('同一个 partition 的安全 handler 只装一次', () => {
    const factory = new SessionFactory(createLogger());
    const partitionName = 'persist:xiaozhi:prod:douyin:abcd1234';

    factory.sessionForAccount(partitionName);
    factory.sessionForAccount(partitionName);
    factory.sessionForAccount(partitionName);

    const accountSession = electron.sessions.get(partitionName) as {
      setPermissionCheckHandler: ReturnType<typeof vi.fn>;
      setPermissionRequestHandler: ReturnType<typeof vi.fn>;
    };
    expect(accountSession.setPermissionCheckHandler).toHaveBeenCalledOnce();
    expect(accountSession.setPermissionRequestHandler).toHaveBeenCalledOnce();
  });

  it('uses one dedicated persistent partition for the server API cookie jar', () => {
    const factory = new SessionFactory(createLogger());

    const first = factory.sessionForServerApi();
    const second = factory.sessionForServerApi();

    // 断言的是「拿到同一个 jar」这个契约，不是「fromPartition 只被调一次」——
    // 后者是实现细节，且 Electron 本身就保证同名同对象。
    expect(first).toBe(second);
    expect(electron.session.fromPartition).toHaveBeenCalledWith('persist:xiaozhi:server-api');
  });

  it('通过 Electron Session API 清空退休 partition 的存储', async () => {
    const factory = new SessionFactory(createLogger());
    const partitionName = 'persist:xiaozhi:prod:douyin:retired';
    factory.sessionForAccount(partitionName);
    const accountSession = electron.sessions.get(partitionName) as {
      clearCache: ReturnType<typeof vi.fn>;
      clearStorageData: ReturnType<typeof vi.fn>;
      closeAllConnections: ReturnType<typeof vi.fn>;
    };

    await factory.clearAccountSession(partitionName);

    expect(accountSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(accountSession.clearStorageData).toHaveBeenCalledOnce();
    expect(accountSession.clearCache).toHaveBeenCalledOnce();
  });

  /**
   * 清空存储**不销毁 Session 对象**（Electron 没有销毁 API），handler 仍然挂着。
   * 所以「已配置过」这个事实依旧成立，不该撤销标记 —— 撤了只会让下次重复装一遍。
   */
  it('清空存储后不重装安全 handler', async () => {
    const factory = new SessionFactory(createLogger());
    const partitionName = 'persist:xiaozhi:prod:douyin:retired';
    factory.sessionForAccount(partitionName);
    const accountSession = electron.sessions.get(partitionName) as {
      setPermissionCheckHandler: ReturnType<typeof vi.fn>;
    };

    await factory.clearAccountSession(partitionName);
    factory.sessionForAccount(partitionName);

    expect(accountSession.setPermissionCheckHandler).toHaveBeenCalledOnce();
  });
});
