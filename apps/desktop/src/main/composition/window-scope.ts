/**
 * 窗口级依赖 —— 随主窗口创建、随主窗口销毁。
 *
 * 清理只有一条路径：`disposers` 逆序执行。此前 `closed` 与 `will-quit` 各写
 * 一份清理清单，两份已经不一致（`otaCredentialService` 只在其中一份被置空），
 * 而且每加一个 handler 就要在三处同步改动（声明、注册、两处清理）。
 */
import { app, type BrowserWindow } from 'electron';
import { BrowserManager } from '../browser/browser-manager';
import { hotelProbes, loginUrlMatchers } from '../channels/registry';
import { BrowserCookieImporter } from '../cookie-import/browser-cookie-importer';
import { registerAuthHandlers } from '../ipc/auth-handlers';
import { registerBrowserHandlers } from '../ipc/browser-handlers';
import { registerCalendarHandlers } from '../ipc/calendar-handlers';
import { registerCookieHandlers } from '../ipc/cookie-handlers';
import { registerHotelManagementHandlers } from '../ipc/hotel-management-handlers';
import { registerOtaCredentialHandlers } from '../ipc/ota-credential-handlers';
import { registerOtaTabHandlers } from '../ipc/ota-tab-handlers';
import { registerSystemHandlers } from '../ipc/system-handlers';
import { LoginDetector, OtaTabService, TabEventBus } from '../ota-tab';
import { resolveServerOrigin } from '../server-client/config';
import { createElectronSessionFetch, createServerTrpcClient } from '../server-client/trpc-client';
import { AuthService } from '../services/auth-service';
import { CalendarService } from '../services/calendar-service';
import { CookieImportService } from '../services/cookie-import-service';
import { HotelProbeDispatcher } from '../channels/hotel-probe-dispatcher';
import { OtaReauthDispatcher } from '../channels/ota-reauth-dispatcher';
import type { UiWaitingResultEnvelope } from '../../shared/types/ui-waiting-result-types';
import { SystemService } from '../services/system-service';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { createMainWindow } from '../windows/main-window';
import type { AppScope } from './app-scope';

export type WindowScope = Readonly<{
  window: BrowserWindow;
  dispose(): void;
}>;

export function createWindowScope(scope: AppScope): WindowScope {
  const { logger } = scope;
  const disposers: (() => void)[] = [];
  const onDispose = (dispose: () => void): void => {
    disposers.push(dispose);
  };

  const window = createMainWindow();
  logger.info('Main window created');

  const tabEventBus = new TabEventBus();
  const browserManager = new BrowserManager(window, logger, scope.sessionFactory);
  onDispose(() => browserManager.destroy());

  // 回填 app scope 需要的窗口级能力，窗口销毁时撤回。
  scope.setPartitionRetirer((partitionName) => browserManager.retirePartition(partitionName));
  scope.setAccountBoundNotifier((channel) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.otaCredential.discoveryCompleted, { channel });
    }
  });
  onDispose(() => {
    scope.setPartitionRetirer(null);
    scope.setAccountBoundNotifier(null);
  });

  // dispatcher 在 channels/，不认识 electron 与 ipc；这里把窄回调接到窗口上。
  // 两个 dispatcher 共用同一条通道，靠信封的 kind 与 requestId 区分。
  const notifyUiWaitingResult = (envelope: UiWaitingResultEnvelope): void => {
    if (window.isDestroyed()) {
      // 不记的话，dispatcher 已经打了 `delivered`，日志上看是送到了，
      // 排查时会误判成渲染进程侧的问题。
      logger.warn('UI waiting result dropped: window destroyed', {
        requestId: envelope.requestId,
        kind: envelope.kind,
      });
      return;
    }
    window.webContents.send(IPC_CHANNELS.uiWaitingResult.delivered, envelope);
  };

  // 构造函数内部完成 tabEventBus 订阅；订阅回调闭包持有 this 引用，只要
  // tabEventBus 存活这个实例就不会被 GC，不需要变量持有它。
  new HotelProbeDispatcher({
    tabEventBus,
    probes: hotelProbes(scope.channelRegistry),
    logger,
    notify: notifyUiWaitingResult,
  });
  new OtaReauthDispatcher({ tabEventBus, logger, notify: notifyUiWaitingResult });

  const loginDetector = new LoginDetector({
    browserManager,
    tabEventBus,
    loginUrlMatchers: loginUrlMatchers(scope.channelRegistry),
    triggerDiscovery: (partitionName, channel, landingUrl, webContents) =>
      scope.otaCredentialService.trigger(partitionName, channel, landingUrl, webContents),
  });
  const otaTabService = new OtaTabService({
    userDataDir: scope.userDataDir,
    browserManager,
    loginDetector,
    otaCredentialRepository: scope.otaCredentialRepository,
  });

  const serverOrigin = resolveServerOrigin(process.env);
  const apiSession = scope.sessionFactory.sessionForServerApi();

  onDispose(registerBrowserHandlers({ window, manager: browserManager, logger }));
  onDispose(
    registerCookieHandlers({
      window,
      service: new CookieImportService({
        importer: new BrowserCookieImporter(logger),
        userDataDir: scope.userDataDir,
        logger,
      }),
      logger,
    }),
  );
  onDispose(
    registerOtaCredentialHandlers({ window, service: scope.otaCredentialService, logger }),
  );
  onDispose(registerSystemHandlers({ window, service: new SystemService({ app, logger }), logger }));
  onDispose(registerOtaTabHandlers({ window, service: otaTabService, logger }));
  onDispose(
    registerCalendarHandlers({
      window,
      service: new CalendarService({ repository: scope.calendarRepository, logger }),
      logger,
    }),
  );
  onDispose(
    registerHotelManagementHandlers({ window, feature: scope.hotelManagementService, logger }),
  );
  onDispose(
    registerAuthHandlers({
      service: new AuthService({
        apiSession,
        client: createServerTrpcClient({
          baseUrl: serverOrigin,
          fetch: createElectronSessionFetch(apiSession),
        }),
        logger,
        serverOrigin,
      }),
      logger,
      window,
    }),
  );

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    // 逆序：后注册的先清理，依赖方先于被依赖方消失。
    for (const disposeOne of disposers.reverse()) disposeOne();
    logger.info('Main window closed');
  };

  window.once('closed', dispose);

  return { window, dispose };
}
