import { app, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z, type ZodType } from 'zod';
import {
  browserBoundsSchema,
  browserCookieSourceIdSchema,
  browserCreateInputSchema,
  browserTabIdSchema,
  otaCredentialChannelSchema,
  otaCredentialIdSchema,
  startLoginInputSchema,
  type BrowserBounds,
  type SystemPreferences,
} from '../../shared/browser';
import { toChannelId, toOtaCredentialId, type ChannelId } from '../../domain/identity';
import type { LoginUrlMatcher } from '../../domain/ports/discovery';
import type { OtaCredential } from '../../domain/ota-credential';
import type { OtaCredentialRepository } from '../../domain/ports/repositories';
import { otaChannelLandingUrl } from '../../domain/policy/ota-account-landing-url-policy';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { BrowserCookieImporter } from '../cookie-import/browser-cookie-importer';
import { friendlyCookieImportMessage } from '../cookie-import/cookie-import';
import { listImportedChannels, writeImportedCookies } from '../cookie-import/store';
import { LoginTabOpener } from '../features/ota-credential/login-tab-opener';

const noArgumentsSchema = z.tuple([]);

type RegisterBrowserHandlersOptions = Readonly<{
  window: Readonly<{ webContents: unknown }>;
  manager: Readonly<{
    acknowledgeInterception: () => void;
    activate: (tabId: string) => unknown;
    close: (tabId: string) => void;
    create: (channelId: string, url: string) => unknown;
    createAndNewPartition: InstanceType<
      typeof import('../browser/browser-manager').BrowserManager
    >['createAndNewPartition'];
    createWithAlreadyPartition: InstanceType<
      typeof import('../browser/browser-manager').BrowserManager
    >['createWithAlreadyPartition'];
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
  loginUrlMatchers: ReadonlyMap<ChannelId, LoginUrlMatcher>;
  triggerDiscovery: (
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ) => Promise<OtaCredential | null>;
  otaCredentialRepository: Pick<OtaCredentialRepository, 'findById' | 'listByChannel'>;
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
  loginUrlMatchers,
  triggerDiscovery,
  otaCredentialRepository,
}: RegisterBrowserHandlersOptions): () => void {
  const loginTabOpener = new LoginTabOpener({
    userDataDir,
    browser: manager,
    loginUrlMatchers,
    triggerDiscovery,
  });
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
    IPC_CHANNELS.browser.create,
    z.tuple([browserCreateInputSchema]),
    '浏览器参数无效',
    (_event, { channelId, url }) => manager.create(channelId, url),
  );
  handle(IPC_CHANNELS.browser.acknowledgeInterception, noArgumentsSchema, '请求参数无效', () =>
    manager.acknowledgeInterception(),
  );
  handle(
    IPC_CHANNELS.browser.activate,
    z.tuple([browserTabIdSchema]),
    '标签标识无效',
    (_event, tabId) => manager.activate(tabId),
  );
  handle(
    IPC_CHANNELS.browser.close,
    z.tuple([browserTabIdSchema]),
    '标签标识无效',
    (_event, tabId) => manager.close(tabId),
  );
  handle(
    IPC_CHANNELS.browser.goBack,
    z.tuple([browserTabIdSchema]),
    '标签标识无效',
    (_event, tabId) => manager.goBack(tabId),
  );
  handle(
    IPC_CHANNELS.browser.goForward,
    z.tuple([browserTabIdSchema]),
    '标签标识无效',
    (_event, tabId) => manager.goForward(tabId),
  );
  handle(IPC_CHANNELS.browser.getAudioMuted, noArgumentsSchema, '请求参数无效', () =>
    manager.getAudioMuted(),
  );
  handle(IPC_CHANNELS.browser.hide, noArgumentsSchema, '请求参数无效', () => manager.hide());
  handle(IPC_CHANNELS.browser.list, noArgumentsSchema, '请求参数无效', () => manager.list());
  handle(
    IPC_CHANNELS.browser.reload,
    z.tuple([browserTabIdSchema]),
    '标签标识无效',
    (_event, tabId) => manager.reload(tabId),
  );
  handle(
    IPC_CHANNELS.browser.setBounds,
    z.tuple([browserBoundsSchema]),
    '浏览器区域尺寸无效',
    (_event, bounds) => manager.setBounds(bounds),
  );
  handle(
    IPC_CHANNELS.browser.setAudioMuted,
    z.tuple([z.boolean()]),
    '声音状态无效',
    (_event, muted) => manager.setAudioMuted(muted),
  );
  handle(IPC_CHANNELS.cookies.listSources, noArgumentsSchema, '请求参数无效', () =>
    cookieImporter.listSources(),
  );
  handle(IPC_CHANNELS.cookies.listImportedChannels, noArgumentsSchema, '请求参数无效', () =>
    listImportedChannels(userDataDir),
  );
  handle(
    IPC_CHANNELS.otaCredential.openForNewLogin,
    z.tuple([startLoginInputSchema]),
    '登录参数无效',
    (_event, { channelId, environment, url }) =>
      loginTabOpener.open(environment, toChannelId(channelId), url),
  );
  handle(
    IPC_CHANNELS.otaCredential.openWithImportedCookie,
    z.tuple([startLoginInputSchema]),
    '登录参数无效',
    (_event, { channelId, environment, url }) =>
      loginTabOpener.createFromCookie(environment, toChannelId(channelId), url),
  );
  handle(
    IPC_CHANNELS.otaCredential.listByChannel,
    z.tuple([otaCredentialChannelSchema]),
    '渠道标识无效',
    (_event, channelId) => otaCredentialRepository.listByChannel(toChannelId(channelId)),
  );
  handle(
    IPC_CHANNELS.otaCredential.openExisting,
    z.tuple([otaCredentialIdSchema]),
    '登录凭据标识无效',
    (_event, credentialId) => {
      const credential = otaCredentialRepository.findById(toOtaCredentialId(credentialId));
      if (!credential) throw new Error('未找到该登录凭据');
      const url = otaChannelLandingUrl(credential.channel);
      logger.info('Opening existing OTA credential', {
        credentialId,
        channel: credential.channel,
        url,
      });
      return manager.createWithAlreadyPartition(credential.partitionName, credential.channel, url);
    },
  );
  handle(
    IPC_CHANNELS.cookies.import,
    z.tuple([browserCookieSourceIdSchema]),
    '浏览器类型无效',
    async (_event, sourceId) => {
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
  handle(
    IPC_CHANNELS.system.setAutoLaunch,
    z.tuple([z.boolean()]),
    '开机启动设置无效',
    (_event, enabled) => {
      app.setLoginItemSettings({ openAtLogin: enabled });
      logger.info('Auto-launch preference changed', { enabled });
      return systemPreferences();
    },
  );

  const channels = [
    ...Object.values(IPC_CHANNELS.browser).filter(
      (channel) =>
        channel !== IPC_CHANNELS.browser.stateChanged &&
        channel !== IPC_CHANNELS.browser.requestIntercepted,
    ),
    ...Object.values(IPC_CHANNELS.cookies),
    ...Object.values(IPC_CHANNELS.otaCredential).filter(
      (channel) => channel !== IPC_CHANNELS.otaCredential.discoveryCompleted,
    ),
    ...Object.values(IPC_CHANNELS.system),
  ];
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
