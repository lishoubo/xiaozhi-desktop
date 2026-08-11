/**
 * 价量态改动监控的**分发器**：订阅导航事实 → 按渠道选适配器 → 进页 attach / 离页 detach
 * → 把解读结果送出去。
 *
 * 与 `hotel-probe-dispatcher.ts` 并列（同样是 `channels/` 下的跨渠道调度，不是业务编排），
 * 但触发模型完全不同，所以是另一个类而非复用：
 *
 * ```
 *                   HotelProbeDispatcher        AmountChangeWatcher
 * 触发            intent（用户点了「绑定」）      URL（用户走到了改价页）
 * 次数            一次性，探完就结束              常驻，用户改多少次收多少次
 * 对页面          会点菜单、挪走用户的页面        只旁听，绝不碰
 * 订阅            tab:credential-checked        tab:navigated
 * ```
 *
 * 订阅 `BrowserManager` 的 `tab:navigated` 而不是 `ota-tab` 的事件总线：需要的就是「URL 变了」
 * 这个**原始**事实，不需要等登录判定/凭证归并（那是 `tab:credential-checked` 的语义，时机
 * 晚得多，而且只在登录相关的导航才发）。`BrowserManager` 对 `did-navigate` 与
 * `did-navigate-in-page` 都发这个事件，SPA 内部路由跳转（抖音改价页正是这种）才不会漏。
 *
 * 上报走注入的窄回调 `report` —— `channels/` 不认识 `services`/`gateway`（eslint 强制），
 * 由 composition root 接到上报服务。与 `HotelProbeDispatcher.notify` 同一手法。
 */
import type { ChannelId } from '../ids';
import type { AppLogger } from '../../shared/logging';
import type { OtaAmountChangeObserved } from '../../shared/types/amount-change';
import { AmountSaveCapture } from './amount-save-capture';
import type { AmountChangeAdapter } from './types';

/** 架构约束：不 import `browser-manager` 实现，用类型查询表达结构依赖。 */
type BrowserManagerEvents = Pick<import('../browser/browser-manager').BrowserManager, 'on'>;
type TabNavigatedEvent = import('../browser/browser-manager').TabNavigatedEvent;
type TabClosedEvent = import('../browser/browser-manager').TabClosedEvent;

export type AmountChangeWatcherDependencies = Readonly<{
  browserManager: BrowserManagerEvents;
  /**
   * 有适配器的渠道才监听。本期只有抖音一项 —— 携程/美团尚无改价踩点，registry 里那两个
   * 渠道没有这个字段，投影出来的 Map 里就没有它们，watcher 自然不管。
   */
  adapters: ReadonlyMap<ChannelId, AmountChangeAdapter>;
  logger: AppLogger;
  /** 窄回调：把解读好的改动送出去。见文件头。 */
  report: (observed: OtaAmountChangeObserved) => void;
}>;

export class AmountChangeWatcher {
  /** 每个正在监听的 tab 一份 capture。不在这个 Map 里 = 当前没监听。 */
  private readonly captures = new Map<string, AmountSaveCapture>();

  constructor(private readonly deps: AmountChangeWatcherDependencies) {
    this.deps.browserManager.on('tab:navigated', (event: TabNavigatedEvent) => {
      void this.onNavigated(event);
    });
    this.deps.browserManager.on('tab:closed', (event: TabClosedEvent) => {
      this.stopWatching(event.tabId);
    });
  }

  private async onNavigated(event: TabNavigatedEvent): Promise<void> {
    const adapter = this.deps.adapters.get(event.channelId as ChannelId);
    // 没有适配器的渠道（本期的携程/美团）根本不参与监听。
    if (!adapter) return;

    if (!adapter.isWatchableUrl(event.url)) {
      // 用户离开了改价页 —— 停止监听，把 debugger 让出来。
      this.stopWatching(event.tabId);
      return;
    }
    // 已经在监听了。SPA 在同一个页面内可能连发多次导航事件（筛选、切日期都可能改 URL），
    // 不能每次都重新 attach。
    if (this.captures.has(event.tabId)) return;

    const capture = new AmountSaveCapture(
      event.webContents,
      adapter,
      this.deps.logger,
      (observed) => {
        const parsed = adapter.parse(observed);
        if (!parsed) {
          this.deps.logger.warn(
            'Amount change watcher: could not locate the hotel, not reporting',
            {
              channel: event.channelId,
              endpointId: observed.endpointId,
            },
          );
          return;
        }
        this.deps.logger.info('Amount change observed', {
          channel: parsed.source,
          endpointId: parsed.endpointId,
          otaHotelId: parsed.otaHotelId,
        });
        this.deps.report(parsed);
      },
    );

    // 先登记再 attach：attach 是异步的，登记晚了会让期间到来的第二个导航事件误判为
    // 「还没监听」而重复 attach。
    this.captures.set(event.tabId, capture);
    try {
      await capture.attach();
    } catch (error) {
      this.captures.delete(event.tabId);
      this.deps.logger.warn('Amount change watcher: failed to attach', {
        channel: event.channelId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return;
    }
    this.deps.logger.info('Amount change watching started', {
      channel: event.channelId,
      tabId: event.tabId,
    });
  }

  private stopWatching(tabId: string): void {
    const capture = this.captures.get(tabId);
    if (!capture) return;
    this.captures.delete(tabId);
    capture.detach();
  }
}
