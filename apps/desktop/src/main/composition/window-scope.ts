/**
 * 窗口级依赖 —— 随主窗口创建、随主窗口销毁。
 *
 * 清理只有一条路径：`disposers` 逆序执行。此前 `closed` 与 `will-quit` 各写
 * 一份清理清单，两份已经不一致（`otaCredentialService` 只在其中一份被置空），
 * 而且每加一个 handler 就要在三处同步改动（声明、注册、两处清理）。
 */
import { app, shell, type BrowserWindow } from 'electron';
import { BrowserManager } from '../browser/browser-manager';
import { amountChangeAdapters, hotelProbes, loginUrlMatchers } from '../channels/registry';
import { BrowserCookieImporter } from '../cookie-import/browser-cookie-importer';
import { registerAgentHandlers } from '../ipc/agent-handlers';
import { registerBrowserHandlers } from '../ipc/browser-handlers';
import { registerCalendarHandlers } from '../ipc/calendar-handlers';
import { registerCookieHandlers } from '../ipc/cookie-handlers';
import { registerHotelManagementHandlers } from '../ipc/hotel-management-handlers';
import { registerOtaCredentialHandlers } from '../ipc/ota-credential-handlers';
import { registerOtaTabHandlers } from '../ipc/ota-tab-handlers';
import { registerStaffAuthHandlers } from '../ipc/staff-auth-handlers';
import { registerSystemHandlers } from '../ipc/system-handlers';
import { LoginDetector, OtaTabService, TabEventBus } from '../ota-tab';
import { resolveServerOrigin } from '../server-client/config';
import {
  createElectronSessionFetch,
  createServerTrpcStreamingClient,
} from '../server-client/trpc-client';
import { createStaffServerFetch } from '../server-client/staff-server-fetch';
import { installPrivateCaTrust, loadPackagedPrivateCa } from '../server-client/private-ca-trust';
import { StaffAuthService } from '../services/staff-auth-service';
import { CalendarService } from '../services/calendar-service';
import { CookieImportService } from '../services/cookie-import-service';
import { AmountChangeWatcher } from '../channels/amount-change-watcher';
import { HotelProbeDispatcher } from '../channels/hotel-probe-dispatcher';
import { OtaReauthDispatcher } from '../channels/ota-reauth-dispatcher';
import { ReauthByHotelDispatcher } from '../channels/reauth-by-hotel-dispatcher';
import { reportError } from '../error-reporting/report-error';
import { HttpRmsAmountChangeGateway } from '../gateway/rms/rms-amount-change-gateway-http';
import { AmountChangeReportService } from '../services/amount-change-report-service';
import type { UiWaitingResultEnvelope } from '../../shared/types/ui-waiting-result-types';
import { SystemService } from '../services/system-service';
import { AgentService } from '../services/agent-service';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { createMainWindow } from '../windows/main-window';
import type { AppScope } from './app-scope';

export type WindowScope = Readonly<{
  window: BrowserWindow;
  dispose(): void;
}>;

type WindowScopeDependencies = Pick<
  AppScope,
  | 'logger'
  | 'userDataDir'
  | 'sessionFactory'
  | 'calendarRepository'
  | 'otaCredentialRepository'
  | 'hotelManagementService'
  | 'otaCredentialService'
  | 'channelRegistry'
  | 'rms'
  | 'windowCapabilities'
>;

