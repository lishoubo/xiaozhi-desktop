import { z } from 'zod';
import { browserTabSchema, type BrowserBounds, type BrowserTab } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke, ValidatedSubscribe } from '../invoke';

const browserTabListSchema = z.array(browserTabSchema);
const booleanSchema = z.boolean();
const voidSchema = z.undefined();

export function createBrowserApi(invoke: ValidatedInvoke, subscribe: ValidatedSubscribe) {
  return Object.freeze({
    activate: (tabId: string) => invoke(browserTabSchema, IPC_CHANNELS.browser.activate, tabId),
    close: (tabId: string) => invoke(voidSchema, IPC_CHANNELS.browser.close, tabId),
    goBack: (tabId: string) => invoke(voidSchema, IPC_CHANNELS.browser.goBack, tabId),
    goForward: (tabId: string) => invoke(voidSchema, IPC_CHANNELS.browser.goForward, tabId),
    getAudioMuted: () => invoke(booleanSchema, IPC_CHANNELS.browser.getAudioMuted),
    hide: () => invoke(voidSchema, IPC_CHANNELS.browser.hide),
    list: () => invoke(browserTabListSchema, IPC_CHANNELS.browser.list),
    reload: (tabId: string) => invoke(voidSchema, IPC_CHANNELS.browser.reload, tabId),
    setBounds: (bounds: BrowserBounds) =>
      invoke(voidSchema, IPC_CHANNELS.browser.setBounds, bounds),
    setAudioMuted: (muted: boolean) =>
      invoke(booleanSchema, IPC_CHANNELS.browser.setAudioMuted, muted),
    onStateChanged: (listener: (tab: BrowserTab) => void) =>
      subscribe(browserTabSchema, IPC_CHANNELS.browser.stateChanged, listener),
  });
}
