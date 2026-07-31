import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { BrowserBounds, SystemPreferences } from '../../shared/browser';
import { BrowserManager } from '../browser/browser-manager';
import { parseCookieExport } from '../browser/cookie-import';

type RegisterBrowserHandlersOptions = Readonly<{
  window: BrowserWindow;
  manager: BrowserManager;
}>;

function systemPreferences(): SystemPreferences {
  return {
    autoLaunch: app.getLoginItemSettings().openAtLogin,
    version: app.getVersion(),
  };
}

export function registerBrowserHandlers({
  window,
  manager,
}: RegisterBrowserHandlersOptions): () => void {
  const assertTrusted = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== window.webContents) throw new Error('拒绝来自非主应用窗口的请求');
  };
  const handle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrusted(event);
      return listener(event, ...args);
    });
  };

  handle(IPC_CHANNELS.browser.create, (_event, input) => {
    if (!input || typeof input !== 'object') throw new Error('浏览器参数无效');
    const { channelId, url } = input as { channelId?: unknown; url?: unknown };
    if (typeof channelId !== 'string' || typeof url !== 'string') {
      throw new Error('浏览器参数无效');
    }
    return manager.create(channelId, url);
  });
  handle(IPC_CHANNELS.browser.activate, (_event, tabId) => {
    if (typeof tabId !== 'string') throw new Error('标签标识无效');
    return manager.activate(tabId);
  });
  handle(IPC_CHANNELS.browser.close, (_event, tabId) => {
    if (typeof tabId !== 'string') throw new Error('标签标识无效');
    manager.close(tabId);
  });
  handle(IPC_CHANNELS.browser.goBack, (_event, tabId) => {
    if (typeof tabId !== 'string') throw new Error('标签标识无效');
    manager.goBack(tabId);
  });
  handle(IPC_CHANNELS.browser.goForward, (_event, tabId) => {
    if (typeof tabId !== 'string') throw new Error('标签标识无效');
    manager.goForward(tabId);
  });
  handle(IPC_CHANNELS.browser.hide, () => manager.hide());
  handle(IPC_CHANNELS.browser.list, () => manager.list());
  handle(IPC_CHANNELS.browser.reload, (_event, tabId) => {
    if (typeof tabId !== 'string') throw new Error('标签标识无效');
    manager.reload(tabId);
  });
  handle(IPC_CHANNELS.browser.setBounds, (_event, bounds) => {
    if (!bounds || typeof bounds !== 'object') throw new Error('浏览器区域尺寸无效');
    manager.setBounds(bounds as BrowserBounds);
  });
  handle(IPC_CHANNELS.cookies.import, async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: '导入浏览器 Cookie',
      buttonLabel: '导入',
      properties: ['openFile'],
      filters: [
        { name: 'Cookie 导出文件', extensions: ['json', 'txt', 'cookies'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return { cancelled: true, imported: 0, failed: 0 };
    }
    const cookies = parseCookieExport(await fs.readFile(selection.filePaths[0], 'utf8'));
    const results = await Promise.allSettled(
      cookies.map((cookie) => manager.browserSession.cookies.set(cookie)),
    );
    const imported = results.filter((result) => result.status === 'fulfilled').length;
    return { cancelled: false, imported, failed: results.length - imported };
  });
  handle(IPC_CHANNELS.system.getPreferences, () => systemPreferences());
  handle(IPC_CHANNELS.system.setAutoLaunch, (_event, enabled) => {
    if (typeof enabled !== 'boolean') throw new Error('开机启动设置无效');
    app.setLoginItemSettings({ openAtLogin: enabled });
    return systemPreferences();
  });

  const channels = [
    ...Object.values(IPC_CHANNELS.browser).filter(
      (channel) => channel !== IPC_CHANNELS.browser.stateChanged,
    ),
    ...Object.values(IPC_CHANNELS.cookies),
    ...Object.values(IPC_CHANNELS.system),
  ];
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
