/**
 * 登录判定 —— 订阅 `BrowserManager` 的原始导航事件，判断被登记的标签页是否
 * 已经离开登录页；命中则触发账号身份探测，并在**写库完成后**广播结果。
 *
 * 与 `OtaTabService` 的分工：那边负责「把打开意图翻译成 partition 策略 +
 * BrowserManager 调用」，这边负责「这次导航意味着什么」。此前两者揉在同一个
 * 类里，它既是链路入口（开 tab 时登记）又是中继站（订阅导航做判定），双重
 * 身份让职责说不清。
 *
 * 时序约束（历史踩坑，见 `split-ota-hotel-prob-feature` 变更记录，必须保留）：
 * `tab:credential-checked` 必须等 `triggerDiscovery` 写库完成才广播，不能在
 * 导航发生的那一刻广播——否则 `HotelProbeDispatcher` 可能查到 null 而永久
 * 错过探测机会（携程场景下标签页只导航一次，没有第二次机会）。
 */
import type { WebContents } from 'electron';
import type { ChannelId } from '../ids';
import type { LoginUrlMatcher } from '../channels/types';
import type { OtaCredential } from '../../shared/types/ota-credential';
import { TabEventBus } from './tab-event-bus';
import type { OtaTabIntent } from './intent';

/** 架构约束：不 import `browser-manager` 实现，用类型查询表达结构依赖。 */
type TabNavigatedEvent = import('../browser/browser-manager').TabNavigatedEvent;
type TabClosedEvent = import('../browser/browser-manager').TabClosedEvent;

type LoginTabState = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
  /** 这次打开的意图，随广播带给下游；tab 关闭时随本记录一起消失。 */
  intent?: OtaTabIntent;
}>;

export type LoginDetectorDependencies = Readonly<{
  browserManager: Pick<import('../browser/browser-manager').BrowserManager, 'on'>;
  tabEventBus: TabEventBus;
  loginUrlMatchers: ReadonlyMap<ChannelId, LoginUrlMatcher>;
  /**
   * 返回值：这次触发最终确认的 OtaCredential（没有则为 null）。**写库完成后**
   * 才返回，本类据此决定何时广播 `tab:credential-checked`。
   */
  triggerDiscovery: (
    partitionName: string,
    channel: ChannelId,
    landingUrl: string,
    webContents: WebContents,
  ) => Promise<OtaCredential | null>;
}>;

export class LoginDetector {
  private readonly loginTabs = new Map<string, LoginTabState>();
  /**
   * 这个 tab 的探测「已经落定或正在进行」，不必再触发。
   *
   * 两条退出规则，缺一不可：
   * - 探测**成功**（返回非 null）→ 保留标记，同 tab 后续导航不再重复探测。
   * - 探测**失败**（返回 null 或抛错）→ **必须移除**，否则这个 tab 就被判死：
   *   后续任何导航都直接走 not-applicable，用户刷新也没用，只能关掉重开。
   *   抖音探测有轮询超时，页面慢一点就返回 null，这条路很常走。
   *
   * 与 `OtaCredentialService.inflight` 的分工：这里是 **tab 维度**的门，管
   * 「这个标签页要不要再探一次」；那边是 **partition 维度**的门，管「同一份登录
   * 态不要被并发探测」。两者语义不同，不要合并成一个。
   */
  private readonly triggered = new Set<string>();

  constructor(private readonly deps: LoginDetectorDependencies) {
    this.deps.browserManager.on('tab:navigated', (event: TabNavigatedEvent) => {
      void this.handleTabNavigated(event);
    });
    this.deps.browserManager.on('tab:closed', (event: TabClosedEvent) => {
      this.loginTabs.delete(event.tabId);
      this.triggered.delete(event.tabId);
    });
  }

  /**
   * 登记「这个标签页需要登录判定」。渠道未注册 matcher 时不参与 URL 触发。
   * `intent` 说明这次打开是为了做什么，会随广播带给下游订阅者。
   */
  register(tabId: string, channel: ChannelId, intent?: OtaTabIntent): void {
    const loginUrlMatcher = this.deps.loginUrlMatchers.get(channel);
    if (!loginUrlMatcher) return;
    this.loginTabs.set(tabId, { channel, loginUrlMatcher, intent });
  }

  private async handleTabNavigated(event: TabNavigatedEvent): Promise<void> {
    const state = this.loginTabs.get(event.tabId);
    const baseEvent = {
      tabId: event.tabId,
      partitionName: event.partitionName,
      channel: event.channelId,
      url: event.url,
      webContents: event.webContents,
      intent: state?.intent,
    };

    if (!state || this.triggered.has(event.tabId)) {
      this.deps.tabEventBus.emitCredentialChecked({
        ...baseEvent,
        outcome: { kind: 'not-applicable' },
      });
      return;
    }

    const isPastLogin = state.loginUrlMatcher.isPastLogin(event.url);
    if (!isPastLogin) {
      this.deps.tabEventBus.emitCredentialChecked({
        ...baseEvent,
        outcome: { kind: 'not-yet-past-login' },
      });
      return;
    }

    this.triggered.add(event.tabId);
    let credential: OtaCredential | null = null;
    try {
      // 必须 await：广播早于写库会让下游查到 null，永久错过探测机会。
      credential = await this.deps.triggerDiscovery(
        event.partitionName,
        state.channel,
        event.url,
        event.webContents,
      );
    } finally {
      // 没探出凭证就把门重新打开，让这个 tab 的下一次导航还能再试。抛错走同一条
      // 路——探测崩了更应该允许重试，而不是把标签页永久判死。
      if (!credential) this.triggered.delete(event.tabId);
    }
    this.deps.tabEventBus.emitCredentialChecked({
      ...baseEvent,
      outcome: { kind: 'checked', credential },
    });
  }
}
