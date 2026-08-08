import { z } from 'zod';
import {
  browserCookieSourceIdSchema,
  type BrowserCookieSource,
  type BrowserCookieSourceId,
  type CookieImportResult,
} from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import type { ImportedChannelSummary } from '../services/cookie-import-service';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

const noArgumentsSchema = z.tuple([]);

/** handler 声明自己需要什么，由 `CookieImportService` 满足；不 import 实现类。 */
export interface CookieImportOrchestrator {
  listSources(): Promise<readonly BrowserCookieSource[]> | readonly BrowserCookieSource[];
  listImportedChannels(): Promise<readonly ImportedChannelSummary[]>;
  import(sourceId: BrowserCookieSourceId): Promise<CookieImportResult>;
}

type RegisterCookieHandlersOptions = Readonly<{
  window: TrustedWindow;
  service: CookieImportOrchestrator;
  logger: AppLogger;
}>;

export function registerCookieHandlers({
  window,
  service,
  logger,
}: RegisterCookieHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(IPC_CHANNELS.cookies.listSources, noArgumentsSchema, '请求参数无效', () =>
    service.listSources(),
  );
  registry.handle(IPC_CHANNELS.cookies.listImportedChannels, noArgumentsSchema, '请求参数无效', () =>
    service.listImportedChannels(),
  );
  registry.handle(
    IPC_CHANNELS.cookies.import,
    z.tuple([browserCookieSourceIdSchema]),
    '浏览器类型无效',
    (sourceId) => service.import(sourceId),
  );

  return () => registry.dispose();
}
