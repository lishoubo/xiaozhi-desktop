import type { BrowserWindowConstructorOptions } from 'electron';

export function createMainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
}
