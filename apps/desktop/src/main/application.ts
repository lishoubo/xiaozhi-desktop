import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { registerBrowserHandlers } from './ipc/browser-handlers';
import { BrowserManager } from './browser/browser-manager';
import { TabEventBus } from './browser/tab-event-bus';
import { configureNetworkPrivacy } from './security/network-privacy';
import { createMainWindow } from './windows/main-window';
import { configureMainLogging } from './logging/configure-main-logging';
import { CtripCheckInAutomation } from './automation/ctrip-check-in-automation';
import { registerAutomationHandlers } from './ipc/automation-handlers';
import { openApplicationDatabase, type ApplicationDatabase } from './database/application-database';
import { SqliteCalendarRepository } from './calendar/calendar-repository';
import { registerCalendarHandlers } from './ipc/calendar-handlers';
import { isStartupAutomationEnabled } from '../domain/policy/startup-automation-policy';
import { SqliteOtaCredentialRepository } from './database/ota-credential-repository';
import { SqliteOtaHotelProbRepository } from './database/ota-hotel-prob-repository';
import { DiscoverAndCreate } from './features/ota-credential/discover-and-create';
import { createDiscoveryProbes } from './features/ota-credential/discovery-probe';
import { LOGIN_URL_MATCHERS } from './features/ota-credential/login-url-matcher';
import { createCtripDiscovery } from './features/ota-credential/ota/ctrip/discover-ctrip';
import { createDouyinDiscovery } from './features/ota-credential/ota/douyin/discover-douyin';
import { createMeituanDiscovery } from './features/ota-credential/ota/meituan/discover-meituan';
import { OtaHotelProbFeature } from './features/ota-hotel-prob/ota-hotel-prob-feature';
import { HotelManagementFeature } from './features/hotel-management/hotel-management-feature';
import { MockRmsHotelGateway } from './features/hotel-management/rms-hotel-gateway-mock';
import { MockRmsOtaAccountGateway } from './features/hotel-management/rms-ota-account-gateway-mock';
import { registerHotelManagementHandlers } from './ipc/hotel-management-handlers';
import { ctripHotelProbe } from './features/ota-hotel-prob/ota/ctrip/hotel-prob';
import { createDouyinHotelProbe } from './features/ota-hotel-prob/ota/douyin/hotel-prob';
import { meituanHotelProbe } from './features/ota-hotel-prob/ota/meituan/hotel-prob';
import type { HotelProbe } from './features/ota-hotel-prob/hotel-prob-port';
import { removePendingPartition } from './file-store/pending-partitions-store';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { toChannelId, type ChannelId } from '../domain/identity';
import { SessionFactory } from './browser/session-factory';
import { createElectronSessionFetch, createServerTrpcClient } from './server/trpc-client';
import { resolveServerOrigin } from './server/config';
import { registerAuthHandlers } from './ipc/auth-handlers';

let mainWindow: BrowserWindow | null = null;
let browserManager: BrowserManager | null = null;
let tabEventBus: TabEventBus | null = null;
let unregisterBrowserHandlers: (() => void) | null = null;
let ctripAutomation: CtripCheckInAutomation | null = null;
let unregisterAutomationHandlers: (() => void) | null = null;
let applicationDatabase: ApplicationDatabase | null = null;
let calendarRepository: SqliteCalendarRepository | null = null;
let unregisterCalendarHandlers: (() => void) | null = null;
let unregisterAuthHandlers: (() => void) | null = null;
let discoverAndCreate: DiscoverAndCreate | null = null;
let otaCredentialRepository: SqliteOtaCredentialRepository | null = null;
let otaHotelProbRepository: SqliteOtaHotelProbRepository | null = null;
let sessionFactory: SessionFactory | null = null;
let hotelManagementFeature: HotelManagementFeature | null = null;
let unregisterHotelManagementHandlers: (() => void) | null = null;

configureNetworkPrivacy(app.commandLine);
configureMainLogging(log, {
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
});

