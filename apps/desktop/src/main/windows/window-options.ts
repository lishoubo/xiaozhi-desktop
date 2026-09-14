import type { BrowserWindowConstructorOptions } from 'electron';

export function createMainWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // 应用标题栏由 renderer 的 AppFrame header 承担，省下原生标题栏的垂直空间
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f5f7f8', symbolColor: '#3f4855', height: 42 },
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
}
