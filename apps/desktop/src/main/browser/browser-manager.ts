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
import {
  browserWebUrlSchema,
  type BrowserTab,
  type BrowserTabFailure,
} from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';

export interface BrowserSessionFactory {
  sessionForAccount(partitionName: string): Session;
  sessionForLogin(
    channel: ChannelId,
  ): Readonly<{ session: Session; partitionName: string }>;
  clearAccountSession(partitionName: string): Promise<void>;
}

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
   * （与窗口能力注册表的 partition 退休能力同一套路）。
   *
   * 缺省实现返回 false —— 只在测试等未装配场景出现；生产装配**必须**传入，
   * 否则退休清理会退化成事故前的行为。
   */
  isPartitionClaimed?: (partitionName: string) => boolean;
}>;

/**
 * 同时打开的标签页上限。每个标签页背后是一个独立的渲染进程（约 80–150MB），
 * 12 个约 1–1.8GB —— 在 8GB 内存的机器上仍留有余量。
 */
const MAX_TABS = 12;

/**
 * Chromium 的 `net::ERR_ABORTED`。单页应用内部导航会大量产生，不是故障。
 * 见 https://source.chromium.org/chromium/chromium/src/+/main:net/base/net_error_list.h
 */
const ABORTED_ERROR_CODE = -3;

/** 网页自开新窗口的节流窗口与阈值：正常点击达不到，失控循环第一秒就被拦住。 */
const POPUP_THROTTLE_WINDOW_MS = 1_000;
const POPUP_THROTTLE_MAX = 3;

