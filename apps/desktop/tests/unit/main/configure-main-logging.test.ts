import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  configureDesktopLogDirectory,
  configureMainLogging,
} from '../../../src/main/logging/configure-main-logging';
import { safeLogErrorDetails } from '../../../src/shared/logging';

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

  it('uses Electron native logs with a profile-specific directory', () => {
    const setAppLogsPath = vi.fn();
    const getPath = vi
      .fn<(name: 'logs') => string>()
      .mockReturnValueOnce('/native/app/logs')
      .mockReturnValueOnce('/native/app/logs/staff');

    expect(configureDesktopLogDirectory({ getPath, setAppLogsPath }, 'staff')).toBe(
      '/native/app/logs/staff',
    );
    expect(setAppLogsPath).toHaveBeenNthCalledWith(1);
    expect(setAppLogsPath).toHaveBeenNthCalledWith(2, path.join('/native/app/logs', 'staff'));
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
