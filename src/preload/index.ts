import { contextBridge } from 'electron';
import { createDesktopApi } from './api';

contextBridge.exposeInMainWorld('hotelButler', createDesktopApi(process.versions));
