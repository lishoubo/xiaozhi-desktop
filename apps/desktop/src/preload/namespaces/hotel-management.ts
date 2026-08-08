import { z } from 'zod';
import {
  rmsHotelOtaAccountsDtoSchema,
  rmsHotelSchema,
  type RmsHotelCreateInputDto,
} from '../../shared/hotel-management';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

const voidSchema = z.undefined();

export function createHotelManagementApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    load: () => invoke(rmsHotelOtaAccountsDtoSchema, IPC_CHANNELS.hotelManagement.load),
    createHotel: (input: RmsHotelCreateInputDto) =>
      invoke(rmsHotelSchema, IPC_CHANNELS.hotelManagement.createHotel, input),
    deleteHotel: (hotelId: number) =>
      invoke(voidSchema, IPC_CHANNELS.hotelManagement.deleteHotel, hotelId),
    unbindOtaAccount: (otaAccountId: number) =>
      invoke(voidSchema, IPC_CHANNELS.hotelManagement.unbindOtaAccount, otaAccountId),
  });
}
