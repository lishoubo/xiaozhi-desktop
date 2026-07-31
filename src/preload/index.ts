import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopApi } from './api';

contextBridge.exposeInMainWorld(
  'hotelButler',
  createDesktopApi(
    process.versions,
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => listener(value);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  ),
);
