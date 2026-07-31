import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { openDatabase, type DatabaseConnection } from './database/connection';
import { registerSettingsHandlers } from './ipc/settings-handlers';
import { registerBrowserHandlers } from './ipc/browser-handlers';
import { BrowserManager } from './browser/browser-manager';
import { configureNetworkPrivacy } from './security/network-privacy';
import { SettingsRepository } from './settings/settings-repository';
import { SettingsService } from './settings/settings-service';
import { createMainWindow } from './windows/main-window';
import { configureMainLogging } from './logging/configure-main-logging';

let mainWindow: BrowserWindow | null = null;
let databaseConnection: DatabaseConnection | null = null;
let unregisterIpcHandlers: (() => void) | null = null;
let browserManager: BrowserManager | null = null;
let unregisterBrowserHandlers: (() => void) | null = null;

configureNetworkPrivacy(app.commandLine);
configureMainLogging(log, {
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
});

function getDatabasePath(): string {
  const testDatabasePath = app.isPackaged ? undefined : process.env.HOTEL_BUTLER_DATABASE_PATH;

  return testDatabasePath ?? path.join(app.getPath('userData'), 'hotel-butler.sqlite3');
}

function getMigrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'drizzle')
    : path.resolve(__dirname, '../../drizzle');
}

function openMainWindow(): void {
  mainWindow = createMainWindow();
  browserManager = new BrowserManager(mainWindow);
  unregisterBrowserHandlers = registerBrowserHandlers({
    window: mainWindow,
    manager: browserManager,
  });
  mainWindow.once('closed', () => {
    unregisterBrowserHandlers?.();
    unregisterBrowserHandlers = null;
    browserManager?.destroy();
    browserManager = null;
    mainWindow = null;
  });
}

function initializeApplication(): void {
  databaseConnection = openDatabase(getDatabasePath(), getMigrationsFolder());
  const settingsService = new SettingsService(new SettingsRepository(databaseConnection.db));

  unregisterIpcHandlers = registerSettingsHandlers({
    service: settingsService,
    isTrustedSender: (event) => event.sender === mainWindow?.webContents,
  });

  openMainWindow();
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
} else {
  void app
    .whenReady()
    .then(initializeApplication)
    .catch((error: unknown) => {
      log.error('Application initialization failed', error);
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
  unregisterIpcHandlers?.();
  unregisterBrowserHandlers?.();
  browserManager?.destroy();
  databaseConnection?.close();
});
