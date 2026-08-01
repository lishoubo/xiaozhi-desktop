import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';

type SettingsServiceTarget = Readonly<{
  list: () => unknown;
  get: (key: unknown) => unknown;
  set: (input: unknown) => unknown;
  delete: (key: unknown) => unknown;
}>;

type RegisterSettingsHandlersOptions = Readonly<{
  service: SettingsServiceTarget;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  logger: AppLogger;
}>;

export function registerSettingsHandlers({
  service,
  isTrustedSender,
  logger,
}: RegisterSettingsHandlersOptions): () => void {
  const assertTrustedSender = (event: IpcMainInvokeEvent, channel: string): void => {
    if (!isTrustedSender(event)) {
      logger.warn('Rejected untrusted IPC request', { channel });
      throw new Error('拒绝来自非主应用窗口的数据库请求');
    }
  };

  ipcMain.handle(IPC_CHANNELS.settings.list, (event) => {
    assertTrustedSender(event, IPC_CHANNELS.settings.list);
    return service.list();
  });
  ipcMain.handle(IPC_CHANNELS.settings.get, (event, key: unknown) => {
    assertTrustedSender(event, IPC_CHANNELS.settings.get);
    return service.get(key);
  });
  ipcMain.handle(IPC_CHANNELS.settings.set, (event, input: unknown) => {
    assertTrustedSender(event, IPC_CHANNELS.settings.set);
    return service.set(input);
  });
  ipcMain.handle(IPC_CHANNELS.settings.delete, (event, key: unknown) => {
    assertTrustedSender(event, IPC_CHANNELS.settings.delete);
    return service.delete(key);
  });

  return () => {
    for (const channel of Object.values(IPC_CHANNELS.settings)) {
      ipcMain.removeHandler(channel);
    }
  };
}
