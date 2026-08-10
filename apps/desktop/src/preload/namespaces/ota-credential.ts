import {
  otaCredentialListSchema,
  otaDiscoveryCompletedEventSchema,
  type OtaDiscoveryCompletedEvent,
} from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke, ValidatedSubscribe } from '../invoke';

export function createOtaCredentialApi(invoke: ValidatedInvoke, subscribe: ValidatedSubscribe) {
  return Object.freeze({
    listByChannel: (channelId: string) =>
      invoke(otaCredentialListSchema, IPC_CHANNELS.otaCredential.listByChannel, channelId),
    onDiscoveryCompleted: (listener: (event: OtaDiscoveryCompletedEvent) => void) =>
      subscribe(
        otaDiscoveryCompletedEventSchema,
        IPC_CHANNELS.otaCredential.discoveryCompleted,
        listener,
      ),
  });
}
