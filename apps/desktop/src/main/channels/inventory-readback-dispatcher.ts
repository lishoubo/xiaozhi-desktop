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
import { noopErrorReporter, type ErrorReporter } from '../error-reporting/error-reporter';
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
  /**
   * 回读成功时把 cells 写进基线快照。**可选**，省略即不写（单测默认不注入）。
   *
   * ## ⚠️ 为什么在这一层写，而不是各渠道实现里
   *
   * 回读产出的 `changeRaw.cells` 是**两个渠道同构**的（携程与美团的 payload 文件刻意对齐了
   * 外层四个字段），所以取 cells 这一步渠道无关。写在这里，加一个渠道自动就有。
   *
   * ## ⚠️ 与 `report` 是两条互不阻塞的下游
   *
   * ```
   * readback ok ─┬─→ report   （既有，发 RMS）
   *              └─→ persist  （本次新增，写基线）
   * ```
   *
   * persist 抛错**绝不能**影响 report —— 上报是用户可感知的业务动作，写基线是后台账本。
   * 实现侧是投递队列（同步入队、不等写库），这里再兜一层 try。
   */
  persistSnapshot?: (report: OtaAmountChangeObserved, partitionName: string) => void;
  /**
   * 回读失败时同时上报到 GlitchTip。**可选**，省略即不上报（单测默认走 noop）。
   *
   * ## 为什么在这一层上报，而不是各渠道实现里
   *
   * `failed` 的收敛点本来就在这里 —— 渠道实现把失败归成 `ReadbackFailureReason` 就交出来了。
   * 在这里上报，加一个渠道自动就有；写在各实现里则要复制 N 份，且容易漏。
   *
   * ## ⚠️ 只报 `failed`，不报 `skipped`
   *
   * `skipped` 是**逻辑挡掉**（不是房量端点、只改了钟点房、日期为空），属正常流程，
   * 报上去会把噪音淹没真问题。三态分开的价值正在于此。
   */
  reportError?: ErrorReporter;
}>;

/** GlitchTip 里按操作聚合用。与既有调用点（`updater-service` 等）同一手法。 */
const OPERATION = 'inventoryReadback';

export class InventoryReadbackDispatcher {
  private disposed = false;

  constructor(private readonly deps: InventoryReadbackDispatcherDependencies) {}

  /** 上报是可选依赖 —— 没注入就走 noop，调用点不必各自判空。 */
  private errorReporter(): ErrorReporter {
    return this.deps.reportError ?? noopErrorReporter;
  }

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

    // 链路起点。与下面的 outcome 日志配对，能看出「进来了但没出去」。
    this.deps.logger.info('Inventory readback starting', {
      channel: report.source,
      triggerEndpointId: report.endpointId,
      hasPersist: this.deps.persistSnapshot !== undefined,
    });

    try {
      const outcome = await readback.readback(report, webContents);

      // 释放期间回来的结果直接丢弃 —— 不投递给已经拆掉的 scope。
      if (this.disposed) return;

      switch (outcome.kind) {
        case 'ok':
          this.deps.logger.info('Inventory readback ok', {
            channel: report.source,
            cells: Array.isArray(outcome.report.changeRaw.cells)
              ? outcome.report.changeRaw.cells.length
              : -1,
            hasPersist: this.deps.persistSnapshot !== undefined,
          });
          // 先写基线再上报：两者互不依赖，但基线是本地账本、上报要走网络，
          // 先做本地的那件事能让「上报失败但基线已更新」成为可能的状态，反过来则不行。
          this.persist(outcome.report, partitionName);
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
          // 先 warn 再 report：本地日志给「拿到日志后逐行排查」，GlitchTip 给
          // 「不用等业户发日志就知道出事了、出了多少」。两者都要，见 report-error.ts。
          this.deps.logger.warn('Inventory readback failed', {
            channel: report.source,
            triggerEndpointId: report.endpointId,
            reason: outcome.reason,
          });
          // 渠道实现返回的是归好类的 reason，没有原始 Error —— 现造一个，
          // 让 GlitchTip 能按 reason 聚合（同一类失败合并成一条，而不是每次一条）。
          //
          // ⚠️ `hotelId` 取的是**触发用的改动上报体**（本方法入参）的 otaHotelId，
          // 它两个渠道都有值。不要改成回读产出那条 —— 携程侧刻意留空串，
          // 由 service 层用凭证的 masterHotelId 覆盖，在这里取会恒为空。
          this.errorReporter()(new Error(`Inventory readback failed: ${outcome.reason}`), {
            operation: OPERATION,
            channel: report.source,
            hotelId: report.otaHotelId || undefined,
            extra: { triggerEndpointId: report.endpointId, reason: outcome.reason },
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
      // 这条比 failed 更值得看：说明渠道实现有没兜住的异常路径。
      this.errorReporter()(error, {
        operation: OPERATION,
        channel: report.source,
        hotelId: report.otaHotelId || undefined,
        extra: { triggerEndpointId: report.endpointId, reason: 'threw' },
      });
    }
  }

  /**
   * 写基线。**吞掉所有异常** —— 见 `persistSnapshot` 的注释：这条链路绝不能影响上报。
   */
  private persist(report: OtaAmountChangeObserved, partitionName: string): void {
    if (!this.deps.persistSnapshot) {
      this.deps.logger.warn('Inventory snapshot persist not wired', { channel: report.source });
      return;
    }
    try {
      this.deps.persistSnapshot(report, partitionName);
    } catch (error) {
      this.deps.logger.warn('Inventory snapshot persist threw', {
        channel: report.source,
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
