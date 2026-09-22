import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  configureDesktopLogDirectory,
  configureMainLogging,
} from '../../../src/main/logging/configure-main-logging';
import { redactLogData, safeLogErrorDetails } from '../../../src/shared/logging';

describe('desktop production logging', () => {
  it('keeps error stacks and causes while redacting authentication secrets', () => {
    const cause = new Error(
      'phone=13800138000 password=private mysql://readonly:private@example.invalid/rms',
    );
    const error = new Error('request failed', { cause });

    const details = safeLogErrorDetails(error);
    const serialized = JSON.stringify(details);

    expect(details.stack).toContain('request failed');
    expect(details.cause?.stack).toContain('[REDACTED]');
    expect(serialized).not.toContain('13800138000');
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('readonly:');
  });

  it('keeps the message of a logged Error instead of reducing it to its name', () => {
    // 回归：兜底曾把 Error 削成 `{ name }`，而 name 对绝大多数错误恒为 'Error'，
    // 导致界面报错在日志里查不到根因。
    const error = new Error('凭证已失效 password=private');

    const [redacted] = redactLogData([{ error }]) as [{ error: { message: string } }];

    expect(redacted.error.message).toContain('凭证已失效');
    expect(redacted.error.message).toContain('[REDACTED]');
    expect(redacted.error.message).not.toContain('private');
  });

  // ⚠️ 这条钉住的是 dev 与打包**落在同一个目录**：`setAppLogsPath()` 无参调用时
  // Electron 用的是 bundle 名（dev 下是 `Electron`），不是 `app.setName()` 设的名字 ——
  // 日志会落到 `~/Library/Logs/Electron/`，找日志时扑空。所以必须显式传路径。
  it('按 productName 算日志目录，不依赖 bundle 名', () => {
    const setAppLogsPath = vi.fn();
    const getPath = vi
      .fn<(name: 'logs' | 'userData') => string>()
      .mockReturnValue('/native/app/logs/staff');

    expect(
      configureDesktopLogDirectory({ getPath, setAppLogsPath }, 'staff', '小智酒店管家[开发]'),
    ).toBe('/native/app/logs/staff');

    // ⛔ 不再有「先无参调一次」那步 —— 那正是 dev 落错目录的原因。
    expect(setAppLogsPath).toHaveBeenCalledTimes(1);
    const [passed] = setAppLogsPath.mock.calls[0] as [string];
    expect(passed).toContain('小智酒店管家[开发]');
    expect(passed.endsWith(path.join('小智酒店管家[开发]', 'staff'))).toBe(true);
  });

  it('writes packaged logs to a bounded file inside the resolved directory', () => {
    const info = vi.fn();
    const logger = {
      errorHandler: { startCatching: vi.fn() },
      eventLogger: { startLogging: vi.fn() },
      hooks: [],
      info,
      initialize: vi.fn(),
      transports: {
        console: { level: 'debug' as string | false },
        file: {
          level: 'debug' as string | false,
          maxSize: 0,
          inspectOptions: {},
          resolvePathFn: () => 'default.log',
        },
        ipc: { level: 'debug' as string | false },
        remote: { level: 'debug' as string | false },
      },
    };

    configureMainLogging(logger, {
      appVersion: '1.0.0',
      isPackaged: true,
      logsDirectory: '/native/app/logs/staff',
      platform: 'linux',
    });

    expect(logger.transports.file.level).toBe('info');
    expect(logger.transports.file.maxSize).toBe(10 * 1024 * 1024);
    expect(logger.transports.file.resolvePathFn()).toBe(
      path.join('/native/app/logs/staff', 'main.log'),
    );
    expect(info).toHaveBeenCalledWith(
      'Application logging initialized',
      expect.objectContaining({ logFilePath: path.join('/native/app/logs/staff', 'main.log') }),
    );
  });
});
