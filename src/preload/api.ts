import { z, type ZodType } from 'zod';
import { ctripCheckInResultSchema, type CtripCheckInResult } from '../shared/automation';
import {
  browserCookieSourceSchema,
  browserRequestInterceptionSchema,
  browserTabSchema,
  cookieImportResultSchema,
  systemPreferencesSchema,
  type BrowserBounds,
  type BrowserCookieSource,
  type BrowserCookieSourceId,
  type BrowserRequestInterception,
  type BrowserTab,
  type CookieImportResult,
  type StartLoginInput,
  type SystemPreferences,
} from '../shared/browser';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import {
  calendarEventRecordSchema,
  calendarSnapshotSchema,
  type CalendarEventCreateInput,
  type CalendarEventRecord,
  type CalendarEventUpdateInput,
  type CalendarSnapshot,
} from '../shared/calendar';

/*
 * IPC types protect compile-time callers; these schemas protect the renderer from
 * malformed values crossing the process boundary at runtime.
 */
const browserTabListSchema = z.array(browserTabSchema);
const browserCookieSourceListSchema = z.array(browserCookieSourceSchema);
const optionalCtripCheckInResultSchema = ctripCheckInResultSchema.nullable();
const voidSchema = z.undefined();

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
  calendar: Readonly<{
    load: () => Promise<CalendarSnapshot>;
    createEvent: (input: CalendarEventCreateInput) => Promise<CalendarEventRecord>;
    updateEvent: (input: CalendarEventUpdateInput) => Promise<CalendarEventRecord>;
    deleteEvent: (id: string) => Promise<void>;
  }>;
  cookies: Readonly<{
    listSources: () => Promise<BrowserCookieSource[]>;
    import: (sourceId: BrowserCookieSourceId) => Promise<CookieImportResult>;
  }>;
  otaAccount: Readonly<{
    startLogin: (input: StartLoginInput) => Promise<BrowserTab>;
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

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type Subscribe = (channel: string, listener: (value: unknown) => void) => () => void;

export function createDesktopApi(
  versions: RuntimeVersions,
  invoke: Invoke,
  subscribe: Subscribe = () => () => undefined,
): DesktopApi {
  const invokeValidated = <T>(
    schema: ZodType<T>,
    channel: string,
    ...args: unknown[]
  ): Promise<T> =>
    invoke(channel, ...args).then((value) => {
      const result = schema.safeParse(value);
      if (!result.success) throw new Error('主进程返回的数据格式无效');
      return result.data;
    });
  const subscribeValidated = <T>(
    schema: ZodType<T>,
    channel: string,
    listener: (value: T) => void,
  ): (() => void) =>
    subscribe(channel, (value) => {
      const result = schema.safeParse(value);
      if (result.success) listener(result.data);
    });

  const automation = Object.freeze({
    getCtripCheckIn: () =>
      invokeValidated(optionalCtripCheckInResultSchema, IPC_CHANNELS.automation.getCtripCheckIn),
  });
  const browser = Object.freeze({
    acknowledgeInterception: () =>
      invokeValidated(voidSchema, IPC_CHANNELS.browser.acknowledgeInterception),
    create: (channelId: string, url: string) =>
      invokeValidated(browserTabSchema, IPC_CHANNELS.browser.create, { channelId, url }),
    activate: (tabId: string) =>
      invokeValidated(browserTabSchema, IPC_CHANNELS.browser.activate, tabId),
    close: (tabId: string) => invokeValidated(voidSchema, IPC_CHANNELS.browser.close, tabId),
    goBack: (tabId: string) => invokeValidated(voidSchema, IPC_CHANNELS.browser.goBack, tabId),
    goForward: (tabId: string) =>
      invokeValidated(voidSchema, IPC_CHANNELS.browser.goForward, tabId),
    hide: () => invokeValidated(voidSchema, IPC_CHANNELS.browser.hide),
    list: () => invokeValidated(browserTabListSchema, IPC_CHANNELS.browser.list),
    reload: (tabId: string) => invokeValidated(voidSchema, IPC_CHANNELS.browser.reload, tabId),
    setBounds: (bounds: BrowserBounds) =>
      invokeValidated(voidSchema, IPC_CHANNELS.browser.setBounds, bounds),
    onRequestIntercepted: (listener: (event: BrowserRequestInterception) => void) =>
      subscribeValidated(
        browserRequestInterceptionSchema,
        IPC_CHANNELS.browser.requestIntercepted,
        listener,
      ),
    onStateChanged: (listener: (tab: BrowserTab) => void) =>
      subscribeValidated(browserTabSchema, IPC_CHANNELS.browser.stateChanged, listener),
  });
  const cookies = Object.freeze({
    listSources: () =>
      invokeValidated(browserCookieSourceListSchema, IPC_CHANNELS.cookies.listSources),
    import: (sourceId: BrowserCookieSourceId) =>
      invokeValidated(cookieImportResultSchema, IPC_CHANNELS.cookies.import, sourceId),
  });
  const otaAccount = Object.freeze({
    startLogin: (input: StartLoginInput) =>
      invokeValidated(browserTabSchema, IPC_CHANNELS.otaAccount.startLogin, input),
  });
  const calendar = Object.freeze({
    load: () => invokeValidated(calendarSnapshotSchema, IPC_CHANNELS.calendar.load),
    createEvent: (input: CalendarEventCreateInput) =>
      invokeValidated(calendarEventRecordSchema, IPC_CHANNELS.calendar.createEvent, input),
    updateEvent: (input: CalendarEventUpdateInput) =>
      invokeValidated(calendarEventRecordSchema, IPC_CHANNELS.calendar.updateEvent, input),
    deleteEvent: (id: string) => invokeValidated(voidSchema, IPC_CHANNELS.calendar.deleteEvent, id),
  });
  const system = Object.freeze({
    getPreferences: () =>
      invokeValidated(systemPreferencesSchema, IPC_CHANNELS.system.getPreferences),
    setAutoLaunch: (enabled: boolean) =>
      invokeValidated(systemPreferencesSchema, IPC_CHANNELS.system.setAutoLaunch, enabled),
  });

  return Object.freeze({
    automation,
    versions: Object.freeze({
      chrome: versions.chrome,
      electron: versions.electron,
      node: versions.node,
    }),
    browser,
    calendar,
    cookies,
    otaAccount,
    system,
  });
}
