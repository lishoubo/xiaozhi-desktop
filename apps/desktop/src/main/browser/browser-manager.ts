import {
  BrowserWindow,
  WebContentsView,
  type CookiesSetDetails,
  type Event as ElectronEvent,
  type Input,
  type Rectangle,
  type Session,
  type WebContents,
} from 'electron';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ChannelId } from '../ids';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { browserWebUrlSchema, type BrowserTab } from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';
import { SessionFactory } from './session-factory';

/** 标签页发生一次导航（含 SPA 内部路由变化）后广播的原始事实，不含任何登录语义判断。 */
export type TabNavigatedEvent = Readonly<{
  tabId: string;
  partitionName: string;
  channelId: string;
  url: string;
  webContents: WebContents;
}>;

/** 标签页关闭后广播的事实，供订阅方清理自己按 tabId 维护的状态。 */
export type TabClosedEvent = Readonly<{ tabId: string }>;

export type BrowserManagerOptions = Readonly<{
  /**
   * 这个 partition 是否仍是某条 credential 的登录态。
   *
   * 窄回调而非仓储：`BrowserManager` 属于 window scope、不认识数据库，
   * 由 composition root 接到 `OtaCredentialRepository.findByPartitionName`
   * （与 `setPartitionRetirer` 同一套路）。
   *
   * 缺省实现返回 false —— 只在测试等未装配场景出现；生产装配**必须**传入，
   * 否则退休清理会退化成事故前的行为。
   */
  isPartitionClaimed?: (partitionName: string) => boolean;
}>;

