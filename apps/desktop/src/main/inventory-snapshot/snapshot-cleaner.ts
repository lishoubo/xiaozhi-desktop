/**
 * 快照清理 —— 删掉过了保留期的格子，**分批让出，不阻塞主进程**。
 *
 * ## ⚠️ 这里修的是一个具体的坑：原实现同步跑在启动路径上
 *
 * 之前这段代码长在 `composition/app-scope.ts` 的 `createAppScope` 里，数据库刚打开、
 * 窗口还没创建时**同步**调一次无界 `DELETE`。原注释论证的是「为什么放启动时而不随写入」
 * （过期按天发生，一天一次够了）—— 那个论证是对的，但它**没考虑同步执行的代价**：
 * 这段卡多久，窗口就晚出来多久。
 *
 * ```
 *  改之前                          改之后
 *  ────────                        ────────
 *  createAppScope                  createAppScope
 *    └─ DELETE（同步、无界）          └─（不做清理）
 *    └─ 建窗口  ← 被拖后             └─ 建窗口  ← 不受影响
 *                                  app.whenReady + startupDelayMs
 *                                    └─ 首轮：删一批 → setImmediate → 删下一批 → …
 *                                    └─ 每 idleMs 再来一轮
 * ```
 *
 * ## 为什么需要定时，而不是只在启动时跑一次
 *
 * 桌面应用的常态是**常年不关**。只在启动时清理，意味着这类机器永远不清 —— 而它们恰恰是
 * 数据积得最多的那批。
 *
 * 不设抖动（与扫描的 `jitterMs` 不同）：清理是纯本地动作，没有外部副作用，不存在扫描那种
 * 「集中部署的机器同相位打渠道」的风控问题。
 *
 * ## ⚠️ 单线程下「异步」的唯一有效形式是分片让出
 *
 * 与 `SnapshotWriteQueue` 同一条理由：better-sqlite3 是**同步** API，包一层 Promise 只是
 * 推迟到下一个 tick 执行，阻塞时长一分不少。真正有用的是每删一批就 `setImmediate` 让出，
 * 让事件循环能处理 IPC 与 CDP 事件。
 */
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';

/** 清理的运行期参数。**每轮重新读**，服务端下发才能不重启生效。 */
export type SnapshotCleanupRuntimeConfig = Readonly<{
  retentionDays: number;
  batchSize: number;
  idleMs: number;
}>;

