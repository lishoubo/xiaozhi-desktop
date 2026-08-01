import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { CtripCheckInResult } from '../../shared/automation';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';

type RegisterAutomationHandlersOptions = Readonly<{
  window: Readonly<{ webContents: unknown }>;
  result: Promise<CtripCheckInResult> | null;
  logger: AppLogger;
}>;

export function registerAutomationHandlers({
  window,
  result,
  logger,
}: RegisterAutomationHandlersOptions): () => void {
  const channel = IPC_CHANNELS.automation.getCtripCheckIn;
  ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents) {
      logger.warn('Rejected untrusted IPC request', { channel });
      throw new Error('拒绝来自非主应用窗口的请求');
    }
    return result;
  });

  return () => ipcMain.removeHandler(channel);
}