export function createWindowScope(scope: WindowScopeDependencies): WindowScope {
  const { logger } = scope;
  const disposers: (() => void)[] = [];
  const onDispose = (dispose: () => void): void => {
    disposers.push(dispose);
  };

  const window = createMainWindow();
  logger.info('Main window created');

  const tabEventBus = new TabEventBus();
  const browserManager = new BrowserManager(window, logger, scope.sessionFactory, {
    // 退休清理的第二道守卫：这份 partition 还是不是某个账号当前的登录态。
    // 缺了它，清理只看「有没有标签页开着」，会把已认领的登录态一并清空
    // （真机事故：连续绑定多个美团账号后 5 个账号掉登录）。
    isPartitionClaimed: (partitionName) =>
      scope.otaCredentialRepository.findByPartitionName(partitionName) !== null,
  });
  onDispose(() => browserManager.destroy());

  const windowCapabilityRegistration = scope.windowCapabilities.attach({
    retirePartition: (partitionName) => browserManager.retirePartition(partitionName),
    notifyAccountBound: (channel) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.otaCredential.discoveryCompleted, { channel });
      }
    },
  });
  onDispose(() => windowCapabilityRegistration.dispose());

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
  new ReauthByHotelDispatcher({
    tabEventBus,
    probes: hotelProbes(scope.channelRegistry),
    logger,
    notify: notifyUiWaitingResult,
  });

  // 价量态改动监听。与上面几个 dispatcher 不同，它订阅的是 browserManager 的原始导航
  // 事件（要的是「URL 变了」，不是「登录判定完了」），所以不接 tabEventBus。
  const amountChangeReportService = new AmountChangeReportService({
    gateway: new HttpRmsAmountChangeGateway({
      origin: scope.rms.origin,
      fetch: scope.rms.fetch,
      logger,
      reportError,
    }),
    // 上报体要带「谁改的」和「用哪个渠道账号改的」。两者分别来自认证栈与凭证仓储，
    // 都够不着 channels/，所以在这里以窄查询注入。
    identity: {
      currentStaff: async () => {
        const identity = await new StaffAuthService({
          client: scope.rms.authClient,
          tokens: scope.rms.tokens,
          logger,
        }).currentSession();
        if (!identity) return null;
        return {
          userId: identity.userId,
          username: identity.username,
          fullName: identity.fullName,
        };
      },
      credentialByPartition: (partitionName) => {
        const credential = scope.otaCredentialRepository.findByPartitionName(partitionName);
        return Promise.resolve(
          credential
            ? {
                channelAccountId: credential.channelAccountId,
                credentialExtra: credential.credentialExtra,
              }
            : null,
        );
      },
    },
    logger,
  });
  new AmountChangeWatcher({
    browserManager,
    adapters: amountChangeAdapters(scope.channelRegistry),
    logger,
    // watcher 在 channels/，不认识 services/；窄回调在这里接起来。
    report: (observed, partitionName) =>
      void amountChangeReportService.report(observed, partitionName),
  });

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
    readInjectableCookies: (partitionName) =>
      scope.sessionFactory.readInjectableCookies(partitionName),
    logger,
  });

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
  onDispose(registerOtaCredentialHandlers({ window, service: scope.otaCredentialService, logger }));
  onDispose(
    registerSystemHandlers({
      window,
      // `getPath('logs')` 此刻已经是带登录变体那一层的最终目录——`main/index.ts`
      // 启动时就 `setAppLogsPath` 定死了，这里取到的和日志实际落盘的是同一个。
      service: new SystemService({
        app,
        shell,
        logsDirectory: app.getPath('logs'),
        logger,
      }),
      logger,
    }),
  );
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
  const serverOrigin = resolveServerOrigin(process.env);
  const apiSession = scope.sessionFactory.sessionForServerApi();
  const privateCa = loadPackagedPrivateCa(app.isPackaged, process.resourcesPath, process.env);
  if (privateCa) installPrivateCaTrust(apiSession, serverOrigin, privateCa);
  const serverFetch = createElectronSessionFetch(apiSession);
  const agentFetch = createStaffServerFetch(serverFetch, scope.rms.tokens, logger);
  const agentService = new AgentService(
    createServerTrpcStreamingClient({ baseUrl: serverOrigin, fetch: agentFetch }),
    (envelope) => {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agent.streamEvent, envelope);
    },
    logger,
  );
  onDispose(() => agentService.dispose());
  onDispose(registerAgentHandlers({ window, service: agentService, logger }));
  // 认证栈建在 app scope：业务 gateway 也要用同一份 token，不能各持一套。
  onDispose(
    registerStaffAuthHandlers({
      service: new StaffAuthService({
        client: scope.rms.authClient,
        tokens: scope.rms.tokens,
        logger,
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
