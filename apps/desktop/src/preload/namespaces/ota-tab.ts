import { browserTabSchema, type OtaTabIntentDto, type StartLoginInput } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

export function createOtaTabApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    /** `intent` 说明这次打开是为了做什么；不带则只是普通打开。 */
    openExisting: (credentialId: string, intent?: OtaTabIntentDto) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openExisting, credentialId, intent),
    /** `intent` 同 `openExisting`：绑定入口的「新登录账号」带意图走这条路。 */
    openForNewLogin: (input: StartLoginInput, intent?: OtaTabIntentDto) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openForNewLogin, input, intent),
    openWithImportedCookie: (input: StartLoginInput) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openWithImportedCookie, input),
  });
}
