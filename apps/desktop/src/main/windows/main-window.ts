import { BrowserWindow } from 'electron';
import path from 'node:path';
import { resolveRendererDevServerUrl } from './renderer-dev-server-url';
import { createMainWindowOptions } from './window-options';

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(createMainWindowOptions(path.join(__dirname, 'preload.js')));

  // The application shell is local and never needs to navigate or create child windows.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(resolveRendererDevServerUrl(MAIN_WINDOW_VITE_DEV_SERVER_URL));
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return mainWindow;
}
