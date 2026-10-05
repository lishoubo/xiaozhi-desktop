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

  constructor(private readonly deps: HeartbeatServiceDependencies) {}

  start(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    const generation = ++this.generation;
    if (!this.running) void this.run(generation);
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
    try {
      await this.deps.report();
      this.deps.logger.info('Desktop heartbeat reported', {
        operation: 'desktop-heartbeat',
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof RmsSessionMissingError) {
        this.stop();
        return;
      }
      this.deps.logger.warn('Desktop heartbeat failed', {
        operation: 'desktop-heartbeat',
        durationMs: Date.now() - startedAt,
        error: safeLogErrorDetails(error),
      });
    } finally {
      this.running = false;
      if (this.active && !this.disposed) {
        if (generation !== this.generation) {
          void this.run(this.generation);
        } else {
          const configured = this.deps.intervalMs();
          const intervalMs = Number.isFinite(configured)
            ? Math.max(MIN_INTERVAL_MS, configured)
            : MIN_INTERVAL_MS;
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.run(generation);
          }, intervalMs);
        }
      }
    }
  }
}