function openMainWindow(): void {
  if (!calendarRepository) throw new Error('Calendar repository is not initialized');
  if (!otaCredentialRepository) throw new Error('OtaCredential repository is not initialized');
  if (!otaHotelProbRepository) throw new Error('OtaHotelProb repository is not initialized');
  if (!sessionFactory) throw new Error('Session factory is not initialized');
  if (!hotelManagementFeature) throw new Error('Hotel management feature is not initialized');
  mainWindow = createMainWindow();
  log.info('Main window created');
  tabEventBus = new TabEventBus();
  browserManager = new BrowserManager(mainWindow, log, sessionFactory, tabEventBus);
  ctripAutomation = isStartupAutomationEnabled(process.env)
    ? new CtripCheckInAutomation(browserManager.browserSession, log)
    : null;
  const ctripResult = ctripAutomation?.start() ?? null;
  if (!discoverAndCreate) throw new Error('Discovery pipeline is not initialized');
  const hotelProbes: ReadonlyMap<ChannelId, HotelProbe> = new Map([
    [toChannelId('ctrip'), ctripHotelProbe],
    [toChannelId('douyin'), createDouyinHotelProbe(log)],
    [toChannelId('meituan'), meituanHotelProbe],
  ]);
  // 构造函数内部完成 tabEventBus 订阅；订阅回调闭包持有 this 引用，只要
  // tabEventBus 存活这个 Feature 实例就不会被 GC，不需要模块级变量持有它。
  new OtaHotelProbFeature({
    tabEventBus,
    probes: hotelProbes,
    repository: otaHotelProbRepository,
    logger: log,
  });
  unregisterBrowserHandlers = registerBrowserHandlers({
    window: mainWindow,
    manager: browserManager,
    logger: log,
    userDataDir: app.getPath('userData'),
    loginUrlMatchers: LOGIN_URL_MATCHERS,
    triggerDiscovery: (partitionName, channel, landingUrl, webContents) =>
      discoverAndCreate?.trigger(partitionName, channel, landingUrl, webContents) ??
      Promise.resolve(null),
    otaCredentialRepository,
  });
  unregisterAutomationHandlers = registerAutomationHandlers({
    window: mainWindow,
    result: ctripResult,
    logger: log,
  });
  unregisterCalendarHandlers = registerCalendarHandlers({
    window: mainWindow,
    repository: calendarRepository,
    logger: log,
  });
  unregisterHotelManagementHandlers = registerHotelManagementHandlers({
    window: mainWindow,
    feature: hotelManagementFeature,
    logger: log,
  });
  const serverOrigin = resolveServerOrigin(process.env);
  const apiSession = sessionFactory.sessionForServerApi();
  unregisterAuthHandlers = registerAuthHandlers({
    apiSession,
    client: createServerTrpcClient({
      baseUrl: serverOrigin,
      fetch: createElectronSessionFetch(apiSession),
    }),
    logger: log,
    serverOrigin,
    window: mainWindow,
  });
  mainWindow.once('closed', () => {
    unregisterAuthHandlers?.();
    unregisterAuthHandlers = null;
    unregisterHotelManagementHandlers?.();
    unregisterHotelManagementHandlers = null;
    unregisterCalendarHandlers?.();
    unregisterCalendarHandlers = null;
    unregisterAutomationHandlers?.();
    unregisterAutomationHandlers = null;
    ctripAutomation?.destroy();
    ctripAutomation = null;
    unregisterBrowserHandlers?.();
    unregisterBrowserHandlers = null;
    browserManager?.destroy();
    browserManager = null;
    mainWindow = null;
    log.info('Main window closed');
  });
}

function initializeApplication(): void {
  log.info('Application initialization started');
  sessionFactory = new SessionFactory(log);
  applicationDatabase = openApplicationDatabase(
    path.join(app.getPath('userData'), 'hotel-butler.sqlite'),
    log,
    { includeMockData: !app.isPackaged },
  );
  calendarRepository = new SqliteCalendarRepository(applicationDatabase);
  const userDataDir = app.getPath('userData');
  otaCredentialRepository = new SqliteOtaCredentialRepository(applicationDatabase);
  otaHotelProbRepository = new SqliteOtaHotelProbRepository(applicationDatabase);
  hotelManagementFeature = new HotelManagementFeature(
    new MockRmsHotelGateway(),
    new MockRmsOtaAccountGateway(),
  );
  discoverAndCreate = new DiscoverAndCreate({
    probes: createDiscoveryProbes(),
    discoverCtrip: createCtripDiscovery(log),
    discoverDouyin: createDouyinDiscovery(log),
    discoverMeituan: createMeituanDiscovery(log),
    credentialRepository: otaCredentialRepository,
    generateCredentialId: () => randomUUID(),
    removePendingPartition: (partitionName) => removePendingPartition(userDataDir, partitionName),
    onCredentialPartitionReplaced: (previousPartitionName) =>
      browserManager?.retirePartition(previousPartitionName),
    logger: log,
    onAccountBound: (channel) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.otaCredential.discoveryCompleted, { channel });
      }
    },
  });
  openMainWindow();
  log.info('Application initialization completed');
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
} else {
  void app
    .whenReady()
    .then(initializeApplication)
    .catch((error: unknown) => {
      log.error('Application initialization failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      app.quit();
    });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    openMainWindow();
  }
});

app.once('will-quit', () => {
  log.info('Application shutdown started');
  unregisterAuthHandlers?.();
  unregisterHotelManagementHandlers?.();
  unregisterCalendarHandlers?.();
  unregisterBrowserHandlers?.();
  unregisterAutomationHandlers?.();
  ctripAutomation?.destroy();
  browserManager?.destroy();
  applicationDatabase?.close();
  if (applicationDatabase) log.info('Application database closed');
  applicationDatabase = null;
  calendarRepository = null;
  discoverAndCreate = null;
  otaCredentialRepository = null;
  otaHotelProbRepository = null;
  hotelManagementFeature = null;
  tabEventBus = null;
  sessionFactory = null;
  log.info('Application shutdown completed');
});
