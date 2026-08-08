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
  type ConfirmReauthInput,
  type FindCredentialForAccountInput,
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

    /**
     * 发起绑定：只取号。标签页由调用方自己经 `otaTab.openExisting` 打开并带上
     * 意图，结果经 `onWaitingResult` 按 requestId 送达。
     */
    startBinding: () =>
      invoke(startBindingResultSchema, IPC_CHANNELS.hotelManagement.startBinding),
    /** 用户选定候选后收尾：先远端后本地，任一步失败都会 reject。 */
    confirmBinding: (input: ConfirmBindingInput) =>
      invoke(rmsOtaAccountSchema, IPC_CHANNELS.hotelManagement.confirmBinding, input),
    /** 发起重新登录：同 `startBinding`，只取号。 */
    startReauth: () => invoke(startBindingResultSchema, IPC_CHANNELS.hotelManagement.startReauth),
    /** 账号身份核对通过后收尾：只换凭证，不动门店关系。 */
    confirmReauth: (input: ConfirmReauthInput) =>
      invoke(rmsOtaAccountSchema, IPC_CHANNELS.hotelManagement.confirmReauth, input),
    /** 查「这条远端绑定当初是哪个本地凭证建的」；找不到返回 null，不是错误。 */
    findCredentialForAccount: (input: FindCredentialForAccountInput) =>
      invoke(
        z.string().nullable(),
        IPC_CHANNELS.hotelManagement.findCredentialForAccount,
        input,
      ),
    /** 订阅「UI 在等的结果送达了」。信封里的 requestId 用来认领。 */
    onWaitingResult: (listener: (envelope: UiWaitingResultEnvelope) => void) =>
      subscribe(uiWaitingResultEnvelopeSchema, IPC_CHANNELS.uiWaitingResult.delivered, listener),
  });
}
