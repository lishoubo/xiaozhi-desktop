import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const electron = vi.hoisted(() => {
  const handlers = new Map<
    string,
    (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown>
  >();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn(
        (
          channel: string,
          listener: (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown>,
        ) => handlers.set(channel, listener),
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { registerAuthHandlers } from '../../../src/main/ipc/auth-handlers';
import { AuthService } from '../../../src/main/services/auth-service';

const employee = {
  id: '2',
  orgId: '42',
  username: 'desktop-demo',
  fullName: '桌面体验员工',
  phone: '13800138000',
  roleCode: 'FRONT_DESK',
} as const;

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * 真实的 `ipcMain.handle` 会把 listener 的同步抛出也转成 rejected promise，
 * 这里用 `Promise.resolve().then(...)` 复现该语义，否则同步抛出的校验错误会
 * 直接冒泡而不是变成 rejection。
 */
function invoke(channel: string, sender: unknown, ...args: unknown[]): Promise<unknown> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing test IPC handler: ${channel}`);
  return Promise.resolve().then(() => handler({ sender }, ...args));
}

function setup() {
  const sender = {};
  const remove = vi.fn().mockResolvedValue(undefined);
  const client = {
    system: {
      health: {
        query: vi.fn().mockResolvedValue({
          status: 'ok',
          authentication: {
            staff: true,
            phone: true,
            phoneIdentitySourceConfigured: true,
          },
        }),
      },
    },
    auth: {
      currentSession: { query: vi.fn().mockResolvedValue(employee) },
      loginWithPhoneCode: { mutate: vi.fn().mockResolvedValue(employee) },
      logout: { mutate: vi.fn().mockResolvedValue({ success: true }) },
      requestPhoneCode: {
        mutate: vi.fn().mockResolvedValue({ accepted: true, expiresInSeconds: 300 }),
      },
    },
  };
  const logger = createLogger();
  registerAuthHandlers({
    service: new AuthService({
      apiSession: { cookies: { remove } },
      client: client as never,
      logger,
      serverOrigin: 'https://localhost:5173',
    }),
    logger,
    window: { webContents: sender },
  });
  return { client, logger, remove, sender };
}

beforeEach(() => electron.handlers.clear());

describe('auth IPC handlers', () => {
  it('maps trusted validated auth operations to the typed server client', async () => {
    const { client, remove, sender } = setup();

    await expect(invoke(IPC_CHANNELS.auth.currentSession, sender)).resolves.toEqual(employee);
    await expect(
      invoke(IPC_CHANNELS.auth.requestPhoneCode, sender, '13800138000'),
    ).resolves.toEqual({ accepted: true, expiresInSeconds: 300 });
    await expect(
      invoke(IPC_CHANNELS.auth.loginWithPhoneCode, sender, '13800138000', '654321'),
    ).resolves.toEqual(employee);
    await expect(invoke(IPC_CHANNELS.auth.logout, sender)).resolves.toEqual({ success: true });

    expect(client.auth.requestPhoneCode.mutate).toHaveBeenCalledWith({ phone: '13800138000' });
    expect(client.auth.loginWithPhoneCode.mutate).toHaveBeenCalledWith({
      phone: '13800138000',
      code: '654321',
    });
    expect(remove).toHaveBeenCalledWith('https://localhost:5173', '__Host-xiaozhi_desktop_session');
  });

  // 信任校验由 create-handler-registry.test.ts 覆盖；这里只留登录入参自身的约束。
  it('rejects a malformed phone/code pair without forwarding it to the server', async () => {
    const { client, sender } = setup();

    await expect(
      invoke(IPC_CHANNELS.auth.loginWithPhoneCode, sender, 'private-phone', 'secret'),
    ).rejects.toThrow('登录参数无效');
    expect(client.auth.loginWithPhoneCode.mutate).not.toHaveBeenCalled();
  });

  it('clears the local cookie even when remote logout fails', async () => {
    const { client, remove, sender } = setup();
    client.auth.logout.mutate.mockRejectedValue(new Error('server unavailable'));

    await expect(invoke(IPC_CHANNELS.auth.logout, sender)).rejects.toThrow('退出登录失败，请重试');
    expect(remove).toHaveBeenCalledOnce();
  });

  it('explains an unconfigured phone identity source before requesting a code', async () => {
    const { client, logger, sender } = setup();
    client.system.health.query.mockResolvedValue({
      status: 'ok',
      authentication: {
        staff: true,
        phone: true,
        phoneIdentitySourceConfigured: false,
      },
    });

    await expect(invoke(IPC_CHANNELS.auth.requestPhoneCode, sender, '13800138000')).rejects.toThrow(
      '当前服务器未配置手机号身份数据源，请联系管理员',
    );
    expect(client.auth.requestPhoneCode.mutate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'Desktop authentication operation failed',
      expect.objectContaining({
        operation: 'phone-capabilities',
        error: expect.objectContaining({
          name: 'Error',
          message: '当前服务器未配置手机号身份数据源，请联系管理员',
          stack: expect.stringContaining('当前服务器未配置手机号身份数据源，请联系管理员'),
        }),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('13800138000');
  });

  it('records the original remote error stack while returning the friendly request-code error', async () => {
    const { client, logger, sender } = setup();
    client.auth.requestPhoneCode.mutate.mockRejectedValue(new Error('socket disconnected'));

    await expect(invoke(IPC_CHANNELS.auth.requestPhoneCode, sender, '13800138000')).rejects.toThrow(
      '验证码发送失败，请重试',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Desktop authentication operation failed',
      expect.objectContaining({
        operation: 'request-code',
        error: expect.objectContaining({
          name: 'Error',
          message: 'socket disconnected',
          stack: expect.stringContaining('socket disconnected'),
        }),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('13800138000');
  });
});
