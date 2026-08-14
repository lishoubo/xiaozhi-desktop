/**
 * 进程入口 —— 只做 Electron 生命周期编排，不 new 任何业务对象。
 * 对象装配全部在 `composition/`：进程级看 `app-scope.ts`，窗口级看 `window-scope.ts`。
 */
import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import started from 'electron-squirrel-startup';
import { AUTH_VARIANT } from '../shared/auth-variant';
import {
  configureDesktopLogDirectory,
  configureMainLogging,
} from './logging/configure-main-logging';
import { configureNetworkPrivacy } from './security/network-privacy';
import { createAppScope, type AppScope } from './composition/app-scope';
import { createWindowScope, type WindowScope } from './composition/window-scope';

let appScope: AppScope | null = null;
let windowScope: WindowScope | null = null;

configureNetworkPrivacy(app.commandLine);
const logsDirectory = configureDesktopLogDirectory(app, AUTH_VARIANT);
configureMainLogging(log, {
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  logsDirectory,
  platform: process.platform,
});

function openMainWindow(): void {
  if (!appScope) throw new Error('Application scope is not initialized');
  windowScope = createWindowScope(appScope);
}

function initializeApplication(): void {
  log.info('Application initialization started');
  appScope = createAppScope(log);
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
  windowScope?.dispose();
  windowScope = null;
  appScope?.dispose();
  appScope = null;
  log.info('Application shutdown completed');
});
