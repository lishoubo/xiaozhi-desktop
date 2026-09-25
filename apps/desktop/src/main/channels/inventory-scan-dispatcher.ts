/**
 * 价量态定时扫描的**调度器** —— 周期性遍历渠道账号，取回当前状态交给上层比对。
 *
 * 与既有五个 dispatcher 并列，是**第六种触发模型**：
 *
 * ```
 *                                触发                  次数
 * HotelProbeDispatcher           intent（点绑定）       一次性
 * AmountChangeWatcher            URL（走到改价页）      常驻
 * OtaReauthDispatcher            credential-checked    每次登录判定
 * InventoryReadbackDispatcher    改动事件              每次改动一次
 * InventoryScanDispatcher        **定时**              周期性        ← 本类
 * ```
 *
 * ## ⚠️ 本类不认识任何渠道
 *
 * 没有 `if (source === 'ctrip')`，不认识端点名、不认识响应形状、不认识房型与日期。
 * 它只做四件事：**按开关决定扫不扫、遍历账号、调渠道实现、把结果递给上层**。
 *
 * ## ⚠️ 调度是 fixed-delay，不是固定频率
 *
 * 上一轮**完全结束**后才开始计时下一轮，所以实际间隔 = 本轮耗时 + `idleMs` + 抖动，
 * 恒大于配置值。用 `setTimeout` 自我重排而非 `setInterval`，两个理由：
 *
 * 1. `setInterval` 在上轮未完时会叠加，并发打同一个账号
 * 2. 抖动要求**每轮间隔都不同**，`setInterval` 只能固定周期
 *
 * 顺带因此**不需要 `inFlight` 去重** —— 同一时刻至多一轮在跑，这是调度形状保证的。
 */
import type { ChannelId } from '../ids';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
import { noopErrorReporter, type ErrorReporter } from '../error-reporting/error-reporter';
import type { JsonObject } from '../../shared/types/json';
import type { InventoryScan, ReadbackFailureReason } from './types';

/** 一个待扫目标 —— 调度层只需要这几样，不碰完整的凭证对象。 */
export type ScanTarget = Readonly<{
  channel: ChannelId;
  partitionName: string;
  /**
   * 归一后的门店 ID。取不到的目标由调用方剔除。
   *
   * ⚠️ 取值来源按渠道不同：携程取凭证的 `masterHotelId`（一个凭证天然对应一家店），
   * 美团取**已绑定门店**的 `poiId`（一个凭证挂多店，且美团没有 `masterHotelId`）。
   * 调度层不认识这个差异，由 `listTargets` 的实现负责。
   */
  otaHotelId: string;
  /**
   * 渠道专有的取数上下文。**调度层原样透传，不解读**。
   *
   * 与既有 `bindExtra` / `credentialExtra` 同一手法：给 `ScanTarget` 加具名的渠道字段
   * （如 `partnerId?`）会让调度层看见渠道知识，且每接一个渠道就多一个可选字段。
   *
   * 携程：`{}`（取数不需要额外入参，门店上下文由 cookie 决定）
   * 美团：`{ otaPartnerId }`（来自 `ota_hotel.bind_extra`）
   */
  channelExtra: JsonObject;
}>;

/**
 * 一轮扫描的汇总 —— 轮末交给上层一次。
 *
 * ⚠️ 只收 `COOKIE_EXPIRED`：网络失败、403、解析失败重新登录解决不了，混进来会让
 * 「登录已过期」提醒在断网时把所有账号一起报出来，用户很快就不再信它。
 */
export type ScanRoundSummary = Readonly<{
  /** 本轮判为登录失效的目标。同一账号多家门店会各占一条，去重由上层按 partition 做。 */
  expired: readonly ScanTarget[];
}>;

/** 扫描的运行期参数。**每轮重新读**，服务端下发才能不重启生效。 */
export type ScanRuntimeConfig = Readonly<{
  enabled: boolean;
  idleMs: number;
  jitterMs: number;
  windowDays: number;
  isChannelEnabled: (channel: ChannelId) => boolean;
  isHotelEnabled: (channel: ChannelId, otaHotelId: string) => boolean;
}>;

