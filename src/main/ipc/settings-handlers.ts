import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { SettingsService } from '../settings/settings-service';

type RegisterSettingsHandlersOptions = Readonly<{
  service: SettingsService;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}>;

export function registerSettingsHandlers({
  service,
  isTrustedSender,
}: RegisterSettingsHandlersOptions): () => void {
  const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
    if (!isTrustedSender(event)) {
      throw new Error('拒绝来自非主应用窗口的数据库请求');
    }
  };

  ipcMain.handle(IPC_CHANNELS.settings.list, (event) => {
    assertTrustedSender(event);
    return service.list();
  });
  ipcMain.handle(IPC_CHANNELS.settings.get, (event, key: unknown) => {
    assertTrustedSender(event);
    return service.get(key);
  });
  ipcMain.handle(IPC_CHANNELS.settings.set, (event, input: unknown) => {
    assertTrustedSender(event);
    return service.set(input);
  });
  ipcMain.handle(IPC_CHANNELS.settings.delete, (event, key: unknown) => {
    assertTrustedSender(event);
    return service.delete(key);
  });

  return () => {
    for (const channel of Object.values(IPC_CHANNELS.settings)) {
      ipcMain.removeHandler(channel);
    }
  };
}
