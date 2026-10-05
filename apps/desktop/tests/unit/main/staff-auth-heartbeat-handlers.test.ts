import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const registered = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());

vi.mock('../../../src/main/ipc/create-handler-registry', () => ({
  createHandlerRegistry: () => ({
    handle: (
      channel: string,
      _schema: unknown,
      _message: string,
      listener: (...args: unknown[]) => unknown,
    ) => {
      registered.set(channel, listener);
    },
    dispose: () => registered.clear(),
  }),
}));

import { registerStaffAuthHandlers } from '../../../src/main/ipc/staff-auth-handlers';

describe('staff auth heartbeat lifecycle callbacks', () => {
  it('starts after login or session restoration and stops after session loss or logout', async () => {
    registered.clear();
    const identity = {
      userId: 42,
      username: 'staff',
      fullName: 'Staff',
      role: 'STAFF',
      orgId: 1,
      currentHotelId: null,
      accessibleHotelIds: [],
      permissions: [],
    };
    const currentSession = vi.fn().mockResolvedValueOnce(identity).mockResolvedValueOnce(null);
    const onIdentityResolved = vi.fn();
    const onSessionEnded = vi.fn();
    registerStaffAuthHandlers({
      service: {
        currentSession,
        login: vi.fn(async () => identity),
        requestPhoneCode: vi.fn(),
        loginWithPhoneCode: vi.fn(async () => identity),
        logout: vi.fn(async () => ({ success: true as const })),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      window: { webContents: {} },
      onIdentityResolved,
      onSessionEnded,
    });

    await registered.get(IPC_CHANNELS.staffAuth.currentSession)?.();
    await registered.get(IPC_CHANNELS.staffAuth.login)?.('staff', 'secret');
    expect(onIdentityResolved).toHaveBeenCalledTimes(2);

    await registered.get(IPC_CHANNELS.staffAuth.currentSession)?.();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    await registered.get(IPC_CHANNELS.staffAuth.logout)?.();
    expect(onSessionEnded).toHaveBeenCalledTimes(2);
  });
});
