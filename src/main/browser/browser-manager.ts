import {
  BrowserWindow,
  session,
  WebContentsView,
  type Event as ElectronEvent,
  type Input,
  type Rectangle,
  type Session,
  type WebRequestFilter,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { browserWebUrlSchema, type BrowserTab } from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';
import { denyEmbeddedPagePermissions } from '../security/session-permissions';

type ManagedTab = {
  id: string;
  channelId: string;
  title: string;
  url: string;
  loading: boolean;
  view: WebContentsView;
};

const CTRIP_API_REQUEST_FILTER: WebRequestFilter = {
  urls: ['https://m.ctrip.com/restapi/soa2/*'],
};

function isReloadShortcut(
  input: Pick<Input, 'alt' | 'control' | 'key' | 'meta' | 'type'>,
): boolean {
  return (
    input.type === 'keyDown' &&
    input.key.toLowerCase() === 'r' &&
    !input.alt &&
    (input.meta || input.control)
  );
}

function assertWebUrl(url: string): void {
  if (!browserWebUrlSchema.safeParse(url).success) {
    throw new Error('仅允许打开 HTTP 或 HTTPS 网页');
  }
}

export class BrowserManager {
  readonly browserSession: Session;
  private readonly tabs = new Map<string, ManagedTab>();
  private readonly managedWebContentsIds = new Set<number>();
  private activeTabId: string | null = null;
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private interceptionAlertOpen = false;
  private readonly handleShellInput = (event: ElectronEvent, input: Input): void => {
    if (!isReloadShortcut(input)) return;

    event.preventDefault();
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    active?.view.webContents.reload();
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly logger: AppLogger,
  ) {
    this.browserSession = session.fromPartition('persist:hotel-butler-browser');
    denyEmbeddedPagePermissions(this.browserSession);
    this.window.webContents.on('before-input-event', this.handleShellInput);
    this.installRequestInterceptor();
  }

  create(channelId: string, url: string): BrowserTab {
    assertWebUrl(url);
    if (!channelId.trim()) throw new Error('渠道标识不能为空');

    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: this.browserSession,
      },
    });
    this.managedWebContentsIds.add(view.webContents.id);
    const tab: ManagedTab = {
      id,
      channelId,
      title: '正在加载…',
      url,
      loading: true,
      view,
    };
    this.tabs.set(id, tab);
    this.bindTabEvents(tab);
    this.activate(id);
    this.logger.info('Browser tab created', { channelId });
    void view.webContents.loadURL(url).catch((error: unknown) => {
      tab.loading = false;
      tab.title = '页面加载失败';
      this.logger.error('Browser page load failed', {
        channelId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      this.emit(tab);
    });
    return this.snapshot(tab);
  }

  activate(tabId: string): BrowserTab {
    const tab = this.getTab(tabId);
    if (this.activeTabId !== tabId) {
      const previous = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
      if (previous) this.window.contentView.removeChildView(previous.view);
      if (!this.interceptionAlertOpen) this.window.contentView.addChildView(tab.view);
      this.activeTabId = tabId;
    }
    tab.view.setBounds(this.bounds);
    return this.snapshot(tab);
  }

  close(tabId: string): void {
    const tab = this.getTab(tabId);
    if (this.activeTabId === tabId) {
      this.window.contentView.removeChildView(tab.view);
      this.activeTabId = null;
    }
    this.tabs.delete(tabId);
    this.managedWebContentsIds.delete(tab.view.webContents.id);
    tab.view.webContents.close();
    this.logger.info('Browser tab closed', { channelId: tab.channelId });
  }

  acknowledgeInterception(): void {
    if (!this.interceptionAlertOpen) return;
    this.interceptionAlertOpen = false;
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (active && !this.window.isDestroyed()) {
      this.window.contentView.addChildView(active.view);
      active.view.setBounds(this.bounds);
    }
  }

  goBack(tabId: string): void {
    const navigation = this.getTab(tabId).view.webContents.navigationHistory;
    if (navigation.canGoBack()) navigation.goBack();
  }

  goForward(tabId: string): void {
    const navigation = this.getTab(tabId).view.webContents.navigationHistory;
    if (navigation.canGoForward()) navigation.goForward();
  }

  reload(tabId: string): void {
    this.getTab(tabId).view.webContents.reload();
  }

  hide(): void {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    if (active) this.window.contentView.removeChildView(active.view);
    this.activeTabId = null;
    this.interceptionAlertOpen = false;
  }

  list(): BrowserTab[] {
    return [...this.tabs.values()].map((tab) => this.snapshot(tab));
  }

  setBounds(bounds: Rectangle): void {
    const values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if (!values.every(Number.isFinite) || bounds.width < 0 || bounds.height < 0) {
      throw new Error('浏览器区域尺寸无效');
    }
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    if (this.activeTabId) this.tabs.get(this.activeTabId)?.view.setBounds(this.bounds);
  }

  destroy(): void {
    const tabCount = this.tabs.size;
    for (const tab of this.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
    this.managedWebContentsIds.clear();
    this.activeTabId = null;
    this.interceptionAlertOpen = false;
    if (!this.window.isDestroyed()) {
      this.window.webContents.removeListener('before-input-event', this.handleShellInput);
    }
    this.browserSession.webRequest.onBeforeRequest(CTRIP_API_REQUEST_FILTER, null);
    if (tabCount > 0) this.logger.info('Browser workspace closed', { tabCount });
  }

  private installRequestInterceptor(): void {
    this.browserSession.webRequest.onBeforeRequest(
      CTRIP_API_REQUEST_FILTER,
      (details, callback) => {
        if (!this.managedWebContentsIds.has(details.webContentsId ?? -1)) {
          callback({});
          return;
        }

        callback({ cancel: true });
        if (this.interceptionAlertOpen || this.window.isDestroyed()) return;

        this.interceptionAlertOpen = true;
        const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
        if (active) this.window.contentView.removeChildView(active.view);
        this.logger.info('Embedded browser request intercepted', { ruleId: 'ctrip-soa2' });
        this.window.webContents.send(IPC_CHANNELS.browser.requestIntercepted, {
          ruleId: 'ctrip-soa2',
        });
      },
    );
  }

  private bindTabEvents(tab: ManagedTab): void {
    const { webContents } = tab.view;
    webContents.setWindowOpenHandler(({ url }) => {
      try {
        this.create(tab.channelId, url);
      } catch {
        // Invalid and non-web popup targets stay blocked.
        this.logger.warn('Blocked invalid browser popup', { channelId: tab.channelId });
      }
      return { action: 'deny' };
    });
    webContents.on('will-navigate', (event, url) => {
      try {
        assertWebUrl(url);
      } catch {
        event.preventDefault();
        this.logger.warn('Blocked invalid browser navigation', { channelId: tab.channelId });
      }
    });
    webContents.on('before-input-event', (event, input) => {
      if (!isReloadShortcut(input)) return;

      event.preventDefault();
      if (this.activeTabId === tab.id) webContents.reload();
    });
    webContents.on('did-start-loading', () => {
      tab.loading = true;
      this.emit(tab);
    });
    webContents.on('did-stop-loading', () => {
      tab.loading = false;
      tab.url = webContents.getURL() || tab.url;
      tab.title = webContents.getTitle() || tab.title;
      this.emit(tab);
    });
    webContents.on('did-navigate', (_event, url) => {
      tab.url = url;
      this.emit(tab);
    });
    webContents.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
      this.emit(tab);
    });
    webContents.on('page-title-updated', (_event, title) => {
      tab.title = title || tab.title;
      this.emit(tab);
    });
  }

  private emit(tab: ManagedTab): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.browser.stateChanged, this.snapshot(tab));
    }
  }

  private getTab(tabId: string): ManagedTab {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error('浏览器标签不存在');
    return tab;
  }

  private snapshot(tab: ManagedTab): BrowserTab {
    const navigation = tab.view.webContents.navigationHistory;
    return {
      id: tab.id,
      channelId: tab.channelId,
      title: tab.title,
      url: tab.url,
      canGoBack: navigation.canGoBack(),
      canGoForward: navigation.canGoForward(),
      loading: tab.loading,
    };
  }
}
