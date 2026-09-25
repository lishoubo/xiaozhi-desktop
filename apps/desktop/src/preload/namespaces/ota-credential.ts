import {
  otaCredentialExpiryScannedEventSchema,
  otaCredentialListSchema,
  otaDiscoveryCompletedEventSchema,
  type OtaCredentialExpiryScannedEvent,
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
    /** 定时扫描每轮的登录失效汇总。没有反向调用 —— 提醒只告知，重新登录由用户自己做。 */
    onExpiryScanned: (listener: (event: OtaCredentialExpiryScannedEvent) => void) =>
      subscribe(
        otaCredentialExpiryScannedEventSchema,
        IPC_CHANNELS.otaCredential.expiryScanned,
        listener,
      ),
  });
}
