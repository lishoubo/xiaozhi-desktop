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
import type { OtaTabIntent } from '../ota-tab';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

/** handler 声明自己需要什么，由 `OtaTabService` 满足；不 import 实现类。 */
export interface OtaTabOrchestrator {
  openForNewLogin(channel: ChannelId, url: string, intent?: OtaTabIntent): Promise<BrowserTab>;
  openWithImportedCookie(
    channel: ChannelId,
    url: string,
    intent?: OtaTabIntent,
  ): Promise<BrowserTab>;
  openExisting(credentialId: string, intent?: OtaTabIntent): BrowserTab;
  /** 开一份新 partition 并注入原账号 cookie（为什么必须新建见 `OtaTabService`）。 */
  openExistingForBinding(credentialId: string, intent?: OtaTabIntent): Promise<BrowserTab>;
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
    ({ channelId, url }, intent) =>
      service.openForNewLogin(toChannelId(channelId), url, intent ?? undefined),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openWithImportedCookie,
    // intent 同上：可缺省，用 `.default()` 保持元组定长。
    z.tuple([startLoginInputSchema, otaTabIntentSchema.nullish().default(null)]),
    '登录参数无效',
    ({ channelId, url }, intent) =>
      service.openWithImportedCookie(toChannelId(channelId), url, intent ?? undefined),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openExisting,
    // intent 可缺省：不带就是普通打开。用 `.default()` 让校验后的元组保持定长，
    // 免得可选元素把 listener 的形参变成不定参数。
    z.tuple([otaCredentialIdSchema, otaTabIntentSchema.nullish().default(null)]),
    '登录凭据标识无效',
    (credentialId, intent) => service.openExisting(credentialId, intent ?? undefined),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openExistingForBinding,
    z.tuple([otaCredentialIdSchema, otaTabIntentSchema.nullish().default(null)]),
    '登录凭据标识无效',
    (credentialId, intent) => service.openExistingForBinding(credentialId, intent ?? undefined),
  );

  return () => registry.dispose();
}
