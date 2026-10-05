import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeartbeatService } from '../../../src/main/services/heartbeat-service';

afterEach(() => vi.useRealTimers());

describe('HeartbeatService', () => {
  it('reports immediately, uses the latest configured fixed delay, and stops on logout', async () => {
    vi.useFakeTimers();
    let intervalMs = 60_000;
    const report = vi.fn(async () => {});
    const service = new HeartbeatService({
      report,
      intervalMs: () => intervalMs,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    service.start();
    await vi.runAllTicks();
    expect(report).toHaveBeenCalledTimes(1);

    intervalMs = 120_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(report).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(report).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(report).toHaveBeenCalledTimes(3);

    service.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(report).toHaveBeenCalledTimes(3);
  });

  it('does not overlap calls and keeps scheduling after failure', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const report = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const warn = vi.fn();
    const service = new HeartbeatService({
      report,
      intervalMs: () => 0,
      logger: { info: vi.fn(), warn, error: vi.fn() },
    });

    service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(report).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(report).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(report).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(report).toHaveBeenCalledTimes(3);
    service.dispose();
  });

  it('waits for an in-flight report before restarting after a session switch', async () => {
    vi.useFakeTimers();
    let finishFirst: (() => void) | undefined;
    const report = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const service = new HeartbeatService({
      report,
      intervalMs: () => 60_000,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    service.start();
    service.stop();
    service.start();
    expect(report).toHaveBeenCalledTimes(1);

    finishFirst?.();
    await vi.runAllTicks();
    expect(report).toHaveBeenCalledTimes(2);
    service.dispose();
  });
});
