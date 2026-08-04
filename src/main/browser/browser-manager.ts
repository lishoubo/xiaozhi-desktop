import {
  BrowserWindow,
  WebContentsView,
  type CookiesSetDetails,
  type Event as ElectronEvent,
  type Input,
  type Rectangle,
  type Session,
  type WebContents,
  type WebRequestFilter,
} from 'electron';
import { randomUUID } from 'node:crypto';
import type { ChannelId } from '../../domain/identity';
import { LEGACY_SHARED_PARTITION } from '../../domain/policy/partition-policy';
import type { LoginUrlMatcher } from '../../domain/ports/discovery';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { browserWebUrlSchema, type BrowserTab } from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';
import { SessionFactory } from './session-factory';

type ManagedTab = {
  id: string;
  channelId: string;
  title: string;
  url: string;
  loading: boolean;
  view: WebContentsView;
  partitionName: string;
  /**
   * 仅登录标签页设置；URL 判定已登录（见 design.md 决策 8）时调用一次，
   * 触发账号探测。不再有"标签页关闭时触发"的兜底路径。`landingUrl` 是
   * 命中判定那一刻的完整 URL——部分渠道（如抖音）的门店身份参数只存在
   * 于这个 URL 里，探测层需要它才能定位到正确的门店。
   */
  onUrlPastLogin?: (partitionName: string, landingUrl: string, webContents: WebContents) => void;
  /** 该渠道的登录页 URL 判据；未注册时不参与 URL 触发。 */
  loginUrlMatcher?: LoginUrlMatcher;
  /** 本次登录标签页是否已经触发过探测——命中一次后不再重复调用。 */
  urlPastLoginTriggered: boolean;
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
  /** @deprecated 旧的全局共享 session（D1 缺陷本身）。仅供未迁移的调用方过渡使用。 */
  readonly browserSession: Session;
  private readonly sessionFactory: SessionFactory;
  private readonly tabs = new Map<string, ManagedTab>();
  private readonly managedWebContentsIds = new Set<number>();
  private activeTabId: string | null = null;
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private readonly handleShellInput = (event: ElectronEvent, input: Input): void => {
    if (!isReloadShortcut(input)) return;

    event.preventDefault();
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    active?.view.webContents.reload();
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly logger: AppLogger,
    sessionFactory: SessionFactory = new SessionFactory(logger),
  ) {
    this.sessionFactory = sessionFactory;
    this.browserSession = this.sessionFactory.sessionForAccount(LEGACY_SHARED_PARTITION);
    this.window.webContents.on('before-input-event', this.handleShellInput);
    this.installRequestInterceptor();
  }

  /** @deprecated 用 `createWithAlreadyPartition` 替代，指定明确的 partition。 */
  create(channelId: string, url: string): BrowserTab {
    return this.createWithAlreadyPartition(LEGACY_SHARED_PARTITION, channelId, url);
  }

  /** 已有账号：直接用它的 `OtaAccount.partitionName` 开标签页。 */
  createWithAlreadyPartition(partitionName: string, channelId: string, url: string): BrowserTab {
    const tabSession = this.sessionFactory.sessionForAccount(partitionName);
    const tab = this.createTab(channelId, url, partitionName, tabSession);
    return this.snapshot(tab);
  }

  /**
   * 走登录流程：新建一份 partition，若该渠道已导入过 cookie 则先注入，
   * 再加载渠道后台页面。URL 判定登录成功时通过 `onUrlPastLogin` 触发账号
   * 探测（design.md 决策 8；探测层落地前调用方可不传 `onUrlPastLogin`/
   * `loginUrlMatcher`）。
   */
  async createAndNewPartition(
    environment: 'prod' | 'dev',
    channelId: ChannelId,
    url: string,
    options: Readonly<{
      importedCookies?: readonly CookiesSetDetails[];
      onUrlPastLogin?: (partitionName: string, landingUrl: string, webContents: WebContents) => void;
      loginUrlMatcher?: LoginUrlMatcher;
    }> = {},
  ): Promise<Readonly<{ tab: BrowserTab; partitionName: string }>> {
    const { session: tabSession, partitionName } = this.sessionFactory.sessionForLogin(
      environment,
      channelId,
    );
    if (options.importedCookies) {
      await Promise.all(options.importedCookies.map((cookie) => tabSession.cookies.set(cookie)));
    }
    const tab = this.createTab(
      channelId,
      url,
      partitionName,
      tabSession,
      options.onUrlPastLogin,
      options.loginUrlMatcher,
    );
    return { tab: this.snapshot(tab), partitionName };
  }

  private createTab(
    channelId: string,
    url: string,
    partitionName: string,
    tabSession: Session,
    onUrlPastLogin?: (partitionName: string, landingUrl: string, webContents: WebContents) => void,
    loginUrlMatcher?: LoginUrlMatcher,
  ): ManagedTab {
    assertWebUrl(url);
    if (!channelId.trim()) throw new Error('渠道标识不能为空');

    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: tabSession,
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
      partitionName,
      onUrlPastLogin,
      loginUrlMatcher,
      urlPastLoginTriggered: false,
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
    return tab;
  }

  activate(tabId: string): BrowserTab {
    const tab = this.getTab(tabId);
    if (this.activeTabId !== tabId) {
      const previous = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
      if (previous) this.window.contentView.removeChildView(previous.view);
      this.window.contentView.addChildView(tab.view);
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
    // Kept for preload compatibility with older renderer bundles. Interception feedback is
    // non-blocking now, so there is no browser view to restore.
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
        if (this.window.isDestroyed()) return;
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
      this.checkUrlPastLogin(tab, url);
      this.emit(tab);
    });
    webContents.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
      this.checkUrlPastLogin(tab, url);
      this.emit(tab);
    });
    webContents.on('page-title-updated', (_event, title) => {
      tab.title = title || tab.title;
      this.emit(tab);
    });
  }

  /**
   * URL 触发探测（design.md 决策 8）：命中一次即把 `urlPastLoginTriggered`
   * 置位，此后同一标签页的任何后续导航都在这里短路返回——不会重复创建
   * 探测用的 `WebContentsView`、不会重复请求渠道接口。防重入/查重创建
   * 属于探测层自己的职责（见 `main/account-discovery/discover-and-create.ts`），
   * 这里只保证"每个标签页最多调用一次 `onUrlPastLogin`"。
   */
  private checkUrlPastLogin(tab: ManagedTab, url: string): void {
    if (tab.urlPastLoginTriggered) return;
    if (!tab.loginUrlMatcher || !tab.onUrlPastLogin) return;
    const isPastLogin = tab.loginUrlMatcher.isPastLogin(url);
    this.logger.info('Login URL matcher checked', {
      channelId: tab.channelId,
      isPastLogin,
    });
    if (!isPastLogin) return;

    tab.urlPastLoginTriggered = true;
    tab.onUrlPastLogin(tab.partitionName, url, tab.view.webContents);
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
      partitionName: tab.partitionName,
    };
  }
}
