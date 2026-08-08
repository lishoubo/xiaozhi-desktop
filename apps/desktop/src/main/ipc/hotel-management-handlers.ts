import { z } from 'zod';
import {
  rmsHotelCreateInputSchema,
  rmsHotelIdSchema,
  rmsOtaAccountIdSchema,
} from '../../shared/hotel-management';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import type { RmsHotelCreateInput, RmsHotel } from '../../shared/types/rms-hotel';
import type { RmsHotelOtaAccountsSnapshot } from '../services/hotel-management-service';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

export interface HotelManagementOrchestrator {
  load(): Promise<RmsHotelOtaAccountsSnapshot>;
  createHotel(input: RmsHotelCreateInput): Promise<RmsHotel>;
  deleteHotel(hotelId: number): Promise<void>;
  unbindOtaAccount(otaAccountId: number): Promise<void>;
}

type RegisterHotelManagementHandlersOptions = Readonly<{
  window: TrustedWindow;
  feature: HotelManagementOrchestrator;
  logger: AppLogger;
}>;

export function registerHotelManagementHandlers({
  window,
  feature,
  logger,
}: RegisterHotelManagementHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  /** 远端调用失败时记一条带 channel 的日志再原样抛出。 */
  const logFailure = <T>(channel: string, operation: () => Promise<T>): Promise<T> =>
    operation().catch((error: unknown) => {
      logger.error('Hotel management operation failed', {
        operation: channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    });

  registry.handle(IPC_CHANNELS.hotelManagement.load, z.tuple([]), '酒店管理参数无效', () =>
    logFailure(IPC_CHANNELS.hotelManagement.load, () => feature.load()),
  );
  registry.handle(
    IPC_CHANNELS.hotelManagement.createHotel,
    z.tuple([rmsHotelCreateInputSchema]),
    '酒店管理参数无效',
    (input) =>
      logFailure(IPC_CHANNELS.hotelManagement.createHotel, () => feature.createHotel(input)),
  );
  registry.handle(
    IPC_CHANNELS.hotelManagement.deleteHotel,
    z.tuple([rmsHotelIdSchema]),
    '酒店管理参数无效',
    (hotelId) =>
      logFailure(IPC_CHANNELS.hotelManagement.deleteHotel, () => feature.deleteHotel(hotelId)),
  );
  registry.handle(
    IPC_CHANNELS.hotelManagement.unbindOtaAccount,
    z.tuple([rmsOtaAccountIdSchema]),
    '酒店管理参数无效',
    (otaAccountId) =>
      logFailure(IPC_CHANNELS.hotelManagement.unbindOtaAccount, () =>
        feature.unbindOtaAccount(otaAccountId),
      ),
  );

  return () => registry.dispose();
}
