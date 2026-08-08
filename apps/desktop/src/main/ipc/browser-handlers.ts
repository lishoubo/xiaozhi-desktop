import { app } from 'electron';
import { z } from 'zod';
import {
  browserBoundsSchema,
  browserCookieSourceIdSchema,
  browserTabIdSchema,
  otaCredentialChannelSchema,
  type BrowserBounds,
  type SystemPreferences,
} from '../../shared/browser';
import { toChannelId } from '../../domain/identity';
import type { OtaCredentialRepository } from '../../domain/ports/repositories';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { BrowserCookieImporter } from '../cookie-import/browser-cookie-importer';
import { friendlyCookieImportMessage } from '../cookie-import/cookie-import';
import { listImportedChannels, writeImportedCookies } from '../cookie-import/store';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

const noArgumentsSchema = z.tuple([]);

type RegisterBrowserHandlersOptions = Readonly<{
  window: TrustedWindow;
  manager: Readonly<{
    acknowledgeInterception: () => void;
    activate: (tabId: string) => unknown;
    close: (tabId: string) => void;
    goBack: (tabId: string) => void;
    goForward: (tabId: string) => void;
    getAudioMuted: () => boolean;
    hide: () => void;
    list: () => unknown;
    reload: (tabId: string) => void;
    setBounds: (bounds: BrowserBounds) => void;
    setAudioMuted: (muted: boolean) => boolean;
  }>;
  logger: AppLogger;
  cookieImporter?: Pick<BrowserCookieImporter, 'listSources' | 'readCookies'>;
  userDataDir: string;
  otaCredentialRepository: Pick<OtaCredentialRepository, 'listByChannel'>;
}>;

function systemPreferences(): SystemPreferences {
  return {
    autoLaunch: app.getLoginItemSettings().openAtLogin,
    version: app.getVersion(),
  };
}

export function registerBrowserHandlers({
  window,
  manager,
  logger,
  cookieImporter = new BrowserCookieImporter(logger),
  userDataDir,
  otaCredentialRepository,
}: RegisterBrowserHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });
  const handle = registry.handle;

  handle(IPC_CHANNELS.browser.acknowledgeInterception, noArgumentsSchema, '请求参数无效', () =>
    manager.acknowledgeInterception(),
  );
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
  handle(IPC_CHANNELS.cookies.listSources, noArgumentsSchema, '请求参数无效', () =>
    cookieImporter.listSources(),
  );
  handle(IPC_CHANNELS.cookies.listImportedChannels, noArgumentsSchema, '请求参数无效', () =>
    listImportedChannels(userDataDir),
  );
  handle(
    IPC_CHANNELS.otaCredential.listByChannel,
    z.tuple([otaCredentialChannelSchema]),
    '渠道标识无效',
    (channelId) => otaCredentialRepository.listByChannel(toChannelId(channelId)),
  );
  handle(
    IPC_CHANNELS.cookies.import,
    z.tuple([browserCookieSourceIdSchema]),
    '浏览器类型无效',
    async (sourceId) => {
      try {
        const { cookiesByChannel, failed: readFailures } =
          await cookieImporter.readCookies(sourceId);
        if (cookiesByChannel.size === 0 && readFailures === 0) {
          throw new Error('所选浏览器中没有找到可导入的 Cookie');
        }
        const importedAt = new Date().toISOString();
        await Promise.all(
          Array.from(cookiesByChannel.entries()).map(([channel, cookies]) =>
            writeImportedCookies(userDataDir, channel, cookies, { importedAt, sourceId }),
          ),
        );
        const imported = Array.from(cookiesByChannel.values()).reduce(
          (total, cookies) => total + cookies.length,
          0,
        );
        if (imported === 0) throw new Error('未能导入 Cookie，请确认浏览器已登录并允许系统访问');
        logger.info('Cookies imported to disk', {
          source: sourceId,
          channels: cookiesByChannel.size,
          imported,
          failed: readFailures,
        });
        return { imported, failed: readFailures };
      } catch (error) {
        logger.warn('Cookie import could not be completed', {
          source: typeof sourceId === 'string' ? sourceId : 'unknown',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return { imported: 0, failed: 0, error: friendlyCookieImportMessage(error) };
      }
    },
  );
  handle(IPC_CHANNELS.system.getPreferences, noArgumentsSchema, '请求参数无效', () =>
    systemPreferences(),
  );
  handle(IPC_CHANNELS.system.setAutoLaunch, z.tuple([z.boolean()]), '开机启动设置无效', (enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    logger.info('Auto-launch preference changed', { enabled });
    return systemPreferences();
  });

  return () => registry.dispose();
}
