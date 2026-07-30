import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { AppSetting, JsonValue } from '../shared/settings';

export type DesktopApi = Readonly<{
  versions: Readonly<{
    chrome: string;
    electron: string;
    node: string;
  }>;
  settings: Readonly<{
    list: () => Promise<AppSetting[]>;
    get: (key: string) => Promise<AppSetting | null>;
    set: (key: string, value: JsonValue) => Promise<AppSetting>;
    delete: (key: string) => Promise<boolean>;
  }>;
}>;

type RuntimeVersions = Readonly<{
  chrome: string;
  electron: string;
  node: string;
}>;

type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>;

export function createDesktopApi(versions: RuntimeVersions, invoke: Invoke): DesktopApi {
  const settings = Object.freeze({
    list: () => invoke<AppSetting[]>(IPC_CHANNELS.settings.list),
    get: (key: string) => invoke<AppSetting | null>(IPC_CHANNELS.settings.get, key),
    set: (key: string, value: JsonValue) =>
      invoke<AppSetting>(IPC_CHANNELS.settings.set, { key, value }),
    delete: (key: string) => invoke<boolean>(IPC_CHANNELS.settings.delete, key),
  });

  return Object.freeze({
    versions: Object.freeze({
      chrome: versions.chrome,
      electron: versions.electron,
      node: versions.node,
    }),
    settings,
  });
}
