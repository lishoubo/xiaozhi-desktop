import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  BrowserBounds,
  BrowserTab,
  CookieImportResult,
  SystemPreferences,
} from '../shared/browser';
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
  browser: Readonly<{
    create: (channelId: string, url: string) => Promise<BrowserTab>;
    activate: (tabId: string) => Promise<BrowserTab>;
    close: (tabId: string) => Promise<void>;
    goBack: (tabId: string) => Promise<void>;
    goForward: (tabId: string) => Promise<void>;
    hide: () => Promise<void>;
    list: () => Promise<BrowserTab[]>;
    reload: (tabId: string) => Promise<void>;
    setBounds: (bounds: BrowserBounds) => Promise<void>;
    onStateChanged: (listener: (tab: BrowserTab) => void) => () => void;
  }>;
  cookies: Readonly<{
    import: () => Promise<CookieImportResult>;
  }>;
  system: Readonly<{
    getPreferences: () => Promise<SystemPreferences>;
    setAutoLaunch: (enabled: boolean) => Promise<SystemPreferences>;
  }>;
}>;

type RuntimeVersions = Readonly<{
  chrome: string;
  electron: string;
  node: string;
}>;

type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>;
type Subscribe = (channel: string, listener: (value: unknown) => void) => () => void;

export function createDesktopApi(
  versions: RuntimeVersions,
  invoke: Invoke,
  subscribe: Subscribe = () => () => undefined,
): DesktopApi {
  const settings = Object.freeze({
    list: () => invoke<AppSetting[]>(IPC_CHANNELS.settings.list),
    get: (key: string) => invoke<AppSetting | null>(IPC_CHANNELS.settings.get, key),
    set: (key: string, value: JsonValue) =>
      invoke<AppSetting>(IPC_CHANNELS.settings.set, { key, value }),
    delete: (key: string) => invoke<boolean>(IPC_CHANNELS.settings.delete, key),
  });
  const browser = Object.freeze({
    create: (channelId: string, url: string) =>
      invoke<BrowserTab>(IPC_CHANNELS.browser.create, { channelId, url }),
    activate: (tabId: string) => invoke<BrowserTab>(IPC_CHANNELS.browser.activate, tabId),
    close: (tabId: string) => invoke<void>(IPC_CHANNELS.browser.close, tabId),
    goBack: (tabId: string) => invoke<void>(IPC_CHANNELS.browser.goBack, tabId),
    goForward: (tabId: string) => invoke<void>(IPC_CHANNELS.browser.goForward, tabId),
    hide: () => invoke<void>(IPC_CHANNELS.browser.hide),
    list: () => invoke<BrowserTab[]>(IPC_CHANNELS.browser.list),
    reload: (tabId: string) => invoke<void>(IPC_CHANNELS.browser.reload, tabId),
    setBounds: (bounds: BrowserBounds) => invoke<void>(IPC_CHANNELS.browser.setBounds, bounds),
    onStateChanged: (listener: (tab: BrowserTab) => void) =>
      subscribe(IPC_CHANNELS.browser.stateChanged, (value) => listener(value as BrowserTab)),
  });
  const cookies = Object.freeze({
    import: () => invoke<CookieImportResult>(IPC_CHANNELS.cookies.import),
  });
  const system = Object.freeze({
    getPreferences: () => invoke<SystemPreferences>(IPC_CHANNELS.system.getPreferences),
    setAutoLaunch: (enabled: boolean) =>
      invoke<SystemPreferences>(IPC_CHANNELS.system.setAutoLaunch, enabled),
  });

  return Object.freeze({
    versions: Object.freeze({
      chrome: versions.chrome,
      electron: versions.electron,
      node: versions.node,
    }),
    browser,
    cookies,
    settings,
    system,
  });
}
