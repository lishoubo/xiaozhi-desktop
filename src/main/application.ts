import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { registerBrowserHandlers } from './ipc/browser-handlers';
import { BrowserManager } from './browser/browser-manager';
import { configureNetworkPrivacy } from './security/network-privacy';
import { createMainWindow } from './windows/main-window';
import { configureMainLogging } from './logging/configure-main-logging';
import { CtripCheckInAutomation } from './automation/ctrip-check-in-automation';
import { registerAutomationHandlers } from './ipc/automation-handlers';
import { openApplicationDatabase, type ApplicationDatabase } from './database/application-database';
import { SqliteCalendarRepository } from './calendar/calendar-repository';
import { registerCalendarHandlers } from './ipc/calendar-handlers';

let mainWindow: BrowserWindow | null = null;
let browserManager: BrowserManager | null = null;
let unregisterBrowserHandlers: (() => void) | null = null;
let ctripAutomation: CtripCheckInAutomation | null = null;
let unregisterAutomationHandlers: (() => void) | null = null;
let applicationDatabase: ApplicationDatabase | null = null;
let calendarRepository: SqliteCalendarRepository | null = null;
let unregisterCalendarHandlers: (() => void) | null = null;

configureNetworkPrivacy(app.commandLine);
configureMainLogging(log, {
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
});

function openMainWindow(): void {
  if (!calendarRepository) throw new Error('Calendar repository is not initialized');
  mainWindow = createMainWindow();
  log.info('Main window created');
  browserManager = new BrowserManager(mainWindow, log);
  const automationDisabled = process.env.HOTEL_BUTLER_DISABLE_STARTUP_AUTOMATION === '1';
  ctripAutomation = automationDisabled
    ? null
    : new CtripCheckInAutomation(browserManager.browserSession, log);
  const ctripResult = ctripAutomation?.start() ?? null;
  unregisterBrowserHandlers = registerBrowserHandlers({
    window: mainWindow,
    manager: browserManager,
    logger: log,
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
  mainWindow.once('closed', () => {
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
  applicationDatabase = openApplicationDatabase(
    path.join(app.getPath('userData'), 'hotel-butler.sqlite'),
    log,
    { includeMockData: !app.isPackaged },
  );
  calendarRepository = new SqliteCalendarRepository(applicationDatabase);
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
  unregisterCalendarHandlers?.();
  unregisterBrowserHandlers?.();
  unregisterAutomationHandlers?.();
  ctripAutomation?.destroy();
  browserManager?.destroy();
  applicationDatabase?.close();
  if (applicationDatabase) log.info('Application database closed');
  applicationDatabase = null;
  calendarRepository = null;
  log.info('Application shutdown completed');
});
