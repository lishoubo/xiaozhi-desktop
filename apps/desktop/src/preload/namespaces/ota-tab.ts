import { browserTabSchema, type StartLoginInput } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

export function createOtaTabApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    openExisting: (credentialId: string) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openExisting, credentialId),
    openForNewLogin: (input: StartLoginInput) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openForNewLogin, input),
    openWithImportedCookie: (input: StartLoginInput) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openWithImportedCookie, input),
    openView: (channelId: string, url: string) =>
      invoke(browserTabSchema, IPC_CHANNELS.otaTab.openView, { channelId, url }),
  });
}
