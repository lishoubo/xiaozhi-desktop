import { app, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { registerBrowserHandlers } from './ipc/browser-handlers';
import { registerCookieHandlers } from './ipc/cookie-handlers';
import { registerOtaCredentialHandlers } from './ipc/ota-credential-handlers';
import { registerSystemHandlers } from './ipc/system-handlers';
import { registerOtaTabHandlers } from './ipc/ota-tab-handlers';
import { BrowserCookieImporter } from './cookie-import/browser-cookie-importer';
import { CookieImportService } from './services/cookie-import-service';
import { SystemService } from './services/system-service';
import { CalendarService } from './services/calendar-service';
import { AuthService } from './services/auth-service';
import { BrowserManager } from './browser/browser-manager';
import { TabEventBus } from './services/tab-event-bus';
import { configureNetworkPrivacy } from './security/network-privacy';
import { createMainWindow } from './windows/main-window';
import { configureMainLogging } from './logging/configure-main-logging';
import { CtripCheckInAutomation } from './automation/ctrip-check-in-automation';
import { registerAutomationHandlers } from './ipc/automation-handlers';
import { openApplicationDatabase, type ApplicationDatabase } from './database/application-database';
import { SqliteCalendarRepository } from './calendar/calendar-repository';
import { registerCalendarHandlers } from './ipc/calendar-handlers';
import { isStartupAutomationEnabled } from './startup-enabled';
import { SqliteOtaCredentialRepository } from './database/ota-credential-repository';
import { SqliteOtaHotelRepository } from './database/ota-hotel-repository';
import { OtaCredentialService } from './services/ota-credential-service';
import { OtaTabOpener } from './ota-tab/ota-tab-opener';
import { createChannelRegistry, hotelProbes, loginUrlMatchers } from './channels/registry';
import { createCtripDiscovery } from './channels/ctrip/discovery';
import { createDouyinDiscovery } from './channels/douyin/discovery';
import { createMeituanDiscovery } from './channels/meituan/discovery';
import { OtaHotelProbService } from './services/ota-hotel-prob-service';
import { HotelManagementService } from './services/hotel-management-service';
import { MockRmsHotelGateway } from './gateway/rms/rms-hotel-gateway-mock';
import { MockRmsOtaAccountGateway } from './gateway/rms/rms-ota-account-gateway-mock';
import { registerHotelManagementHandlers } from './ipc/hotel-management-handlers';
import { removePendingPartition } from './file-store/pending-partitions-store';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { SessionFactory } from './browser/session-factory';
import { createElectronSessionFetch, createServerTrpcClient } from './server-client/trpc-client';
import { resolveServerOrigin } from './server-client/config';
import { registerAuthHandlers } from './ipc/auth-handlers';

let mainWindow: BrowserWindow | null = null;
let browserManager: BrowserManager | null = null;
let tabEventBus: TabEventBus | null = null;
let otaTabOpener: OtaTabOpener | null = null;
let unregisterBrowserHandlers: (() => void) | null = null;
let unregisterCookieHandlers: (() => void) | null = null;
let unregisterOtaCredentialHandlers: (() => void) | null = null;
let unregisterSystemHandlers: (() => void) | null = null;
let unregisterOtaTabHandlers: (() => void) | null = null;
let ctripAutomation: CtripCheckInAutomation | null = null;
let unregisterAutomationHandlers: (() => void) | null = null;
let applicationDatabase: ApplicationDatabase | null = null;
let calendarRepository: SqliteCalendarRepository | null = null;
let unregisterCalendarHandlers: (() => void) | null = null;
let unregisterAuthHandlers: (() => void) | null = null;
let otaCredentialService: OtaCredentialService | null = null;
let otaCredentialRepository: SqliteOtaCredentialRepository | null = null;
let otaHotelRepository: SqliteOtaHotelRepository | null = null;
let sessionFactory: SessionFactory | null = null;
let hotelManagementService: HotelManagementService | null = null;
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
  if (!otaHotelRepository) throw new Error('OtaHotel repository is not initialized');
  if (!sessionFactory) throw new Error('Session factory is not initialized');
  if (!hotelManagementService) throw new Error('Hotel management feature is not initialized');
  mainWindow = createMainWindow();
  log.info('Main window created');
  tabEventBus = new TabEventBus();
  browserManager = new BrowserManager(mainWindow, log, sessionFactory);
  ctripAutomation = isStartupAutomationEnabled(process.env)
    ? new CtripCheckInAutomation(browserManager.browserSession, log)
    : null;
  const ctripResult = ctripAutomation?.start() ?? null;
  if (!otaCredentialService) throw new Error('Discovery pipeline is not initialized');
  const channelRegistry = createChannelRegistry(log);
  // 构造函数内部完成 tabEventBus 订阅；订阅回调闭包持有 this 引用，只要
  // tabEventBus 存活这个 Feature 实例就不会被 GC，不需要模块级变量持有它。
  new OtaHotelProbService({
    tabEventBus,
    probes: hotelProbes(channelRegistry),
    repository: otaHotelRepository,
    logger: log,
  });
  otaTabOpener = new OtaTabOpener({
    userDataDir: app.getPath('userData'),
    browserManager,
    tabEventBus,
    loginUrlMatchers: loginUrlMatchers(channelRegistry),
    otaCredentialRepository,
    triggerDiscovery: (partitionName, channel, landingUrl, webContents) =>
      otaCredentialService?.trigger(partitionName, channel, landingUrl, webContents) ??
      Promise.resolve(null),
  });
  unregisterBrowserHandlers = registerBrowserHandlers({
    window: mainWindow,
    manager: browserManager,
    logger: log,
  });
  unregisterCookieHandlers = registerCookieHandlers({
    window: mainWindow,
    service: new CookieImportService({
      importer: new BrowserCookieImporter(log),
      userDataDir: app.getPath('userData'),
      logger: log,
    }),
    logger: log,
  });
  unregisterOtaCredentialHandlers = registerOtaCredentialHandlers({
    window: mainWindow,
    service: otaCredentialService,
    logger: log,
  });
  unregisterSystemHandlers = registerSystemHandlers({
    window: mainWindow,
    service: new SystemService({ app, logger: log }),
    logger: log,
  });
  unregisterOtaTabHandlers = registerOtaTabHandlers({
    window: mainWindow,
    otaTabOpener,
    logger: log,
  });
  unregisterAutomationHandlers = registerAutomationHandlers({
    window: mainWindow,
    result: ctripResult,
    logger: log,
  });
  unregisterCalendarHandlers = registerCalendarHandlers({
    window: mainWindow,
    service: new CalendarService({ repository: calendarRepository, logger: log }),
    logger: log,
  });
  unregisterHotelManagementHandlers = registerHotelManagementHandlers({
    window: mainWindow,
    feature: hotelManagementService,
    logger: log,
  });
  const serverOrigin = resolveServerOrigin(process.env);
  const apiSession = sessionFactory.sessionForServerApi();
  unregisterAuthHandlers = registerAuthHandlers({
    service: new AuthService({
      apiSession,
      client: createServerTrpcClient({
        baseUrl: serverOrigin,
        fetch: createElectronSessionFetch(apiSession),
      }),
      logger: log,
      serverOrigin,
    }),
    logger: log,
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
    unregisterOtaTabHandlers?.();
    unregisterOtaTabHandlers = null;
    unregisterSystemHandlers?.();
    unregisterSystemHandlers = null;
    unregisterOtaCredentialHandlers?.();
    unregisterOtaCredentialHandlers = null;
    unregisterCookieHandlers?.();
    unregisterCookieHandlers = null;
    unregisterBrowserHandlers?.();
    unregisterBrowserHandlers = null;
    browserManager?.destroy();
    browserManager = null;
    otaTabOpener = null;
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
  otaHotelRepository = new SqliteOtaHotelRepository(applicationDatabase);
  hotelManagementService = new HotelManagementService(
    new MockRmsHotelGateway(),
    new MockRmsOtaAccountGateway(),
  );
  otaCredentialService = new OtaCredentialService({
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
  unregisterOtaTabHandlers?.();
  unregisterSystemHandlers?.();
  unregisterOtaCredentialHandlers?.();
  unregisterCookieHandlers?.();
  unregisterBrowserHandlers?.();
  unregisterAutomationHandlers?.();
  ctripAutomation?.destroy();
  browserManager?.destroy();
  applicationDatabase?.close();
  if (applicationDatabase) log.info('Application database closed');
  applicationDatabase = null;
  calendarRepository = null;
  otaCredentialService = null;
  otaCredentialRepository = null;
  otaHotelRepository = null;
  hotelManagementService = null;
  tabEventBus = null;
  otaTabOpener = null;
  sessionFactory = null;
  log.info('Application shutdown completed');
});