export type SnapshotCleanerDependencies = Readonly<{
  /**
   * 删一批，返回实际删除行数。同步方法 —— 分批的责任在本类，不在 repository。
   *
   * 窄回调而非整个 repository：清理不该够得着读基线、写入这些方法。
   */
  deleteOlderThan: (beforeDate: string, limit: number) => number;
  logger: AppLogger;
  /** 每轮重新读配置 —— 构造时取一次会让服务端下发失效。 */
  config: () => SnapshotCleanupRuntimeConfig;
  /** 让出事件循环的方式。**入参**以便测试里同步驱动。 */
  scheduleBatch?: (run: () => void) => void;
  /** 定时器。**入参**以便测试同步驱动。 */
  setTimer?: (run: () => void, delayMs: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  /** 当前时刻。**入参**以便断言 cutoff。 */
  now?: () => Date;
}>;

/**
 * 两轮之间的最小间隔。配置是每轮重读的、且设计上可由服务端下发，所以这里要能挡住
 * 一个离谱的小值把清理变成忙循环。
 */
const MIN_IDLE_MS = 60_000;

/** 一批最多删多少行的兜底上限 —— 配置给了 0 或负数时不至于变成删不动。 */
const MIN_BATCH_SIZE = 1;

/**
 * 单轮最多删多少批。
 *
 * ⚠️ 防的是「保留期被调成 0 天」之类的配置事故：那时几乎整张表都过期，一轮会一直删下去。
 * 删不完不要紧 —— 下一轮接着删，而每轮有上限保证了让出的节奏可预期。
 */
const MAX_BATCHES_PER_ROUND = 50;

const OPERATION = 'snapshotCleanup';

export class SnapshotCleaner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private disposed = false;

  constructor(private readonly deps: SnapshotCleanerDependencies) {}

  /**
   * 启动定时清理。**首轮由调用方决定延迟**（`startupDelayMs`）—— 本类不认识启动时序，
   * 它只知道「隔多久来一轮」。
   */
  start(firstRunDelayMs: number): void {
    if (this.disposed || this.timer !== null) return;
    this.scheduleNext(Math.max(0, firstRunDelayMs));
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      const clear = this.deps.clearTimer ?? ((timer: NodeJS.Timeout) => clearTimeout(timer));
      clear(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.disposed) return;
    const setTimer =
      this.deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
    this.timer = setTimer(() => {
      this.timer = null;
      this.runRound();
    }, delayMs);
  }

  /**
   * 跑一轮：算出 cutoff，然后分批删到没有为止（或撞上单轮上限）。
   *
   * ⚠️ **不抛异常**。清理失败不该挡住任何东西 —— 库里多留些旧行只是占空间，不影响正确性。
   * 这一条沿用被替换掉的那段代码的处理方式。
   */
  private runRound(): void {
    if (this.disposed || this.running) return;
    this.running = true;

    const config = this.deps.config();
    const cutoff = this.cutoffOf(config.retentionDays);
    const batchSize = Math.max(MIN_BATCH_SIZE, Math.floor(config.batchSize));
    const startedAt = Date.now();
    let purged = 0;
    let batches = 0;

    const finish = (): void => {
      this.running = false;
      if (purged > 0) {
        this.deps.logger.info('Inventory snapshot purged stale cells', {
          operation: OPERATION,
          purged,
          batches,
          cutoff,
          elapsedMs: Date.now() - startedAt,
        });
      }
      if (this.disposed) return;
      // fixed-delay：上一轮**完全结束**后才开始计时，不是固定频率。
      this.scheduleNext(Math.max(MIN_IDLE_MS, config.idleMs));
    };

    const step = (): void => {
      if (this.disposed) {
        this.running = false;
        return;
      }

      let deleted = 0;
      try {
        deleted = this.deps.deleteOlderThan(cutoff, batchSize);
      } catch (error) {
        this.deps.logger.warn('Inventory snapshot purge failed', {
          operation: OPERATION,
          cutoff,
          purged,
          error: safeLogErrorDetails(error),
        });
        finish();
        return;
      }

      purged += deleted;
      batches += 1;

      // 没删满一批 = 已经删干净了，不必再来一次（省掉一次必定返回 0 的查询）。
      if (deleted < batchSize) {
        finish();
        return;
      }
      if (batches >= MAX_BATCHES_PER_ROUND) {
        this.deps.logger.info('Inventory snapshot purge hit per-round batch cap', {
          operation: OPERATION,
          purged,
          batches,
          cutoff,
        });
        finish();
        return;
      }

      // ⚠️ 让出事件循环再删下一批 —— 这是整个类存在的理由，不要改成循环。
      const schedule = this.deps.scheduleBatch ?? ((run: () => void) => setImmediate(run));
      schedule(step);
    };

    step();
  }

  /**
   * 保留期的边界日期（`YYYY-MM-DD`），早于它的格子被删。
   *
   * ⚠️ 与 `item_date` 同为**本地日历日**：`item_date` 存的是渠道页面上那一格代表的日期，
   * 用 UTC 算会在时区偏移下差一天，表现为「今天的格子被当成过期删掉」。
   */
  private cutoffOf(retentionDays: number): string {
    const now = this.deps.now?.() ?? new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - Math.max(0, Math.floor(retentionDays)));
    const year = cutoff.getFullYear();
    const month = String(cutoff.getMonth() + 1).padStart(2, '0');
    const day = String(cutoff.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
