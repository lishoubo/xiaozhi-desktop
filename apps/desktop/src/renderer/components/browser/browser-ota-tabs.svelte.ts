/**
 * 渲染进程侧的 OTA 标签页状态层 —— 与主进程 `main/ota-tab/` 对称的那一半。
 *
 * 主进程的 `OtaTabService` 是「OTA tab 的唯一开口」，但它开完 tab 只能把快照返
 * 回来；**开 tab 这个动作有三步收尾必须在渲染进程完成**：
 *
 *   1. 进 `tabsByChannel`  —— 标签栏才画得出来
 *   2. 设为该渠道的活动标签 + 切到该渠道 —— 否则内容区还停在上一个渠道
 *   3. `syncBounds()`      —— WebContentsView 没有尺寸就等于没渲染
 *
 * 这三步依赖只有渲染进程才有的东西（Svelte 响应式状态、视口 DOM 的
 * `getBoundingClientRect()`），主进程代劳不了。以前它们散在 `BrowserWorkspace`
 * 的几个函数里，导致「不从该组件内部发起」的开 tab 需求（酒店绑定）无处可接，
 * 只能绕过去——绕过去就会开出一个界面不认识的标签页。收到这里之后，任何组件
 * import 即可开 tab，不需要挂在 `BrowserWorkspace` 下面拿它的内部函数。
 *
 * 不收凭证列表（`credentialsByChannel`）：那是 tab 的邻居，不是同一件事。
 */
import type { BrowserTab, OtaTabIntentDto } from '../../../shared/browser';
import { WORKSPACE_CHANNEL_IDS } from '../../data/ota-channels';
import { pickRestoreTarget } from './restore-target';

/** 视口尺寸由组件在挂载时注册；store 自己拿不到 DOM。 */
type ViewportReader = () => DOMRect;

class BrowserOtaTabsStore {
  tabsByChannel = $state<Record<string, BrowserTab[]>>({});
  activeTabIds = $state<Record<string, string>>({});
  // 默认渠道取工作区第一个入口，而不是 `OTA_CHANNELS[0]` —— 后者是完整字典，首项
  // 未必在展示清单里，取到隐藏渠道会让标签栏没有任何一项高亮。
  activeChannelId = $state<string>(WORKSPACE_CHANNEL_IDS[0]);

  #readViewport: ViewportReader | undefined;

  /**
   * 本次进入浏览器页是否已经有人明确指定过要看哪个 tab（`adopt`/`activate`）。
   * 浏览器工作区挂载时的「默认激活携程」必须让位于它——两者是并行的异步链，
   * 默认激活那条通常后完成，不设这道闸就会把刚开的标签页从内容区顶掉（标签栏
   * 是渲染进程的本地状态，顶不掉，于是表现为「标签开了但内容是别的渠道」）。
   */
  #explicitlyActivated = false;

  /** 弹窗占用内容区期间，视图被缩为零尺寸；此时任何 `syncBounds` 都要让路。 */
  #viewportSuspended = false;

