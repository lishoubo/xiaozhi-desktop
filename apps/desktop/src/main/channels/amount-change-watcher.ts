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
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
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
   * 有适配器的渠道才监听。三渠道（抖音/携程/美团）目前都已实装；将来新接的渠道在踩点
   * 完成前不在 registry 里赋这个字段，投影出来的 Map 里就没有它，watcher 自然不管。
   */
  adapters: ReadonlyMap<ChannelId, AmountChangeAdapter>;
  logger: AppLogger;
  /**
   * 窄回调：把解读好的改动送出去。见文件头。
   *
   * 带上 `partitionName` 是因为上报体要补渠道账号信息，而凭证是按 partition 存的。
   * `channels/` 够不着仓储（eslint 禁止），所以只把这个键交出去，由 service 侧去查。
   */
  report: (observed: OtaAmountChangeObserved, partitionName: string) => void;
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
    // 没有适配器的渠道根本不参与监听（当前三渠道都有，这条是给将来新接的渠道留的）。
    if (!adapter) return;

    if (!adapter.isWatchableUrl(event.url)) {
      // 用户离开了改价页 —— 停止监听，把 debugger 让出来。
      this.stopWatching(event.tabId);
      return;
    }
    // 已经在监听了。SPA 在同一个页面内可能连发多次导航事件（筛选、切日期都可能改 URL），
    // 不能每次都重新 attach。
    if (this.captures.has(event.tabId)) return;

    // 解读（含「丢弃」与「留作上下文」的分流）在 capture 里做 —— 上下文是页面级状态，
    // 而 capture 正好是每个 tab 一个实例，见 `amount-save-capture.ts` 文件头。
    // 丢弃路径的日志由各适配器自己打（它们才知道缺的是哪个字段）。
    const capture = new AmountSaveCapture(
      event.webContents,
      adapter,
      this.deps.logger,
      (report) => {
        this.deps.logger.info('Amount change observed', {
          channel: report.source,
          endpointId: report.endpointId,
          otaHotelId: report.otaHotelId,
        });
        this.deps.report(report, event.partitionName);
      },
    );

    // 先登记再 attach：attach 是异步的，登记晚了会让期间到来的第二个导航事件误判为
    // 「还没监听」而重复 attach。
    this.captures.set(event.tabId, capture);
    let attached: boolean;
    try {
      attached = await capture.attach();
    } catch (error) {
      this.captures.delete(event.tabId);
      this.deps.logger.warn('Amount change watcher: failed to attach', {
        channel: event.channelId,
        error: safeLogErrorDetails(error),
      });
      return;
    }

    // debugger 被酒店探测占着，本次没挂上。**必须撤销登记** —— 留着这个死 capture 会让
    // 上面那句 `captures.has()` 判定为「已在监听」，此后这个 tab 上的每次导航都直接 return，
    // 等探测结束让出 debugger 也再没有机会重挂，这个 tab 就永久拦不到改价了。
    //
    // 日志必须与成功路径明确区分：这里若照打 `watching started`，真机排查时看到的是
    // 「已启动 + 改价没反应」，与携程那次「监听被悄悄停掉」一样无从下手。
    if (!attached) {
      this.captures.delete(event.tabId);
      this.deps.logger.warn('Amount change watcher: not watching, debugger is busy', {
        channel: event.channelId,
        tabId: event.tabId,
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
    // 这条日志不是可有可无的：detach 之后这个 tab 就再也拦不到改价了。真机排查时
    // 「监听被悄悄停掉」与「用户没改价」在日志上长得一模一样，没有这条就无从区分
    // —— 2026-08-11 携程路由认错时，正是缺了它导致排查绕了几轮。
    this.deps.logger.info('Amount change watching stopped', { tabId });
  }
}
