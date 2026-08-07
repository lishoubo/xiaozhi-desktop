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

function invoke(channel: string, sender: unknown, ...args: unknown[]): Promise<unknown> {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing test IPC handler: ${channel}`);
  return handler({ sender }, ...args);
}

function setup() {
  const sender = {};
  const remove = vi.fn().mockResolvedValue(undefined);
  const client = {
    auth: {
      currentSession: { query: vi.fn().mockResolvedValue(employee) },
      loginWithPhoneCode: { mutate: vi.fn().mockResolvedValue(employee) },
      logout: { mutate: vi.fn().mockResolvedValue({ success: true }) },
      requestPhoneCode: {
        mutate: vi.fn().mockResolvedValue({ accepted: true, expiresInSeconds: 300 }),
      },
    },
  };
  registerAuthHandlers({
    apiSession: { cookies: { remove } },
    client,
    logger: createLogger(),
    serverOrigin: 'https://localhost:5173',
    window: { webContents: sender },
  });
  return { client, remove, sender };
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

  it('rejects untrusted or malformed auth requests without disclosing inputs in logs', async () => {
    const { client, sender } = setup();

    await expect(invoke(IPC_CHANNELS.auth.currentSession, {})).rejects.toThrow(
      '拒绝来自非主应用窗口的请求',
    );
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
});
