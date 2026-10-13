import { contextBridge, ipcRenderer } from 'electron';
import { dialogKindOf, installDialogObserver } from './preload/dialog-observer';

const OBSERVER_EVENT = 'xiaozhi:embedded-web-dialog-observed';
const IPC_CHANNEL = 'embedded-web:javascript-dialog';

window.addEventListener(OBSERVER_EVENT, (event) => {
  const kind = dialogKindOf(event);
  if (kind !== null) ipcRenderer.send(IPC_CHANNEL, kind);
});

contextBridge.executeInMainWorld({
  func: installDialogObserver,
  args: [OBSERVER_EVENT],
});
