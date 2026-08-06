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
  private readonly retiredPartitions = new Set<string>();
  private readonly managedWebContentsIds = new Set<number>();
  private audioMuted = false;
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

  /**
   * 已有 credential：直接用它的 `partitionName` 开标签页。
   * `options` 默认不传，行为与流程B（打开已有账号）现状完全一致；传入
   * `onUrlPastLogin`/`loginUrlMatcher` 时用于"从其他登录态创建账号"——
   * 复用已有 partition 打开页面后，用户在页面内切换到另一个门店/公司，
   * 仍能触发一次账号探测（add-account-flow-per-channel/design.md §4）。
   */
  createWithAlreadyPartition(
    partitionName: string,
    channelId: string,
    url: string,
    options: Readonly<{
      onUrlPastLogin?: (
        partitionName: string,
        landingUrl: string,
        webContents: WebContents,
      ) => void;
      loginUrlMatcher?: LoginUrlMatcher;
    }> = {},
  ): BrowserTab {
    const tabSession = this.sessionFactory.sessionForAccount(partitionName);
    const tab = this.createTab(
      channelId,
      url,
      partitionName,
      tabSession,
      options.onUrlPastLogin,
      options.loginUrlMatcher,
    );
    return this.snapshot(tab);
  }

  /**
   * 走登录流程：新建一份 partition，若调用方注入了 cookie 则先写入，
   * 再加载渠道后台页面。
   *
   * 两种探测触发方式二选一（互斥，不同时传）：
   * - `onUrlPastLogin`/`loginUrlMatcher`：等待用户手动登录交互，URL 判定
   *   命中登录成功时触发（design.md 决策 8）——"新建账号"与抖音"从cookie
   *   创建"/"从其他登录态创建"用这条
   * - `onLoadFinished`：不等待用户交互，页面首次加载完成（无论是否登录
   *   成功）即触发一次，由调用方自行判断落地结果——携程"从cookie创建"
   *   静默判定用这条（add-account-flow-per-channel/design.md §3，携程
   *   cookie 有效直接落地，无效会被重定向回登录页，交给探测层区分）
   */
  async createAndNewPartition(
    environment: 'prod' | 'dev',
    channelId: ChannelId,
    url: string,
    options: Readonly<{
      importedCookies?: readonly CookiesSetDetails[];
      onUrlPastLogin?: (
        partitionName: string,
        landingUrl: string,
        webContents: WebContents,
      ) => void;
      loginUrlMatcher?: LoginUrlMatcher;
      onLoadFinished?: (
        partitionName: string,
        landingUrl: string,
        webContents: WebContents,
      ) => void;
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
      options.onLoadFinished,
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
    onLoadFinished?: (partitionName: string, landingUrl: string, webContents: WebContents) => void,
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
    view.webContents.setAudioMuted(this.audioMuted);
    this.bindTabEvents(tab);
    this.activate(id);
    this.logger.info('Browser tab created', { channelId, partitionName });
    void view.webContents
      .loadURL(url)
      .then(() => onLoadFinished?.(partitionName, view.webContents.getURL(), view.webContents))
      .catch((error: unknown) => {
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
    for (const retiredPartition of this.retiredPartitions) {
      void this.clearRetiredPartitionWhenUnused(retiredPartition).catch(() => {});
    }
  }

  /**
   * credential 已切换到新 partition 后退休旧 Session。若仍有标签引用则延迟
   * 到最后一个标签关闭；清理失败保留退休标记，允许后续关闭事件再次尝试。
   */
  async retirePartition(partitionName: string): Promise<void> {
    this.retiredPartitions.add(partitionName);
    await this.clearRetiredPartitionWhenUnused(partitionName);
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

  getAudioMuted(): boolean {
    return this.audioMuted;
  }

  setAudioMuted(muted: boolean): boolean {
    this.audioMuted = muted;
    for (const tab of this.tabs.values()) {
      const { webContents } = tab.view;
      if (webContents.isDestroyed()) continue;
      try {
        webContents.setAudioMuted(muted);
      } catch (error) {
        this.logger.warn('Browser tab audio state could not be changed', {
          channelId: tab.channelId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
    return this.audioMuted;
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

  private async clearRetiredPartitionWhenUnused(partitionName: string): Promise<void> {
    const stillUsed = [...this.tabs.values()].some((tab) => tab.partitionName === partitionName);
    if (stillUsed) return;
    try {
      await this.sessionFactory.clearAccountSession(partitionName);
      this.retiredPartitions.delete(partitionName);
      this.logger.info('Retired browser partition cleared');
    } catch (error) {
      this.logger.warn('Retired browser partition could not be cleared', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
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
