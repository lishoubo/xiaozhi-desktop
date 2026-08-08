import { z } from 'zod';
import {
  browserCookieSourceSchema,
  cookieImportResultSchema,
  importedChannelSummarySchema,
  type BrowserCookieSourceId,
} from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

const browserCookieSourceListSchema = z.array(browserCookieSourceSchema);
const importedChannelSummaryListSchema = z.array(importedChannelSummarySchema);

export function createCookiesApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    listSources: () => invoke(browserCookieSourceListSchema, IPC_CHANNELS.cookies.listSources),
    import: (sourceId: BrowserCookieSourceId) =>
      invoke(cookieImportResultSchema, IPC_CHANNELS.cookies.import, sourceId),
    listImportedChannels: () =>
      invoke(importedChannelSummaryListSchema, IPC_CHANNELS.cookies.listImportedChannels),
  });
}
