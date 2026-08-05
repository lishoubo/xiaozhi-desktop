import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { CtripCheckInResult } from '../../shared/automation';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';

const noArgumentsSchema = z.tuple([]);

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
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (event.sender !== window.webContents) {
      logger.warn('Rejected untrusted IPC request', { channel });
      throw new Error('拒绝来自非主应用窗口的请求');
    }
    if (!noArgumentsSchema.safeParse(args).success) {
      logger.warn('Rejected invalid IPC request', { channel });
      throw new Error('请求参数无效');
    }
    return result;
  });

  return () => ipcMain.removeHandler(channel);
}
