import { z } from 'zod';
import {
  rmsHotelOtaAccountsDtoSchema,
  rmsHotelSchema,
  rmsOtaAccountSchema,
  type RmsHotelCreateInputDto,
} from '../../shared/hotel-management';
import {
  startBindingResultSchema,
  uiWaitingResultEnvelopeSchema,
  type ConfirmBindingInput,
  type StartBindingInput,
} from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { UiWaitingResultEnvelope } from '../../shared/types/ui-waiting-result-types';
import type { ValidatedInvoke, ValidatedSubscribe } from '../invoke';

const voidSchema = z.undefined();

export function createHotelManagementApi(invoke: ValidatedInvoke, subscribe: ValidatedSubscribe) {
  return Object.freeze({
    load: () => invoke(rmsHotelOtaAccountsDtoSchema, IPC_CHANNELS.hotelManagement.load),
    createHotel: (input: RmsHotelCreateInputDto) =>
      invoke(rmsHotelSchema, IPC_CHANNELS.hotelManagement.createHotel, input),
    deleteHotel: (hotelId: number) =>
      invoke(voidSchema, IPC_CHANNELS.hotelManagement.deleteHotel, hotelId),
    unbindOtaAccount: (otaAccountId: number) =>
      invoke(voidSchema, IPC_CHANNELS.hotelManagement.unbindOtaAccount, otaAccountId),

    /** 发起绑定：返回 requestId，调用方用它登记等待，结果经 `onWaitingResult` 送达。 */
    startBinding: (input: StartBindingInput) =>
      invoke(startBindingResultSchema, IPC_CHANNELS.hotelManagement.startBinding, input),
    /** 用户选定候选后收尾：先远端后本地，任一步失败都会 reject。 */
    confirmBinding: (input: ConfirmBindingInput) =>
      invoke(rmsOtaAccountSchema, IPC_CHANNELS.hotelManagement.confirmBinding, input),
    /** 订阅「UI 在等的结果送达了」。信封里的 requestId 用来认领。 */
    onWaitingResult: (listener: (envelope: UiWaitingResultEnvelope) => void) =>
      subscribe(uiWaitingResultEnvelopeSchema, IPC_CHANNELS.uiWaitingResult.delivered, listener),
  });
}
