/**
 * 快照写入队列 —— **投递即返回**，把写库从触发方的链路上摘下来。
 *
 * ## ⚠️ 这是队列，不是线程
 *
 * 名字里没有 "thread" 是有意的。主进程是**单线程**（全仓 `worker_threads` 命中 0），
 * 这里不存在任何并发：投递与消费都排在同一个事件循环上，串行发生。把它当成并发去加锁，
 * 只会加出一堆永远不竞争的锁。
 *
 * ```
 * 回读完成 ─┐
 * 自然读   ─┼──→ [ 队列：按格子键去重合并 ] ──→ 单一消费者串行 drain ──→ SQLite
 * 定时扫描 ─┘        ▲                              │
 *               投递即返回                   失败：吞掉 + 记日志，不回传
 * ```
 *
 * ## 为什么要有这一层
 *
 * | | |
 * |---|---|
 * | **触发方零阻塞** | 投递只是往 Map 里塞一个对象，不等写库 |
 * | **写失败被隔离** | 消费者内部吞异常，触发方根本不知道写失败了，更不会因此中断监听 |
 * | **写入天然串行** | 单一消费者按序 drain，后到的数据一定后写 |
 *
 * 第二条是实际目标：自然读拦截与回读都是**长期驻留**的链路，一次写库失败不该让它们
 * 断掉。既有 watcher 在「监听被悄悄停掉」上吃过亏。
 *
 * ## ⚠️ 单线程下「异步写」的唯一有效形式是分片让出
 *
 * better-sqlite3 是**同步** API，包一层 Promise 只是推迟到下一个 tick 执行，阻塞时长一分
 * 不少。真正有用的是每写一批就 `setImmediate` 让出，让事件循环能处理 IPC 与 CDP 事件——
 * 见 `drain()`。
 *
 * ## 这里是「将来搬 worker」的接缝
 *
 * 投递方只 `push`，不 await、不关心谁消费；消费侧进出都是纯数据。将来若实测确认写库确实
 * 阻塞，把消费者换成 worker 即可，**投递方一行不改**。
 *
 * ⚠️ 但先别搬：收益只有写库那几毫秒（网络等待完全不占线程，UI 在另一个**进程**里），
 * 代价是结构化克隆、双连接 `SQLITE_BUSY`、跨线程调试。**用 `flushedRows`/`flushMs` 日志
 * 实测后再定。**
 */
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
import { snapshotKeyOf, type SnapshotCell } from './types';

/** 一批最多写多少行，写完让出事件循环。 */
const DEFAULT_BATCH_SIZE = 200;

/**
 * 队列里最多攒多少格。超出时丢弃**最早**的，并记一条 warn。
 *
 * 不设上限的队列在渠道返回异常膨胀时会把内存吃光。取一个远大于正常量级的值
 * （一轮全量扫描典型 30 房型 × 7 天 = 210 格）——正常情况永远碰不到，碰到了就是出事了。
 */
const DEFAULT_MAX_PENDING = 20_000;

export type SnapshotWriteQueueDependencies = Readonly<{
  /** 实际落库。同步方法 —— 事务内不得有 await，见 repository。 */
  write: (cells: readonly SnapshotCell[]) => number;
  logger: AppLogger;
  batchSize?: number;
  maxPending?: number;
  /** 让出事件循环的方式。**入参**以便测试里同步驱动。 */
  scheduleDrain?: (run: () => void) => void;
}>;

export class SnapshotWriteQueue {
  /**
   * ⚠️ 用 Map 而非数组：键是格子的唯一标识，同一格重复投递时**后者覆盖前者**。
   *
   * 这既是防膨胀（用户狂翻日历时同一格会被反复投递），也是合并写——一格只写最终值。
   * Map 的插入序即投递序，所以 drain 仍是先进先出。
   */
  private readonly pending = new Map<string, SnapshotCell>();
  private draining = false;
  private disposed = false;

  constructor(private readonly deps: SnapshotWriteQueueDependencies) {}

  /**
   * 投递一批格子。**同步返回，不等写入**。
   *
   * 调用方无从得知写入是否成功 —— 这正是设计目标（见文件头「写失败被隔离」）。
   */
  push(cells: readonly SnapshotCell[]): void {
    if (this.disposed || cells.length === 0) return;

    const maxPending = this.deps.maxPending ?? DEFAULT_MAX_PENDING;
    for (const cell of cells) {
      this.pending.set(snapshotKeyOf(cell), cell);
    }

    if (this.pending.size > maxPending) {
      const overflow = this.pending.size - maxPending;
      // 丢最早的：新数据更接近渠道当前状态，旧的即便写进去也会被下一轮覆盖。
      let dropped = 0;
      for (const key of this.pending.keys()) {
        if (dropped >= overflow) break;
        this.pending.delete(key);
        dropped += 1;
      }
      this.deps.logger.warn('Snapshot write queue overflowed, dropped oldest cells', {
        dropped,
        maxPending,
      });
    }

    this.scheduleDrain();
  }

  /** 队列里还有多少格没写。排查与测试用。 */
  get pendingCount(): number {
    return this.pending.size;
  }

  private scheduleDrain(): void {
    if (this.draining || this.disposed || this.pending.size === 0) return;
    this.draining = true;
    const schedule = this.deps.scheduleDrain ?? ((run: () => void) => setImmediate(run));
    schedule(() => this.drain());
  }

  /**
   * 写一批，然后**让出事件循环**再写下一批。
   *
   * ⚠️ 不要改成「一次性写完所有 pending」：一轮全量扫描可能是几百行，一口气同步写完会
   * 长时间霸占事件循环，期间 IPC 排队、CDP 事件堆积。分片让出是单线程下唯一有效的缓解。
   */
  private drain(): void {
    if (this.disposed) {
      this.draining = false;
      return;
    }

    const batchSize = this.deps.batchSize ?? DEFAULT_BATCH_SIZE;
    const batch: SnapshotCell[] = [];
    for (const [key, cell] of this.pending) {
      if (batch.length >= batchSize) break;
      batch.push(cell);
      this.pending.delete(key);
    }

    if (batch.length > 0) {
      const startedAt = Date.now();
      try {
        const written = this.deps.write(batch);
        // ⚠️ 这条日志是判断「要不要把写库搬出主线程」的唯一依据（design Risks）。
        // 行数与耗时必须一起看：单看耗时无从判断是量大还是每行慢。
        this.deps.logger.info('Snapshot cells flushed', {
          flushedRows: written,
          skippedRows: batch.length - written,
          flushMs: Date.now() - startedAt,
          pendingLeft: this.pending.size,
        });
      } catch (error) {
        // ⚠️ 吞掉，不回传。投递方（回读、自然读监听）是长期驻留的链路，
        // 一次写库失败不该让它们断掉。丢弃这一批，下次该格被观测到时自然重写。
        this.deps.logger.warn('Snapshot cells flush failed, dropping batch', {
          droppedRows: batch.length,
          flushMs: Date.now() - startedAt,
          error: safeLogErrorDetails(error),
        });
      }
    }

    this.draining = false;
    // 还有剩余就再排一轮 —— 每轮之间让出一次事件循环。
    if (this.pending.size > 0) this.scheduleDrain();
  }

  /**
   * 释放。停止消费并丢弃未写入项 —— 未写入的格子下次被观测到时会自然重写，
   * 为了保住它们而在退出路径上同步写库不值得。
   */
  dispose(): void {
    this.disposed = true;
    this.pending.clear();
  }
}
