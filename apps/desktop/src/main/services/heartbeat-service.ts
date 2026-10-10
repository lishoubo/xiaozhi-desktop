import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
import { RmsSessionMissingError } from '../staff-auth/rms-session-missing-error';

const MIN_INTERVAL_MS = 30_000;

export type HeartbeatServiceDependencies = Readonly<{
  report: () => Promise<void>;
  intervalMs: () => number;
  logger: AppLogger;
}>;

/** 进程级心跳调度；每轮完成后才安排下一轮，避免请求重叠。 */
export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private active = false;
  private running = false;
  private disposed = false;
  private generation = 0;
  
  /** 记录上一次真实发起上报的时间（挂钟时间） */
  private lastReportAt = 0;

  constructor(private readonly deps: HeartbeatServiceDependencies) {}

  start(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    const generation = ++this.generation;
    if (!this.running) {
      // 从未跑过或者上一轮已经结束，立刻触发首次上报
      void this.run(generation);
    }
  }

  stop(): void {
    this.active = false;
    ++this.generation;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private async run(generation: number): Promise<void> {
    this.running = true;
    const startedAt = Date.now();
    
    // 如果是首轮，或者手动强制重启过，timeSinceLastReportMs 取 0
    const timeSinceLastReportMs = this.lastReportAt > 0 ? startedAt - this.lastReportAt : 0;
    
    try {
      await this.deps.report();
      this.deps.logger.info('Desktop heartbeat reported', {
        operation: 'desktop-heartbeat',
        durationMs: Date.now() - startedAt,
        timeSinceLastReportMs,
      });
    } catch (error) {
      if (error instanceof RmsSessionMissingError) {
        this.stop();
        return;
      }
      this.deps.logger.warn('Desktop heartbeat failed', {
        operation: 'desktop-heartbeat',
        durationMs: Date.now() - startedAt,
        timeSinceLastReportMs,
        error: safeLogErrorDetails(error),
      });
    } finally {
      this.running = false;
      this.lastReportAt = Date.now();
      if (this.active && !this.disposed) {
        if (generation !== this.generation) {
          // 在运行期间被 stop 又 start 过了，切去跑新的一代
          void this.run(this.generation);
        } else {
          const configured = this.deps.intervalMs();
          const targetIntervalMs = Number.isFinite(configured)
            ? Math.max(MIN_INTERVAL_MS, configured)
            : MIN_INTERVAL_MS;
          this.scheduleNext(generation, targetIntervalMs);
        }
      }
    }
  }

  /**
   * 按真实时间流逝（Wall-clock time）短轮询：
   * 不管睡眠多久，只要真实时间流逝达到了目标间隔，就会在醒来后的极短时间内触发。
   */
  private scheduleNext(generation: number, targetIntervalMs: number): void {
    if (this.disposed || !this.active || generation !== this.generation) return;
    
    const now = Date.now();
    const elapsed = now - this.lastReportAt;
    const remaining = targetIntervalMs - elapsed;

    if (remaining <= 0) {
      // 时间已过（含休眠超时的场景），立马跑下一轮
      void this.run(generation);
    } else {
      // 哪怕剩下时间很长，每次最多只等 1 分钟（短轮询）。
      // 这样休眠醒来后最多等 1 分钟就会被拉起来检查流逝时间并触发心跳。
      const waitTime = Math.min(remaining, 60_000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.scheduleNext(generation, targetIntervalMs);
      }, waitTime);
    }
  }
}