type ManagedTab = {
  id: string;
  channelId: string;
  title: string;
  url: string;
  loading: boolean;
  view: WebContentsView;
  partitionName: string;
  /** 当前故障状态，`null` 表示正常。语义见 `shared/browser.ts`。 */
  failure: BrowserTabFailure | null;
  /**
   * 已经走过 `close()`。**广播前必须查它**。
   *
   * `webContents.close()` 是异步的：实测（Electron 43）关闭后仍会收到
   * `did-stop-loading`（页面 unload 处理器里的跳转就会触发），且此刻
   * `isDestroyed()` 仍为 false，所以 `snapshot()` 不抛、照常广播出去。
   *
   * 而事件回调持有的是**闭包里的 tab 对象**，不查 `this.tabs`，删除 map 拦不住它。
   * 渲染进程 `updateTab` 对没见过的 id 一律 append 并设为活动标签，于是刚关掉的
   * 标签页会自己长回标签栏、还抢走高亮 —— 之后点它必然报「浏览器标签不存在」。
   */
  closed?: boolean;
  /** 本标签页最近一次开窗节流窗口的起点与计数。 */
  popupWindowStartedAt?: number;
  popupCountInWindow?: number;
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
  private readonly sessionFactory: BrowserSessionFactory;
  private readonly tabs = new Map<string, ManagedTab>();
  private readonly retiredPartitions = new Set<string>();
  private readonly managedWebContentsIds = new Set<number>();
  private audioMuted = false;
  private activeTabId: string | null = null;
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  /**
   * 内容区当前是否该显示网页。应用内弹窗占用内容区期间为 false。
   *
   * ⚠️ **与 `bounds` 是两个正交的状态**，这是一次真机故障的教训：此前「让位给弹窗」
   * 靠把尺寸设成零来表达，于是让位与尺寸同步共用同一个通道，两条并发的异步链谁最后
   * 落地谁说了算。零尺寸视图照常上报标题与加载状态，故障表现为「标签页标题变了、
   * 内容区却什么都看不见」，且不可稳定复现。
   *
   * 分开之后，尺寸同步在让位期间照常发生也无害——它改不了可见性。
   */
  private viewportVisible = true;
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
    sessionFactory: BrowserSessionFactory,
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
    channelId: ChannelId,
    url: string,
    options: Readonly<{
      importedCookies?: readonly CookiesSetDetails[];
    }> = {},
  ): Promise<Readonly<{ tab: BrowserTab; partitionName: string }>> {
    // ⚠️ 必须**先**查上限再建 partition：`sessionForLogin` 会在磁盘上落一份新的
    // 登录态，随后还可能写入 cookie。若等到 `createTab` 才拒绝，这份 partition
    // 既没有标签页引用、也没进账本，就成了孤儿 —— 正是本仓库出过事故的那一类。
    this.assertTabCapacity();
    const { session: tabSession, partitionName } =
      this.sessionFactory.sessionForLogin(channelId);
    if (options.importedCookies) {
      await Promise.all(options.importedCookies.map((cookie) => tabSession.cookies.set(cookie)));
    }
    const tab = this.createTab(channelId, url, partitionName, tabSession);
    return { tab: this.snapshot(tab), partitionName };
  }

  /**
   * 上限对**所有**创建路径生效，含用户主动新建：只拦网页自开的话，用户照样能把
   * 内存耗尽。每个标签页背后是一个独立的渲染进程（80–150MB）。
   *
   * 单独抽出来是为了能在**创建 partition 之前**先问一次 —— 见
   * `createAndNewPartition`。
   */
  private assertTabCapacity(): void {
    if (this.tabs.size >= MAX_TABS) {
      throw new Error(`最多同时打开 ${MAX_TABS} 个标签页，请先关闭一些`);
    }
  }

  private createTab(
    channelId: string,
    url: string,
    partitionName: string,
    tabSession: Session,
    options: Readonly<{ activate?: boolean }> = {},
  ): ManagedTab {
    assertWebUrl(url);
    if (!channelId.trim()) throw new Error('渠道标识不能为空');
    this.assertTabCapacity();

    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: tabSession,
        // OTA 后台是纯浏览与表单操作，拼写检查用不上，每个标签页省一点内存。
        spellcheck: false,
        // 同一个渠道后台会被反复打开，缓存编译结果省下重复的 JS 编译开销。
        v8CacheOptions: 'code',
      },
    });
    // 不设背景色时，视图在首帧绘制前是透明的，切换标签页会闪一下黑。
    view.setBackgroundColor('#ffffff');
    this.managedWebContentsIds.add(view.webContents.id);
    const tab: ManagedTab = {
      id,
      channelId,
      title: '正在加载…',
      url,
      loading: true,
      view,
      partitionName,
      failure: null,
    };
    this.tabs.set(id, tab);
    view.webContents.setAudioMuted(this.audioMuted);
    this.bindTabEvents(tab);
    // 网页自开的标签页传 false：由界面收到 `tab:opened` 后走标准收尾流程激活。
    // 主进程代劳激活的话，界面不知情、无人同步视口尺寸，新视图会拿到过期的
    // `this.bounds`（让位期间就是零），表现为「标题变了但看不见内容」。
    if (options.activate ?? true) this.activate(id);
    this.logger.info('Browser tab created', { channelId, partitionName });
    void view.webContents.loadURL(url).catch((error: unknown) => {
      tab.loading = false;
      tab.failure = 'load-failed';
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
    // 必须继承当前让位状态：视图默认可见，让位期间打开的标签页会直接盖在弹窗上。
    // 绑定流程正是这个形状——弹窗先让位，随后在弹窗里开标签页。
    tab.view.setVisible(this.viewportVisible);
    return this.snapshot(tab);
  }

  close(tabId: string): void {
    const tab = this.getTab(tabId);
    const wasActive = this.activeTabId === tabId;
    // 接班人必须在摘除之前挑：位置信息（「它的邻居是谁」）只在原顺序里存在。
    const successor = wasActive ? this.pickSuccessor(tab) : undefined;
    if (wasActive) {
      this.window.contentView.removeChildView(tab.view);
      this.activeTabId = null;
    }
    this.tabs.delete(tabId);
    this.managedWebContentsIds.delete(tab.view.webContents.id);
    // 必须在 close() 之前置位：关闭期间仍会有事件回调进来（见 `ManagedTab.closed`）。
    tab.closed = true;
    tab.view.webContents.close();
    // 关掉的是活动标签页时，主进程自己接管，不等界面发第二次请求：那是一次额外的
    // IPC 往返（中间一帧内容区空白）；而从别处发起的关闭（如切换账号时收尾旧标签
    // 页）根本不会有第二次请求，内容区会一直空着。
    if (successor) this.activate(successor.id);
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
    // ⚠️ 刻意**不**在这里复位 `viewportVisible`。
    //
    // 曾经这么做过，理由是「离开工作区 = 弹窗占用结束」。但 `hide()` 有三个调用方，
    // 只有一个是「离开工作区」：
    //   - `BrowserWorkspace` 卸载        —— 确实是离开
    //   - `selectChannel` 切到空渠道     —— 没离开，只是这个渠道没有标签页
    //   - `AccountSwitcherDialog`        —— 没离开，这是它自己的让位方式
    // 在这里复位会让后两者顺手清掉别人的让位状态（账号弹窗一开，绑定弹窗的让位
    // 就没了）。复位的正确位置是渲染进程的 `releaseViewportSession()` —— 那个方法
    // 的语义**就是**「离开工作区」，且只有卸载路径会调它。
  }

  /*
   * 关于后台标签页的节流：**无需额外配置，现状已经正确**。
   *
   * 非活动标签页在 `activate()` 里就被 `removeChildView` 移出了视图树，Chromium
   * 因此天然按后台处理（降帧、限流计时器），`webPreferences.backgroundThrottling`
   * 保持默认 true 即可。查过一轮，记在这里免得后人重复排查。
   */

  /**
   * 让出/收回内容区。**与 `hide()` 不是一回事**：`hide()` 把视图移出视图树并清空
   * `activeTabId`（离开浏览器工作区时用），恢复需要重新 activate；这里只切换可见性，
   * 活动标签页是谁、尺寸是多少都原样保留，用于弹窗短暂占用内容区。
   *
   * 原生 `WebContentsView` 永远浮在 HTML 之上（CSS 的 z-index 管不到它），不让位
   * 弹窗就会被网页整个盖住。
   */
  setViewportVisible(visible: boolean): void {
    this.viewportVisible = visible;
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
    active?.view.setVisible(visible);
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

  /**
   * 网页自开新窗口的节流。**按发起标签页各自计数**：一个页面失控不该牵连其他标签页。
   *
   * 上限（`MAX_TABS`）拦的是「总量」，这里拦的是「速率」—— 用户手动关掉几个再被
   * 循环开满，总量守卫会反复放行，节流才能真正止住。
   */
  private allowPopup(tab: ManagedTab): boolean {
    const now = Date.now();
    const startedAt = tab.popupWindowStartedAt ?? 0;
    if (now - startedAt > POPUP_THROTTLE_WINDOW_MS) {
      tab.popupWindowStartedAt = now;
      tab.popupCountInWindow = 1;
      return true;
    }
    const count = (tab.popupCountInWindow ?? 0) + 1;
    tab.popupCountInWindow = count;
    if (count > POPUP_THROTTLE_MAX) {
      this.logger.warn('Browser popup throttled', {
        channelId: tab.channelId,
        countInWindow: count,
      });
      return false;
    }
    return true;
  }

  /**
   * 活动标签页关闭后由谁接管内容区 —— **同渠道里相邻的那个**（优先右侧，没有则
   * 左侧），与渲染进程 `browserOtaTabs.close()` 的取法一致。
   *
   * 两侧必须用同一条规则：主进程挑 A、界面挑 B 的话，内容区会先落到 A 再跳到 B，
   * 用户看到一次莫名其妙的闪跳。
   */
  private pickSuccessor(closing: ManagedTab): ManagedTab | undefined {
    const siblings = [...this.tabs.values()].filter(
      (item) => item.channelId === closing.channelId,
    );
    const index = siblings.findIndex((item) => item.id === closing.id);
    if (index === -1) return undefined;
    const remaining = siblings.filter((item) => item.id !== closing.id);
    return remaining[Math.min(index, remaining.length - 1)];
  }

  private bindTabEvents(tab: ManagedTab): void {
    const { webContents } = tab.view;
    webContents.setWindowOpenHandler(({ url }) => {
      if (!this.allowPopup(tab)) return { action: 'deny' };
      try {
        // 弹窗继承发起方的 partition：同一账号打开的新窗口不应掉进共享 session。
        //
        // **不在这里激活**：界面还不知道这个标签页存在，代劳激活会让新视图拿到
        // 主进程当前的 `bounds`（让位期间就是零尺寸），表现为「标题变了但看不见
        // 内容」。改为广播 `tab:opened`，由界面走与其他入口相同的收尾流程。
        const created = this.createTab(
          tab.channelId,
          url,
          tab.partitionName,
          this.sessionFactory.sessionForAccount(tab.partitionName),
          { activate: false },
        );
        this.emitTabOpened(created);
      } catch (error) {
        // 无效地址、非 web 协议、以及达到标签页上限，都在这里被挡住。
        this.logger.warn('Blocked browser popup', {
          channelId: tab.channelId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
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
      // 重新加载即离开故障态——用户点「重新加载」后必须看到故障提示消失，
      // 否则无从判断这次重试有没有生效。
      tab.failure = null;
      this.emitStateChanged(tab);
    });
    webContents.on('render-process-gone', (_event, details) => {
      tab.loading = false;
      tab.failure = 'crashed';
      this.logger.error('Browser tab renderer gone', {
        channelId: tab.channelId,
        reason: details.reason,
      });
      this.emitStateChanged(tab);
    });
    webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      // 只认主框架的真实失败：子框架（广告位、内嵌 iframe）失败不影响用户看的页面；
      // `ERR_ABORTED` (-3) 是单页应用内部导航的常态，把它算作故障会让提示彻底失去
      // 意义——渠道后台每切换一次路由就会报一次。
      if (!isMainFrame || errorCode === ABORTED_ERROR_CODE) return;
      tab.loading = false;
      tab.failure = 'load-failed';
      this.logger.warn('Browser tab main frame failed to load', {
        channelId: tab.channelId,
        errorCode,
      });
      this.emitStateChanged(tab);
    });
    webContents.on('unresponsive', () => {
      // 不得覆盖更严重的故障：崩溃/加载失败需要用户介入，而「无响应」通常自愈。
      // 一旦覆盖，随后的 `responsive` 会把它清成 null（那条只认 unresponsive），
      // 崩溃就此从界面上消失，只剩一块空白页。
      if (tab.failure !== null) return;
      tab.failure = 'unresponsive';
      this.logger.warn('Browser tab became unresponsive', { channelId: tab.channelId });
      this.emitStateChanged(tab);
    });
    webContents.on('responsive', () => {
      // 只清「无响应」：页面恢复响应不代表崩溃或加载失败已经解决。
      if (tab.failure !== 'unresponsive') return;
      tab.failure = null;
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
    // 已关闭的标签页不得再广播：订阅方（登录判定等）刚在 `tab:closed` 里清完它的
    // 状态，这里再来一条会让它们为一个死 tab 重新登记，之后没有任何事件能清掉。
    if (tab.closed) return;
    this.emit('tab:navigated', {
      tabId: tab.id,
      partitionName: tab.partitionName,
      channelId: tab.channelId,
      url,
      webContents,
    } satisfies TabNavigatedEvent);
  }

  /**
   * 告诉界面「主进程刚建了一个你还不知道的标签页」。
   *
   * 走 `window.webContents.send` 而不是 EventEmitter + `ota-tab/` 中继：这是一条
   * 纯视图事实（与登录判定、credential 归并无关），与既有的 `stateChanged` 同类，
   * 沿用同一条路。`TabEventBus` 承载的是 credential 语义，不该混进视图事件。
   */
  private emitTabOpened(tab: ManagedTab): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.browser.tabOpened, this.snapshot(tab));
    }
  }

  private emitStateChanged(tab: ManagedTab): void {
    if (tab.closed) return;
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
      failure: tab.failure,
    };
  }
}
