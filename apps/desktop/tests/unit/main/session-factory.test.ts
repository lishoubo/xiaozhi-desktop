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

  it('相同 partition 名字复用同一个 session（缓存命中）', () => {
    const factory = new SessionFactory(createLogger());
    const a = factory.sessionForAccount('persist:xiaozhi:prod:douyin:abcd1234');
    const b = factory.sessionForAccount('persist:xiaozhi:prod:douyin:abcd1234');
    expect(a).toBe(b);
    expect(electron.session.fromPartition).toHaveBeenCalledOnce();
  });

  it('uses one dedicated persistent partition for the server API cookie jar', () => {
    const factory = new SessionFactory(createLogger());

    const first = factory.sessionForServerApi();
    const second = factory.sessionForServerApi();

    expect(first).toBe(second);
    expect(electron.session.fromPartition).toHaveBeenCalledOnce();
    expect(electron.session.fromPartition).toHaveBeenCalledWith('persist:xiaozhi:server-api');
  });

  it('通过 Electron Session API 清空退休 partition 并移出缓存', async () => {
    const factory = new SessionFactory(createLogger());
    const partitionName = 'persist:xiaozhi:prod:douyin:retired';
    factory.sessionForAccount(partitionName);
    const accountSession = electron.sessions.get(partitionName) as {
      clearCache: ReturnType<typeof vi.fn>;
      clearStorageData: ReturnType<typeof vi.fn>;
      closeAllConnections: ReturnType<typeof vi.fn>;
    };

    await factory.clearAccountSession(partitionName);
    factory.sessionForAccount(partitionName);

    expect(accountSession.closeAllConnections).toHaveBeenCalledOnce();
    expect(accountSession.clearStorageData).toHaveBeenCalledOnce();
    expect(accountSession.clearCache).toHaveBeenCalledOnce();
    expect(electron.session.fromPartition).toHaveBeenCalledTimes(2);
  });
});
