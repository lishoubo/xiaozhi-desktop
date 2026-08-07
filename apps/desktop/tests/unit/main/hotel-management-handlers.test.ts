import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn(
        (channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => unknown) =>
          handlers.set(channel, listener),
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { registerHotelManagementHandlers } from '../../../src/main/ipc/hotel-management-handlers';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function invoke(channel: string, sender: unknown, ...args: unknown[]): unknown {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing test IPC handler: ${channel}`);
  return handler({ sender }, ...args);
}

beforeEach(() => electron.handlers.clear());

describe('hotel management IPC handlers', () => {
  it('maps trusted validated requests to the feature and propagates remote results', async () => {
    const sender = {};
    const logger = createLogger();
    const snapshot = { hotels: [{ id: 1, name: '示例酒店', status: 1 }], otaAccounts: [] };
    const createdHotel = { id: 2, name: '新酒店', status: 1 };
    const feature = {
      load: vi.fn(async () => snapshot),
      createHotel: vi.fn(async () => createdHotel),
      deleteHotel: vi.fn(async () => undefined),
      unbindOtaAccount: vi.fn(async () => undefined),
    };
    registerHotelManagementHandlers({ window: { webContents: sender }, feature, logger });

    await expect(invoke(IPC_CHANNELS.hotelManagement.load, sender)).resolves.toEqual(snapshot);
    await expect(
      invoke(IPC_CHANNELS.hotelManagement.createHotel, sender, { name: '新酒店' }),
    ).resolves.toEqual(createdHotel);
    await expect(
      invoke(IPC_CHANNELS.hotelManagement.deleteHotel, sender, 1),
    ).resolves.toBeUndefined();
    await expect(
      invoke(IPC_CHANNELS.hotelManagement.unbindOtaAccount, sender, 30101),
    ).resolves.toBeUndefined();
    expect(feature.deleteHotel).toHaveBeenCalledWith(1);
    expect(feature.unbindOtaAccount).toHaveBeenCalledWith(30101);
  });

  it('propagates remote rejection from deleteHotel without swallowing it', async () => {
    const sender = {};
    const logger = createLogger();
    const feature = {
      load: vi.fn(),
      createHotel: vi.fn(),
      deleteHotel: vi.fn(async () => {
        throw new Error('远端拒绝：存在关联 OTA 账号');
      }),
      unbindOtaAccount: vi.fn(),
    };
    registerHotelManagementHandlers({ window: { webContents: sender }, feature, logger });

    await expect(invoke(IPC_CHANNELS.hotelManagement.deleteHotel, sender, 1)).rejects.toThrow(
      '远端拒绝：存在关联 OTA 账号',
    );
  });

  it('rejects untrusted senders and malformed input without calling the feature', () => {
    const sender = {};
    const logger = createLogger();
    const feature = {
      load: vi.fn(),
      createHotel: vi.fn(),
      deleteHotel: vi.fn(),
      unbindOtaAccount: vi.fn(),
    };
    registerHotelManagementHandlers({ window: { webContents: sender }, feature, logger });

    expect(() => invoke(IPC_CHANNELS.hotelManagement.load, {})).toThrow(
      '拒绝来自非主应用窗口的请求',
    );
    expect(() => invoke(IPC_CHANNELS.hotelManagement.createHotel, sender, { name: '' })).toThrow(
      '酒店管理参数无效',
    );
    expect(() => invoke(IPC_CHANNELS.hotelManagement.deleteHotel, sender, -1)).toThrow(
      '酒店管理参数无效',
    );
    expect(feature.createHotel).not.toHaveBeenCalled();
    expect(feature.deleteHotel).not.toHaveBeenCalled();
  });
});
