import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { registerBrowserHandlers } from './ipc/browser-handlers';
import { BrowserManager } from './browser/browser-manager';
import { configureNetworkPrivacy } from './security/network-privacy';
import { createMainWindow } from './windows/main-window';
import { configureMainLogging } from './logging/configure-main-logging';

let mainWindow: BrowserWindow | null = null;
let browserManager: BrowserManager | null = null;
let unregisterBrowserHandlers: (() => void) | null = null;

configureNetworkPrivacy(app.commandLine);
configureMainLogging(log, {
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
});

function openMainWindow(): void {
  mainWindow = createMainWindow();
  log.info('Main window created');
  browserManager = new BrowserManager(mainWindow, log);
  unregisterBrowserHandlers = registerBrowserHandlers({
    window: mainWindow,
    manager: browserManager,
    logger: log,
  });
  mainWindow.once('closed', () => {
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
  unregisterBrowserHandlers?.();
  browserManager?.destroy();
  log.info('Application shutdown completed');
});