type ManagedTab = {
  id: string;
  channelId: string;
  title: string;
  url: string;
  loading: boolean;
  view: WebContentsView;
  partitionName: string;
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

export class BrowserManager extends EventEmitter {
  /** @deprecated 旧的全局共享 session（D1 缺陷本身）。仅供未迁移的调用方过渡使用。 */
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

  private readonly isPartitionClaimed: (partitionName: string) => boolean;

  constructor(
    private readonly window: BrowserWindow,
    private readonly logger: AppLogger,
    sessionFactory: SessionFactory = new SessionFactory(logger),
    options: BrowserManagerOptions = {},
  ) {
    super();
    this.sessionFactory = sessionFactory;
    this.isPartitionClaimed = options.isPartitionClaimed ?? (() => false);
    this.window.webContents.on('before-input-event', this.handleShellInput);
  }

  /**
   * 已有 credential：直接用它的 `partitionName` 开标签页。流程B（打开已有
   * 账号）及"从其他登录态创建账号"（add-account-flow-per-channel/design.md
   * §4）均走这里；是否需要登录判定由调用方（`OtaTabOpener`）订阅
   * `tab:navigated` 自行决定，这里不再关心。
   */
  createWithAlreadyPartition(partitionName: string, channelId: string, url: string): BrowserTab {
    const tabSession = this.sessionFactory.sessionForAccount(partitionName);
    const tab = this.createTab(channelId, url, partitionName, tabSession);
    return this.snapshot(tab);
  }

  /**
   * 走登录流程：新建一份 partition，若调用方注入了 cookie 则先写入，
   * 再加载渠道后台页面。是否/如何判定登录成功由调用方订阅
   * `tab:navigated` 自行处理，这里只负责开 tab。
   */
  async createAndNewPartition(
    environment: 'prod' | 'dev',
    channelId: ChannelId,
    url: string,
    options: Readonly<{
      importedCookies?: readonly CookiesSetDetails[];
    }> = {},
  ): Promise<Readonly<{ tab: BrowserTab; partitionName: string }>> {
    const { session: tabSession, partitionName } = this.sessionFactory.sessionForLogin(
      environment,
      channelId,
    );
    if (options.importedCookies) {
      await Promise.all(options.importedCookies.map((cookie) => tabSession.cookies.set(cookie)));
    }
    const tab = this.createTab(channelId, url, partitionName, tabSession);
    return { tab: this.snapshot(tab), partitionName };
  }

  private createTab(
    channelId: string,
    url: string,
    partitionName: string,
    tabSession: Session,
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
    };
    this.tabs.set(id, tab);
    view.webContents.setAudioMuted(this.audioMuted);
    this.bindTabEvents(tab);
    this.activate(id);
    this.logger.info('Browser tab created', { channelId, partitionName });
    void view.webContents.loadURL(url).catch((error: unknown) => {
      tab.loading = false;
      tab.title = '页面加载失败';
      this.logger.error('Browser page load failed', {
        channelId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      this.emitStateChanged(tab);
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
    this.emit('tab:closed', { tabId } satisfies TabClosedEvent);
    // 只重试**这个 tab 自己的** partition：本次关闭唯一新增的事实是「它少了一个
    // 占用者」，与退休集合里其他条目无关。原实现在这里遍历整个集合，等于让每次
    // 关标签页都去碰一遍所有待清项 —— 那是真机事故的放大器。
    if (this.retiredPartitions.has(tab.partitionName)) {
      void this.clearRetiredPartitionWhenUnused(tab.partitionName).catch(() => {});
    }
  }

  /**
   * 在标签页里执行一段脚本并取回结果。**只给 `ota-tab` 层用**（绑定前清掉渠道
   * 记住的门店选择），脚本内容由调用方决定 —— 本类不认识任何渠道。
   *
   * 标签页不存在或已销毁时返回 null 而不是抛错：调用方是「尽力而为」的清理，
   * 用户提前关掉标签页不该被当成故障。
   */
  async runInTab(tabId: string, expression: string): Promise<unknown> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.view.webContents.isDestroyed()) return null;
    return tab.view.webContents.executeJavaScript(expression);
  }

  /**
   * credential 已切换到新 partition 后退休旧 Session。若仍有标签引用则延迟
   * 到最后一个标签关闭；清理失败保留退休标记，允许后续关闭事件再次尝试。
   */
  async retirePartition(partitionName: string): Promise<void> {
    this.retiredPartitions.add(partitionName);
    await this.clearRetiredPartitionWhenUnused(partitionName);
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
    if (tabCount > 0) this.logger.info('Browser workspace closed', { tabCount });
  }

  /**
   * 清空一份退休 partition 的存储。**不可逆**，两道守卫都通过才动手：
   *
   * - G1 没有标签页正在用它 —— 不通过则保留退休标记，等标签页关闭后补清
   * - G2 没有 credential 指向它 —— 不通过则**撤销退休标记**，见下
   *
   * G2 是真机事故的直接教训（连续绑定多个美团账号后，5 个 credential 指向的
   * partition 被清空，用户点账号只看到登录页）：原实现只问「有没有标签页开着」，
   * 而标签页早就关了，于是把某个账号**当前**的登录态清掉了。
   *
   * G2 不通过时撤销标记而非保留：既然它已经是某条 credential 的登录态，
   * 「退休」这个判断本身就是错的。留着标记的话，之后每一次关闭标签页都会重新
   * 尝试清它，只要某一刻 credential 短暂不指向它（例如归并中途）就会得手。
   */
  private async clearRetiredPartitionWhenUnused(partitionName: string): Promise<void> {
    const stillUsed = [...this.tabs.values()].some((tab) => tab.partitionName === partitionName);
    if (stillUsed) return;

    if (this.isPartitionClaimed(partitionName)) {
      this.retiredPartitions.delete(partitionName);
      this.logger.warn('Retire cancelled: partition is claimed by a credential', {
        partitionName,
      });
      return;
    }

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
        // 弹窗继承发起方的 partition：同一账号打开的新窗口不应掉进共享 session。
        this.createWithAlreadyPartition(tab.partitionName, tab.channelId, url);
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
      this.emitStateChanged(tab);
    });
    webContents.on('did-stop-loading', () => {
      tab.loading = false;
      tab.url = webContents.getURL() || tab.url;
      tab.title = webContents.getTitle() || tab.title;
      this.emitStateChanged(tab);
    });
    webContents.on('did-navigate', (_event, url) => {
      tab.url = url;
      this.emitTabNavigated(tab, url, webContents);
      this.emitStateChanged(tab);
    });
    webContents.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
      this.emitTabNavigated(tab, url, webContents);
      this.emitStateChanged(tab);
    });
    webContents.on('page-title-updated', (_event, title) => {
      tab.title = title || tab.title;
      this.emitStateChanged(tab);
    });
  }

  private emitTabNavigated(tab: ManagedTab, url: string, webContents: WebContents): void {
    this.emit('tab:navigated', {
      tabId: tab.id,
      partitionName: tab.partitionName,
      channelId: tab.channelId,
      url,
      webContents,
    } satisfies TabNavigatedEvent);
  }

  private emitStateChanged(tab: ManagedTab): void {
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
