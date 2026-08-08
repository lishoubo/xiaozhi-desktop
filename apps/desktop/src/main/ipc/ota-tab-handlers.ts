/**
 * OTA 标签页打开的 4 个 IPC 入口，全部委托 `OtaTabService`。取代原
 * `browser-handlers.ts` 里散落的 `browser.create`/`otaCredential.open*`
 * handler——见 `openspec/changes/refactor-ota-tab-opener/design.md` 决策 4。
 */
import { z } from 'zod';
import {
  otaCredentialIdSchema,
  otaTabIntentSchema,
  startLoginInputSchema,
  type BrowserTab,
} from '../../shared/browser';
import { toChannelId, type ChannelId } from '../ids';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import type { OtaTabIntent, PendingPartition } from '../ota-tab';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

/** handler 声明自己需要什么，由 `OtaTabService` 满足；不 import 实现类。 */
export interface OtaTabOrchestrator {
  open(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
    intent?: OtaTabIntent,
  ): Promise<BrowserTab>;
  createFromCookie(
    environment: PendingPartition['environment'],
    channel: ChannelId,
    url: string,
  ): Promise<BrowserTab>;
  openExisting(credentialId: string, intent?: OtaTabIntent): BrowserTab;
}

type RegisterOtaTabHandlersOptions = Readonly<{
  window: TrustedWindow;
  service: OtaTabOrchestrator;
  logger: AppLogger;
}>;

export function registerOtaTabHandlers({
  window,
  service,
  logger,
}: RegisterOtaTabHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(
    IPC_CHANNELS.otaTab.openForNewLogin,
    // intent 同 openExisting：可缺省，用 `.default()` 保持元组定长。
    z.tuple([startLoginInputSchema, otaTabIntentSchema.nullish().default(null)]),
    '登录参数无效',
    ({ channelId, environment, url }, intent) =>
      service.open(environment, toChannelId(channelId), url, intent ?? undefined),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openWithImportedCookie,
    z.tuple([startLoginInputSchema]),
    '登录参数无效',
    ({ channelId, environment, url }) =>
      service.createFromCookie(environment, toChannelId(channelId), url),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openExisting,
    // intent 可缺省：不带就是普通打开。用 `.default()` 让校验后的元组保持定长，
    // 免得可选元素把 listener 的形参变成不定参数。
    z.tuple([otaCredentialIdSchema, otaTabIntentSchema.nullish().default(null)]),
    '登录凭据标识无效',
    (credentialId, intent) => service.openExisting(credentialId, intent ?? undefined),
  );

  return () => registry.dispose();
}
