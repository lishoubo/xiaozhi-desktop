import { z } from 'zod';
import { otaCredentialChannelSchema } from '../../shared/browser';
import { toChannelId, type ChannelId } from '../../domain/identity';
import type { OtaCredential } from '../../domain/ota-credential';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

/** handler 声明自己需要什么，由 `OtaCredentialService` 满足；不 import 实现类。 */
export interface OtaCredentialOrchestrator {
  listByChannel(channel: ChannelId): readonly OtaCredential[];
}

type RegisterOtaCredentialHandlersOptions = Readonly<{
  window: TrustedWindow;
  service: OtaCredentialOrchestrator;
  logger: AppLogger;
}>;

export function registerOtaCredentialHandlers({
  window,
  service,
  logger,
}: RegisterOtaCredentialHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(
    IPC_CHANNELS.otaCredential.listByChannel,
    z.tuple([otaCredentialChannelSchema]),
    '渠道标识无效',
    (channelId) => service.listByChannel(toChannelId(channelId)),
  );

  return () => registry.dispose();
}
