import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import {
  rmsHotelCreateInputSchema,
  rmsHotelIdSchema,
  rmsOtaAccountIdSchema,
} from '../../shared/hotel-management';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import type { RmsHotelCreateInput, RmsHotel } from '../../domain/rms-hotel';
import type { RmsHotelOtaAccountsSnapshot } from '../features/hotel-management/hotel-management-feature';

export interface HotelManagementOrchestrator {
  load(): Promise<RmsHotelOtaAccountsSnapshot>;
  createHotel(input: RmsHotelCreateInput): Promise<RmsHotel>;
  deleteHotel(hotelId: number): Promise<void>;
  unbindOtaAccount(otaAccountId: number): Promise<void>;
}

type RegisterHotelManagementHandlersOptions = Readonly<{
  window: Readonly<{ webContents: unknown }>;
  feature: HotelManagementOrchestrator;
  logger: AppLogger;
}>;

export function registerHotelManagementHandlers({
  window,
  feature,
  logger,
}: RegisterHotelManagementHandlersOptions): () => void {
  const channels = Object.values(IPC_CHANNELS.hotelManagement);
  const handle = <Arguments extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<Arguments>,
    listener: (...args: Arguments) => unknown,
  ): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== window.webContents) {
        logger.warn('Rejected untrusted IPC request', { channel });
        throw new Error('拒绝来自非主应用窗口的请求');
      }
      const parsed = argumentsSchema.safeParse(args);
      if (!parsed.success) {
        logger.warn('Rejected invalid IPC request', { channel });
        throw new Error('酒店管理参数无效');
      }
      return Promise.resolve(listener(...parsed.data)).catch((error: unknown) => {
        logger.error('Hotel management operation failed', {
          operation: channel,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw error;
      });
    });
  };

  handle(IPC_CHANNELS.hotelManagement.load, z.tuple([]), () => feature.load());

  handle(IPC_CHANNELS.hotelManagement.createHotel, z.tuple([rmsHotelCreateInputSchema]), (input) =>
    feature.createHotel(input),
  );

  handle(IPC_CHANNELS.hotelManagement.deleteHotel, z.tuple([rmsHotelIdSchema]), (hotelId) =>
    feature.deleteHotel(hotelId),
  );

  handle(
    IPC_CHANNELS.hotelManagement.unbindOtaAccount,
    z.tuple([rmsOtaAccountIdSchema]),
    (otaAccountId) => feature.unbindOtaAccount(otaAccountId),
  );

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
