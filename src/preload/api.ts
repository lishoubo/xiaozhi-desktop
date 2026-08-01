import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { CtripCheckInResult } from '../shared/automation';
import type {
  BrowserBounds,
  BrowserCookieSource,
  BrowserCookieSourceId,
  BrowserRequestInterception,
  BrowserTab,
  CookieImportResult,
  SystemPreferences,
} from '../shared/browser';

export type DesktopApi = Readonly<{
  automation: Readonly<{
    getCtripCheckIn: () => Promise<CtripCheckInResult | null>;
  }>;
  versions: Readonly<{
    chrome: string;
    electron: string;
    node: string;
  }>;
  browser: Readonly<{
    acknowledgeInterception: () => Promise<void>;
    create: (channelId: string, url: string) => Promise<BrowserTab>;
    activate: (tabId: string) => Promise<BrowserTab>;
    close: (tabId: string) => Promise<void>;
    goBack: (tabId: string) => Promise<void>;
    goForward: (tabId: string) => Promise<void>;
    hide: () => Promise<void>;
    list: () => Promise<BrowserTab[]>;
    reload: (tabId: string) => Promise<void>;
    setBounds: (bounds: BrowserBounds) => Promise<void>;
    onRequestIntercepted: (listener: (event: BrowserRequestInterception) => void) => () => void;
    onStateChanged: (listener: (tab: BrowserTab) => void) => () => void;
  }>;
  cookies: Readonly<{
    listSources: () => Promise<BrowserCookieSource[]>;
    import: (sourceId: BrowserCookieSourceId) => Promise<CookieImportResult>;
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
  const automation = Object.freeze({
    getCtripCheckIn: () =>
      invoke<CtripCheckInResult | null>(IPC_CHANNELS.automation.getCtripCheckIn),
  });
  const browser = Object.freeze({
    acknowledgeInterception: () => invoke<void>(IPC_CHANNELS.browser.acknowledgeInterception),
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
    onRequestIntercepted: (listener: (event: BrowserRequestInterception) => void) =>
      subscribe(IPC_CHANNELS.browser.requestIntercepted, (value) =>
        listener(value as BrowserRequestInterception),
      ),
    onStateChanged: (listener: (tab: BrowserTab) => void) =>
      subscribe(IPC_CHANNELS.browser.stateChanged, (value) => listener(value as BrowserTab)),
  });
  const cookies = Object.freeze({
    listSources: () => invoke<BrowserCookieSource[]>(IPC_CHANNELS.cookies.listSources),
    import: (sourceId: BrowserCookieSourceId) =>
      invoke<CookieImportResult>(IPC_CHANNELS.cookies.import, sourceId),
  });
  const system = Object.freeze({
    getPreferences: () => invoke<SystemPreferences>(IPC_CHANNELS.system.getPreferences),
    setAutoLaunch: (enabled: boolean) =>
      invoke<SystemPreferences>(IPC_CHANNELS.system.setAutoLaunch, enabled),
  });

  return Object.freeze({
    automation,
    versions: Object.freeze({
      chrome: versions.chrome,
      electron: versions.electron,
      node: versions.node,
    }),
    browser,
    cookies,
    system,
  });
}
