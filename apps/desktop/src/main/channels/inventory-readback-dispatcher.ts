/**
 * 房量回读的**分发器**：收到一条改动上报 → 按渠道选实现 → 调用 → 把回读结果递出去。
 *
 * 与既有四个 dispatcher 并列，是**第五种触发模型**：
 *
 * ```
 *                   触发                          次数
 * HotelProbeDispatcher    intent（点了「绑定」）    一次性
 * AmountChangeWatcher     URL（走到了改价页）       常驻
 * OtaReauthDispatcher     credential-checked       每次登录判定
 * InventoryReadbackDispatcher  **改动事件**         每次改动一次   ← 本类
 * ```
 *
 * ## ⚠️ 本类不认识任何渠道
 *
 * 没有 `if (source === 'ctrip')`，不认识端点名，不认识 `changeType`，不消费房型日期。
 * 它只做三件事：**按渠道取实现、调用、递出结果**。
 *
 * 「这次改动要不要回读」「读哪些房型日期」「上报体怎么组」全在渠道实现里（见
 * `channels/types.ts` 的 `InventoryReadback`）。没有这项能力的渠道**不注册**即可 ——
 * `readbacks.get()` 落空，本类自然跳过。加一个渠道 = 写一份实现 + `registry.ts` 加一行，
 * 本文件一个字都不用改。
 *
 * ## 与既有上报链路并行
 *
 * ```
 * adapter.parse → OtaAmountChangeObserved
 *                        ├─→ [既有，不动] report → RMS
 *                        └─→ [本类] readback → report → RMS
 * ```
 *
 * 两条链路**互不阻塞**：回读失败不影响既有上报，既有上报失败也不阻止回读。两条上报的
 * `operationId` 由 service 层各自生成，**独立、不互相去重** —— 它们是两个不同的事实
 * （「想改成什么」与「实际是什么」）。
 */
import type { WebContents } from 'electron';
import type { ChannelId } from '../ids';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
import type { OtaAmountChangeObserved } from '../../shared/types/amount-change';
import type { InventoryReadback } from './types';

export type InventoryReadbackDispatcherDependencies = Readonly<{
  /**
   * 有回读能力的渠道才参与。当前只有携程；美团/抖音**刻意不注册**（美团待踩点，抖音是
   * 被跟价的一端，回读它没有意义）。
   */
  readbacks: ReadonlyMap<ChannelId, InventoryReadback>;
  logger: AppLogger;
  /**
   * 窄回调：把回读结果送出去。`channels/` 不认识 `services`/`gateway`（eslint 强制），
   * 由 composition root 接到上报服务 —— 与 `AmountChangeWatcher.report` 同一手法。
   */
  report: (observed: OtaAmountChangeObserved, partitionName: string) => void;
}>;

export class InventoryReadbackDispatcher {
  private disposed = false;

  constructor(private readonly deps: InventoryReadbackDispatcherDependencies) {}

  /**
   * 既有链路刚产出一条改动上报时调用。
   *
   * **不 await**：回读要走两次网络请求，让它阻塞既有上报没有道理。调用方 fire-and-forget，
   * 本方法内部吞掉所有异常（渠道实现已经吞了一层，这里是兜底）。
   */
  async onReported(
    report: OtaAmountChangeObserved,
    webContents: WebContents,
    partitionName: string,
  ): Promise<void> {
    if (this.disposed) return;

    const readback = this.deps.readbacks.get(report.source);
    // 该渠道没注册回读能力 —— 正常情况，不记日志（否则每次改价都会刷一条噪音）。
    if (!readback) return;

    try {
      const outcome = await readback.readback(report, webContents);

      // 释放期间回来的结果直接丢弃 —— 不投递给已经拆掉的 scope。
      if (this.disposed) return;

      switch (outcome.kind) {
        case 'ok':
          this.deps.report(outcome.report, partitionName);
          return;
        case 'skipped':
          // ⚠️ 与 failed 分开记：「不需要读」和「读失败了」在日志里长得一样的话，排查时
          // 分不清是逻辑挡掉了还是真出错。既有 watcher 在「监听被悄悄停掉」上吃过这个亏。
          this.deps.logger.info('Inventory readback skipped', {
            channel: report.source,
            triggerEndpointId: report.endpointId,
            reason: outcome.reason,
          });
          return;
        case 'failed':
          this.deps.logger.warn('Inventory readback failed', {
            channel: report.source,
            triggerEndpointId: report.endpointId,
            reason: outcome.reason,
          });
          return;
      }
    } catch (error) {
      // 渠道实现应该已经吞掉异常并返回 failed；走到这里说明它自己炸了。
      this.deps.logger.warn('Inventory readback threw', {
        channel: report.source,
        triggerEndpointId: report.endpointId,
        error: safeLogErrorDetails(error),
      });
    }
  }

  /**
   * 释放。当前没有定时器需要清理（`delayMs` 默认 0，回读同步发起）—— 只标记一个位，
   * 让 in-flight 的结果不再投递。将来若启用延迟，定时器的登记与取消加在这里。
   */
  dispose(): void {
    this.disposed = true;
  }
}
