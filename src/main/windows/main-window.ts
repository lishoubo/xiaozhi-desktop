import { BrowserWindow } from 'electron';
import path from 'node:path';
import { createMainWindowOptions } from './window-options';

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(createMainWindowOptions(path.join(__dirname, 'preload.js')));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
}