export type InventoryScanDispatcherDependencies = Readonly<{
  /** 有扫描能力的渠道才参与。没注册的渠道自然跳过。 */
  scans: ReadonlyMap<ChannelId, InventoryScan>;
  logger: AppLogger;
  /** 每轮重新读配置 —— 构造时取一次会让服务端下发失效。 */
  config: () => ScanRuntimeConfig;
  /** 待扫账号。窄回调：`channels/` 不认识 `database/`。 */
  listTargets: () => readonly ScanTarget[];
  /**
   * 取数成功时把原始行递出去。窄回调：比对与落库在 `inventory-snapshot/`，
   * 而 `channels/` 被 eslint 禁止依赖它。
   */
  onRows: (
    target: ScanTarget,
    rows: readonly JsonObject[],
    /** 本轮请求的窗口天数（含今天）。比对基线的区间据此算，不从返回数据反推。 */
    windowDays: number,
  ) => void;
  /**
   * 一轮**实际跑完**后调用一次（总闸关、或中途 dispose 不调）。窄回调：提醒怎么展示
   * 由装配层决定，调度层只知道轮次边界 —— 轮次边界也只有它知道。
   *
   * ⚠️ 本轮没有失效时也调（`expired` 为空）：上层据此收起上一轮的提醒。
   */
  onRoundCompleted?: (summary: ScanRoundSummary) => void;
  /** 失效上报到 GlitchTip。可选，省略走 noop。 */
  reportError?: ErrorReporter;
  /** 定时器。**入参**以便测试同步驱动。 */
  setTimer?: (run: () => void, delayMs: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  /** 抖动随机源（`[0,1)`）。**入参**以便断言间隔落在预期区间。 */
  random?: () => number;
}>;

const OPERATION = 'inventoryScan';

/**
 * 两轮之间的最小间隔。配置是每轮重读的、且设计上可由服务端下发，所以这里要能挡住
 * 一个下发错的 `idleMs`（0 / 负数 / NaN）—— 那会让调度器变成紧循环打渠道接口。
 */
const MIN_IDLE_MS = 30_000;

export class InventoryScanDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly deps: InventoryScanDispatcherDependencies) {}

  private errorReporter(): ErrorReporter {
    return this.deps.reportError ?? noopErrorReporter;
  }

  /**
   * 启动。**首轮也要等一个间隔**，不在启动时立刻扫 —— 启动期要跑迁移、登录、
   * 凭证发现，不与它们抢。
   */
  start(): void {
    if (this.disposed) return;
    this.scheduleNext();
  }

  /**
   * 排下一轮。间隔 = `idleMs` + `[0, jitterMs)` 随机抖动。
   *
   * ⚠️ 抖动不是可选项：没有它，同一批装机的机器（集中部署的门店）会按各自启动时刻
   * 形成固定节拍，长期保持同相位，每 `idleMs` 齐刷刷打一次渠道 —— 正是触发风控的形状。
   * 照 `services/updater-service.ts` 的既有手法（线上已跑）。
   */
  private scheduleNext(): void {
    if (this.disposed || this.timer !== null) return;
    const setTimer = this.deps.setTimer ?? ((run, delayMs) => setTimeout(run, delayMs));
    const random = this.deps.random ?? Math.random;
    const { idleMs, jitterMs } = this.deps.config();

    // ⚠️ `idleMs` 必须钳下限：配置每轮重读且设计上可由服务端下发，一个 0 / 负数 / NaN
    // 会把 fixed-delay 变成紧循环猛打渠道端点 —— 正是抖动机制要避免的风控形状。
    // `Math.max` 对 NaN 返回 NaN，所以用显式的有限数判断兜住。
    const safeIdleMs = Number.isFinite(idleMs) ? Math.max(MIN_IDLE_MS, idleMs) : MIN_IDLE_MS;
    const safeJitterMs = Number.isFinite(jitterMs) ? Math.max(0, jitterMs) : 0;

    const delayMs = safeIdleMs + Math.floor(random() * safeJitterMs);
    this.timer = setTimer(() => {
      this.timer = null;
      void this.runRound();
    }, delayMs);
  }

  /**
   * 跑一轮。**无论成败都排下一轮** —— 一次失败不该让对账永久停摆。
   */
  private async runRound(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.scanAll();
    } catch (error) {
      // scanAll 内部已按账号兜住异常；走到这里说明调度自身炸了。
      this.deps.logger.warn('Inventory scan round threw', {
        error: safeLogErrorDetails(error),
      });
    } finally {
      // ⚠️ 必须在 finally 里排 —— 上面任何一条返回路径都不能让循环断掉。
      if (!this.disposed) this.scheduleNext();
    }
  }

  private async scanAll(): Promise<void> {
    const config = this.deps.config();

    // ⚠️ 整轮跳过要记日志：「开关关着」与「调度器挂了」在日志上长得一模一样，
    // 不记的话排查时无从分辨。单个账号跳过则不记（那是正常配置状态，会刷噪音）。
    if (!config.enabled) {
      this.deps.logger.info('Inventory scan skipped: disabled');
      return;
    }

    const targets = this.deps.listTargets();
    const expired: ScanTarget[] = [];

    for (const target of targets) {
      if (this.disposed) return;
      if (!config.isChannelEnabled(target.channel)) continue;
      if (!config.isHotelEnabled(target.channel, target.otaHotelId)) continue;

      const scan = this.deps.scans.get(target.channel);
      // 该渠道没注册扫描能力 —— 正常情况，不记日志。
      if (!scan) continue;

      const failure = await this.scanOne(scan, target, config.windowDays);
      if (failure === 'COOKIE_EXPIRED') expired.push(target);
    }

    if (this.disposed) return;
    this.deps.onRoundCompleted?.({ expired });
  }

  /**
   * 扫一个账号。**异常与失败都不抛出** —— 一个账号的问题不该影响同轮其余账号。
   *
   * 返回失败原因（成功、跳过、抛错都返回 null），供轮末汇总。
   */
  private async scanOne(
    scan: InventoryScan,
    target: ScanTarget,
    windowDays: number,
  ): Promise<ReadbackFailureReason | null> {
    try {
      const outcome = await scan.scan(target.partitionName, windowDays, target.channelExtra);
      if (this.disposed) return null;

      switch (outcome.kind) {
        case 'ok':
          // 空行也递出去：让上层决定「确实没数据」怎么处理，调度层不替它判断。
          this.deps.onRows(target, outcome.rows, windowDays);
          return null;
        case 'skipped':
          this.deps.logger.info('Inventory scan skipped for target', {
            channel: target.channel,
            otaHotelId: target.otaHotelId,
            reason: outcome.reason,
          });
          return null;
        case 'failed':
          // 先 warn 再上报：本地日志给逐行排查，GlitchTip 给「不用等业户发日志
          // 就知道谁失效了」。两者都要。
          this.deps.logger.warn('Inventory scan failed', {
            channel: target.channel,
            otaHotelId: target.otaHotelId,
            reason: outcome.reason,
          });
          this.errorReporter()(new Error(`Inventory scan failed: ${outcome.reason}`), {
            operation: OPERATION,
            channel: target.channel,
            hotelId: target.otaHotelId || undefined,
            extra: { reason: outcome.reason },
          });
          return outcome.reason;
      }
    } catch (error) {
      // 渠道实现应已吞掉异常并返回 failed；走到这里说明它有没兜住的路径。
      this.deps.logger.warn('Inventory scan threw', {
        channel: target.channel,
        otaHotelId: target.otaHotelId,
        error: safeLogErrorDetails(error),
      });
      this.errorReporter()(error, {
        operation: OPERATION,
        channel: target.channel,
        hotelId: target.otaHotelId || undefined,
        extra: { reason: 'threw' },
      });
      return null;
    }
  }

  /** 释放：停掉定时器，并让 in-flight 的结果不再投递。 */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      const clearTimer = this.deps.clearTimer ?? ((timer: NodeJS.Timeout) => clearTimeout(timer));
      clearTimer(this.timer);
      this.timer = null;
    }
  }
}
