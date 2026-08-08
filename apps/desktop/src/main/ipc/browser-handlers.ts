import { z } from 'zod';
import {
  browserBoundsSchema,
  browserTabIdSchema,
  type BrowserBounds,
} from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

const noArgumentsSchema = z.tuple([]);

/** 标签页操作。开 tab 不在这里——那是 `ota-tab-handlers.ts` 的唯一入口。 */
export interface BrowserTabController {
  activate(tabId: string): unknown;
  close(tabId: string): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  getAudioMuted(): boolean;
  hide(): void;
  list(): unknown;
  reload(tabId: string): void;
  setBounds(bounds: BrowserBounds): void;
  setAudioMuted(muted: boolean): boolean;
}

type RegisterBrowserHandlersOptions = Readonly<{
  window: TrustedWindow;
  manager: BrowserTabController;
  logger: AppLogger;
}>;

export function registerBrowserHandlers({
  window,
  manager,
  logger,
}: RegisterBrowserHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });
  const handle = registry.handle;

  handle(IPC_CHANNELS.browser.activate, z.tuple([browserTabIdSchema]), '标签标识无效', (tabId) =>
    manager.activate(tabId),
  );
  handle(IPC_CHANNELS.browser.close, z.tuple([browserTabIdSchema]), '标签标识无效', (tabId) =>
    manager.close(tabId),
  );
  handle(IPC_CHANNELS.browser.goBack, z.tuple([browserTabIdSchema]), '标签标识无效', (tabId) =>
    manager.goBack(tabId),
  );
  handle(IPC_CHANNELS.browser.goForward, z.tuple([browserTabIdSchema]), '标签标识无效', (tabId) =>
    manager.goForward(tabId),
  );
  handle(IPC_CHANNELS.browser.getAudioMuted, noArgumentsSchema, '请求参数无效', () =>
    manager.getAudioMuted(),
  );
  handle(IPC_CHANNELS.browser.hide, noArgumentsSchema, '请求参数无效', () => manager.hide());
  handle(IPC_CHANNELS.browser.list, noArgumentsSchema, '请求参数无效', () => manager.list());
  handle(IPC_CHANNELS.browser.reload, z.tuple([browserTabIdSchema]), '标签标识无效', (tabId) =>
    manager.reload(tabId),
  );
  handle(
    IPC_CHANNELS.browser.setBounds,
    z.tuple([browserBoundsSchema]),
    '浏览器区域尺寸无效',
    (bounds) => manager.setBounds(bounds),
  );
  handle(IPC_CHANNELS.browser.setAudioMuted, z.tuple([z.boolean()]), '声音状态无效', (muted) =>
    manager.setAudioMuted(muted),
  );

  return () => registry.dispose();
}
