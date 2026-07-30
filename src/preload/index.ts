import { contextBridge, ipcRenderer } from 'electron';
import { createDesktopApi } from './api';

contextBridge.exposeInMainWorld(
  'hotelButler',
  createDesktopApi(process.versions, (channel, ...args) => ipcRenderer.invoke(channel, ...args)),
);
