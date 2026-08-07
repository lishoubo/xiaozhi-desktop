/**
 * OTA 标签页打开的 4 个 IPC 入口，全部委托 `OtaTabOpener`。取代原
 * `browser-handlers.ts` 里散落的 `browser.create`/`otaCredential.open*`
 * handler——见 `openspec/changes/refactor-ota-tab-opener/design.md` 决策 4。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z, type ZodType } from 'zod';
import {
  browserCreateInputSchema,
  otaCredentialIdSchema,
  startLoginInputSchema,
} from '../../shared/browser';
import { toChannelId } from '../../domain/identity';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import type { OtaTabOpener } from '../features/ota-tab-opener/ota-tab-opener';

type RegisterOtaTabHandlersOptions = Readonly<{
  window: Readonly<{ webContents: unknown }>;
  otaTabOpener: OtaTabOpener;
  logger: AppLogger;
}>;

export function registerOtaTabHandlers({
  window,
  otaTabOpener,
  logger,
}: RegisterOtaTabHandlersOptions): () => void {
  const assertTrusted = (event: IpcMainInvokeEvent, channel: string): void => {
    if (event.sender !== window.webContents) {
      logger.warn('Rejected untrusted IPC request', { channel });
      throw new Error('拒绝来自非主应用窗口的请求');
    }
  };
  const handle = <Arguments extends unknown[]>(
    channel: string,
    argumentsSchema: ZodType<Arguments>,
    invalidInputMessage: string,
    listener: (event: IpcMainInvokeEvent, ...args: Arguments) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrusted(event, channel);
      const parsed = argumentsSchema.safeParse(args);
      if (!parsed.success) {
        logger.warn('Rejected invalid IPC request', { channel });
        throw new Error(invalidInputMessage);
      }
      return listener(event, ...parsed.data);
    });
  };

  handle(
    IPC_CHANNELS.otaTab.openForNewLogin,
    z.tuple([startLoginInputSchema]),
    '登录参数无效',
    (_event, { channelId, environment, url }) =>
      otaTabOpener.open(environment, toChannelId(channelId), url),
  );
  handle(
    IPC_CHANNELS.otaTab.openWithImportedCookie,
    z.tuple([startLoginInputSchema]),
    '登录参数无效',
    (_event, { channelId, environment, url }) =>
      otaTabOpener.createFromCookie(environment, toChannelId(channelId), url),
  );
  handle(
    IPC_CHANNELS.otaTab.openExisting,
    z.tuple([otaCredentialIdSchema]),
    '登录凭据标识无效',
    (_event, credentialId) => otaTabOpener.openExisting(credentialId),
  );
  handle(
    IPC_CHANNELS.otaTab.openView,
    z.tuple([browserCreateInputSchema]),
    '浏览器参数无效',
    (_event, { channelId, url }) => otaTabOpener.openView(channelId, url),
  );

  const channels = Object.values(IPC_CHANNELS.otaTab);
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
