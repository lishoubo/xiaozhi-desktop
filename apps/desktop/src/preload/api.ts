/* eslint-disable import/no-unresolved -- ESLint's legacy resolver does not read this workspace package subpath export. */
import {
  employeeIdentitySchema,
  logoutResponseSchema,
  phoneCodeRequestResponseSchema,
  type EmployeeIdentity,
} from '@hotel-butler/api/contracts';
/* eslint-enable import/no-unresolved */
import { z, type ZodType } from 'zod';
import { ctripCheckInResultSchema, type CtripCheckInResult } from '../shared/automation';
import {
  browserCookieSourceSchema,
  browserRequestInterceptionSchema,
  browserTabSchema,
  cookieImportResultSchema,
  importedChannelSummarySchema,
  otaCredentialListSchema,
  otaDiscoveryCompletedEventSchema,
  systemPreferencesSchema,
  type BrowserBounds,
  type BrowserCookieSource,
  type BrowserCookieSourceId,
  type BrowserRequestInterception,
  type BrowserTab,
  type CookieImportResult,
  type ImportedChannelSummary,
  type OtaCredentialDto,
  type OtaDiscoveryCompletedEvent,
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
const importedChannelSummaryListSchema = z.array(importedChannelSummarySchema);
const booleanSchema = z.boolean();
const optionalCtripCheckInResultSchema = ctripCheckInResultSchema.nullable();
const voidSchema = z.undefined();

export type DesktopApi = Readonly<{
  auth: Readonly<{
    currentSession: () => Promise<EmployeeIdentity | null>;
    loginWithPhoneCode: (phone: string, code: string) => Promise<EmployeeIdentity>;
    logout: () => Promise<Readonly<{ success: true }>>;
    requestPhoneCode: (
      phone: string,
    ) => Promise<Readonly<{ accepted: true; expiresInSeconds: number }>>;
  }>;
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
    getAudioMuted: () => Promise<boolean>;
    hide: () => Promise<void>;
    list: () => Promise<BrowserTab[]>;
    reload: (tabId: string) => Promise<void>;
    setBounds: (bounds: BrowserBounds) => Promise<void>;
    setAudioMuted: (muted: boolean) => Promise<boolean>;
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
    listImportedChannels: () => Promise<ImportedChannelSummary[]>;
  }>;
  otaCredential: Readonly<{
    listByChannel: (channelId: string) => Promise<OtaCredentialDto[]>;
    openExisting: (credentialId: string) => Promise<BrowserTab>;
    openForNewLogin: (input: StartLoginInput) => Promise<BrowserTab>;
    openWithImportedCookie: (input: StartLoginInput) => Promise<BrowserTab>;
    onDiscoveryCompleted: (listener: (event: OtaDiscoveryCompletedEvent) => void) => () => void;
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
  const auth = Object.freeze({
    currentSession: () =>
      invokeValidated(employeeIdentitySchema.nullable(), IPC_CHANNELS.auth.currentSession),
    loginWithPhoneCode: (phone: string, code: string) =>
      invokeValidated(employeeIdentitySchema, IPC_CHANNELS.auth.loginWithPhoneCode, phone, code),
    logout: () => invokeValidated(logoutResponseSchema, IPC_CHANNELS.auth.logout),
    requestPhoneCode: (phone: string) =>
      invokeValidated(phoneCodeRequestResponseSchema, IPC_CHANNELS.auth.requestPhoneCode, phone),
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
    getAudioMuted: () => invokeValidated(booleanSchema, IPC_CHANNELS.browser.getAudioMuted),
    hide: () => invokeValidated(voidSchema, IPC_CHANNELS.browser.hide),
    list: () => invokeValidated(browserTabListSchema, IPC_CHANNELS.browser.list),
    reload: (tabId: string) => invokeValidated(voidSchema, IPC_CHANNELS.browser.reload, tabId),
    setBounds: (bounds: BrowserBounds) =>
      invokeValidated(voidSchema, IPC_CHANNELS.browser.setBounds, bounds),
    setAudioMuted: (muted: boolean) =>
      invokeValidated(booleanSchema, IPC_CHANNELS.browser.setAudioMuted, muted),
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
    listImportedChannels: () =>
      invokeValidated(importedChannelSummaryListSchema, IPC_CHANNELS.cookies.listImportedChannels),
  });
  const otaCredential = Object.freeze({
    listByChannel: (channelId: string) =>
      invokeValidated(otaCredentialListSchema, IPC_CHANNELS.otaCredential.listByChannel, channelId),
    openExisting: (credentialId: string) =>
      invokeValidated(browserTabSchema, IPC_CHANNELS.otaCredential.openExisting, credentialId),
    openForNewLogin: (input: StartLoginInput) =>
      invokeValidated(browserTabSchema, IPC_CHANNELS.otaCredential.openForNewLogin, input),
    openWithImportedCookie: (input: StartLoginInput) =>
      invokeValidated(
        browserTabSchema,
        IPC_CHANNELS.otaCredential.openWithImportedCookie,
        input,
      ),
    onDiscoveryCompleted: (listener: (event: OtaDiscoveryCompletedEvent) => void) =>
      subscribeValidated(
        otaDiscoveryCompletedEventSchema,
        IPC_CHANNELS.otaCredential.discoveryCompleted,
        listener,
      ),
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
    auth,
    versions: Object.freeze({
      chrome: versions.chrome,
      electron: versions.electron,
      node: versions.node,
    }),
    browser,
    calendar,
    cookies,
    otaCredential,
    system,
  });
}
