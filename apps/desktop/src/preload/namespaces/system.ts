import { systemPreferencesSchema } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

export function createSystemApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    getPreferences: () => invoke(systemPreferencesSchema, IPC_CHANNELS.system.getPreferences),
    setAutoLaunch: (enabled: boolean) =>
      invoke(systemPreferencesSchema, IPC_CHANNELS.system.setAutoLaunch, enabled),
  });
}
