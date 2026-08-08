/**
 * OTA 标签页打开的 4 个 IPC 入口，全部委托 `OtaTabOpener`。取代原
 * `browser-handlers.ts` 里散落的 `browser.create`/`otaCredential.open*`
 * handler——见 `openspec/changes/refactor-ota-tab-opener/design.md` 决策 4。
 */
import { z } from 'zod';
import {
  browserCreateInputSchema,
  otaCredentialIdSchema,
  startLoginInputSchema,
} from '../../shared/browser';
import { toChannelId } from '../../domain/identity';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import type { OtaTabOpener } from '../features/ota-tab-opener/ota-tab-opener';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

type RegisterOtaTabHandlersOptions = Readonly<{
  window: TrustedWindow;
  otaTabOpener: OtaTabOpener;
  logger: AppLogger;
}>;

export function registerOtaTabHandlers({
  window,
  otaTabOpener,
  logger,
}: RegisterOtaTabHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(
    IPC_CHANNELS.otaTab.openForNewLogin,
    z.tuple([startLoginInputSchema]),
    '登录参数无效',
    ({ channelId, environment, url }) =>
      otaTabOpener.open(environment, toChannelId(channelId), url),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openWithImportedCookie,
    z.tuple([startLoginInputSchema]),
    '登录参数无效',
    ({ channelId, environment, url }) =>
      otaTabOpener.createFromCookie(environment, toChannelId(channelId), url),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openExisting,
    z.tuple([otaCredentialIdSchema]),
    '登录凭据标识无效',
    (credentialId) => otaTabOpener.openExisting(credentialId),
  );
  registry.handle(
    IPC_CHANNELS.otaTab.openView,
    z.tuple([browserCreateInputSchema]),
    '浏览器参数无效',
    ({ channelId, url }) => otaTabOpener.openView(channelId, url),
  );

  return () => registry.dispose();
}