  /**
   * 浏览器工作区挂载时把视口元素交给 store，卸载时撤销。没有注册视口时
   * `syncBounds` 静默跳过——此时浏览器页不在前台，本来也无处可画。
   */
  registerViewport(read: ViewportReader): () => void {
    this.#readViewport = read;
    return () => {
      if (this.#readViewport === read) this.#readViewport = undefined;
    };
  }

  get activeTabs(): BrowserTab[] {
    return this.tabsByChannel[this.activeChannelId] ?? [];
  }

  /** 所有渠道的标签页。`restoreTarget` 的兜底需要跨渠道找，不能只看当前渠道那一栏。 */
  get allTabs(): BrowserTab[] {
    return Object.values(this.tabsByChannel).flat();
  }

  get activeTab(): BrowserTab | undefined {
    const tabs = this.activeTabs;
    return tabs.find((tab) => tab.id === this.activeTabIds[this.activeChannelId]) ?? tabs[0];
  }

  /** 把一个 tab 快照并入状态；已存在则原地替换（`browser.onStateChanged` 也走这里）。 */
  updateTab(next: BrowserTab): void {
    const tabs = this.tabsByChannel[next.channelId] ?? [];
    const index = tabs.findIndex((tab) => tab.id === next.id);
    this.tabsByChannel[next.channelId] =
      index === -1 ? [...tabs, next] : tabs.map((tab) => (tab.id === next.id ? next : tab));
    if (index === -1 || !this.activeTabIds[next.channelId]) {
      this.activeTabIds[next.channelId] = next.id;
    }
  }

  /**
   * 开 tab 之后的收尾。所有开 tab 路径都必须经过这里，否则 tab 在主进程里
   * 存在、界面上却看不见（或看得见但内容区停在别的渠道）。
   *
   * ⚠️ **必须显式 `browser.activate`**，只改这里的状态不够：`activeTabIds` 只管
   * 标签栏高亮（渲染进程本地状态），内容区摆哪个 WebContentsView 由主进程决定。
   * 少了这一步，renderer 与主进程各认各的，谁最后调 activate 谁说了算。
   *
   * 2026-08-15 的真实故障：在携程标签上再开一个携程标签，新标签高亮了、内容区
   * 却停在旧的。因为工作区挂载时那条「默认激活」链（目标恰是默认渠道携程）也在
   * 跑，它**真的**调了 activate，把内容区抢了回去。`#explicitlyActivated` 本该
   * 挡住它，但离开工作区时 `releaseViewportSession()` 会复位它——而「酒店页
   * → push('/')」正好走这条路，闸门失效。
   *
   * 只有「携程 tab 上再开携程 tab」会撞：换成抖音/美团时 `activeChannelId` 已经
   * 切走，默认激活的动作落在看不见的那一栏，正好没冲突——所以这个 bug 长期只在
   * 携程上出现。
   */
  async adopt(tab: BrowserTab): Promise<BrowserTab> {
    this.#explicitlyActivated = true;
    this.updateTab(tab);
    await window.hotelButler.browser.activate(tab.id);
    this.activeTabIds[tab.channelId] = tab.id;
    this.activeChannelId = tab.channelId;
    await this.syncBounds();
    return tab;
  }

  /**
   * "新建账号"：不注入 cookie，等用户手动登录。`intent` 同 `openExisting`——绑定
   * 入口的「新登录账号」带意图进来，登录成功后照样探测候选。
   */
  async openForNewLogin(
    channelId: string,
    url: string,
    intent?: OtaTabIntentDto,
  ): Promise<BrowserTab> {
    const tab = await window.hotelButler.otaTab.openForNewLogin(
      { channelId, url },
      intent,
    );
    return this.adopt(tab);
  }

  /**
   * "用已导入的 Cookie 登录"：该渠道没有导入过 cookie 时主进程会报错。
   * `intent` 同 `openForNewLogin`——绑定入口走这条路时登录态已就绪，照样要探测门店。
   */
  async openWithImportedCookie(
    channelId: string,
    url: string,
    intent?: OtaTabIntentDto,
  ): Promise<BrowserTab> {
    const tab = await window.hotelButler.otaTab.openWithImportedCookie(
      { channelId, url },
      intent,
    );
    return this.adopt(tab);
  }

  /**
   * 打开已有账号。`intent` 说明这次打开是为了做什么——带上它，登录判定后探测出
   * 的候选会按 requestId 通知回 UI；不带则只是普通打开。
   */
  async openExisting(credentialId: string, intent?: OtaTabIntentDto): Promise<BrowserTab> {
    const tab = await window.hotelButler.otaTab.openExisting(credentialId, intent);
    return this.adopt(tab);
  }

  /**
   * 绑定专用：同 `openExisting`，但换一份干净 partition。复用旧 partition 会带上
   * 「上次选的哪个门店」，渠道据此跳过选择页，用户就没机会选这次要绑的那家。
   */
  async openExistingForBinding(
    credentialId: string,
    intent?: OtaTabIntentDto,
  ): Promise<BrowserTab> {
    const tab = await window.hotelButler.otaTab.openExistingForBinding(credentialId, intent);
    return this.adopt(tab);
  }

  async activate(tab: BrowserTab): Promise<void> {
    this.#explicitlyActivated = true;
    await window.hotelButler.browser.activate(tab.id);
    this.activeTabIds[tab.channelId] = tab.id;
    this.activeChannelId = tab.channelId;
    await this.syncBounds();
  }

  /**
   * 浏览器工作区挂载时的兜底激活：只在**没人明确指定过**要看哪个 tab 时才生效。
   * 带着绑定意图进来时，标签页由 `BindHotelDialog` 开——那条链先起跑但后完成，
   * 这里不让位就会把它顶掉。
   */
  async activateIfIdle(tab: BrowserTab): Promise<void> {
    if (this.#explicitlyActivated) return;
    await this.activate(tab);
  }

  /** 重新进入工作区时该激活哪个 tab —— 规则与理由见 `pickRestoreTarget`。 */
  restoreTarget(tabs: readonly BrowserTab[]): BrowserTab | undefined {
    return pickRestoreTarget(tabs, this.activeChannelId, this.activeTabIds[this.activeChannelId]);
  }

  /** 离开浏览器工作区：下次进来重新按「默认激活」处理，让位状态也一并复位。 */
  releaseViewportSession(): void {
    this.#explicitlyActivated = false;
    this.#viewportSuspended = false;
  }

  /** 切换渠道：没有已打开的 tab 时必须显式 `hide`，否则上一个渠道的视图会留在原地。 */
  async selectChannel(channelId: string): Promise<void> {
    this.#explicitlyActivated = true;
    this.activeChannelId = channelId;
    const tabId = this.activeTabIds[channelId];
    if (tabId) await window.hotelButler.browser.activate(tabId);
    else await window.hotelButler.browser.hide();
    await this.syncBounds();
  }

  /** 关闭 tab，并把活动标签让给相邻的一个。返回是否需要调用方额外处理。 */
  async close(tab: BrowserTab): Promise<void> {
    const tabs = this.tabsByChannel[tab.channelId] ?? [];
    const index = tabs.findIndex((item) => item.id === tab.id);
    await window.hotelButler.browser.close(tab.id);

    const nextTabs = tabs.filter((item) => item.id !== tab.id);
    this.tabsByChannel[tab.channelId] = nextTabs;
    if (this.activeTabIds[tab.channelId] !== tab.id) return;

    const next = nextTabs[Math.min(index, nextTabs.length - 1)];
    if (!next) {
      delete this.activeTabIds[tab.channelId];
      return;
    }
    this.activeTabIds[tab.channelId] = next.id;
    await window.hotelButler.browser.activate(next.id);
  }

  /** 关掉同渠道下 partition 不同的旧 tab（切换账号时用）。 */
  async closeSuperseded(
    channelId: string,
    keepPartitionName: string,
    previousTabs: readonly BrowserTab[],
    onError: (error: unknown) => void,
  ): Promise<void> {
    const closed = new Set<string>();
    for (const tab of previousTabs) {
      if (tab.partitionName === keepPartitionName) continue;
      try {
        await window.hotelButler.browser.close(tab.id);
        closed.add(tab.id);
      } catch (error) {
        onError(error);
      }
    }
    if (closed.size > 0) {
      this.tabsByChannel[channelId] = (this.tabsByChannel[channelId] ?? []).filter(
        (tab) => !closed.has(tab.id),
      );
    }
  }

  /** 把主进程已有的 tab 灌进来（浏览器页首次挂载时对账用）。 */
  hydrate(tabs: readonly BrowserTab[]): void {
    for (const tab of tabs) this.updateTab(tab);
  }

  /**
   * 让出内容区给 HTML 弹窗。`WebContentsView` 是原生视图，挂在
   * `window.contentView` 上，**永远浮在所有 HTML 之上**——CSS 的 z-index 管不
   * 到它，弹窗会被网页整个盖住。这里把视图缩成零尺寸腾出位置（不用 `hide()`：
   * 那会把 `activeTabId` 置 null，恢复时还得重新 activate）。
   */
  async suspendViewport(): Promise<void> {
    this.#viewportSuspended = true;
    await window.hotelButler.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  /** 弹窗关闭后按视口 DOM 的真实尺寸恢复。 */
  async resumeViewport(): Promise<void> {
    this.#viewportSuspended = false;
    await this.syncBounds();
  }

  async syncBounds(): Promise<void> {
    // 让位期间 ResizeObserver / resize 事件不得把视图又撑回来。
    if (this.#viewportSuspended) return;
    const read = this.#readViewport;
    if (!read) return;
    const bounds = read();
    await window.hotelButler.browser.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }
}

export const browserOtaTabs = new BrowserOtaTabsStore();
