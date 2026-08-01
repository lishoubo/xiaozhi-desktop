import { describe, expect, it, vi } from 'vitest';
import {
  configureMainLogging,
  redactLogData,
} from '../../../src/main/logging/configure-main-logging';

describe('redactLogData', () => {
  it('removes secrets from structured values, errors, and free-form text', () => {
    const error = new Error(
      'Request failed: https://example.com/callback?access_token=token-value&room=101',
    );

    const result = redactLogData([
      {
        account: 'front-desk',
        password: 'plain-text-password',
        nested: {
          authorization: 'Bearer structured-token',
          cookie: 'session=structured-session',
        },
      },
      'Authorization: Bearer free-form-token password=free-form-password',
      error,
    ]);

    expect(result).toEqual([
      {
        account: 'front-desk',
        password: '[REDACTED]',
        nested: {
          authorization: '[REDACTED]',
          cookie: '[REDACTED]',
        },
      },
      'Authorization: Bearer [REDACTED] password=[REDACTED]',
      { name: 'Error' },
    ]);
    expect(JSON.stringify(result)).not.toContain('token-value');
    expect(JSON.stringify(result)).not.toContain('plain-text-password');
    expect(JSON.stringify(result)).not.toContain('structured-session');
    expect(JSON.stringify(result)).not.toContain('https://example.com');
  });

  it('handles circular error causes without interrupting logging', () => {
    const error = new Error('cyclic failure');
    error.cause = error;

    expect(redactLogData([error])).toEqual([{ name: 'Error' }]);
  });
});

describe('configureMainLogging', () => {
  it('persists production logs with rotation and captures process failures', () => {
    const logger = createLogger();

    configureMainLogging(logger, {
      appVersion: '1.2.3',
      isPackaged: true,
      platform: 'darwin',
    });

    expect(logger.initialize).toHaveBeenCalledWith({
      includeFutureSessions: true,
      spyRendererConsole: false,
    });
    expect(logger.transports.file.level).toBe('info');
    expect(logger.transports.file.maxSize).toBe(10 * 1024 * 1024);
    expect(logger.transports.console.level).toBe('warn');
    expect(logger.errorHandler.startCatching).toHaveBeenCalledWith({
      showDialog: false,
    });
    expect(logger.eventLogger.startLogging).toHaveBeenCalledWith({
      level: 'warn',
      scope: 'electron',
    });
    expect(logger.info).toHaveBeenCalledWith('Application logging initialized', {
      appVersion: '1.2.3',
      isPackaged: true,
      platform: 'darwin',
    });
  });

  it('keeps persistent debug diagnostics and console output during development', () => {
    const logger = createLogger();

    configureMainLogging(logger, {
      appVersion: '1.2.3',
      isPackaged: false,
      platform: 'linux',
    });

    expect(logger.transports.file.level).toBe('debug');
    expect(logger.transports.console.level).toBe('debug');
  });

  it('installs a redaction hook before emitting startup metadata', () => {
    const logger = createLogger();

    configureMainLogging(logger, {
      appVersion: '1.2.3',
      isPackaged: true,
      platform: 'win32',
    });

    expect(logger.hooks).toHaveLength(1);
    const message = {
      data: [{ refreshToken: 'secret', safe: 'value' }],
    };

    expect(logger.hooks[0](message)).toEqual({
      data: [{ refreshToken: '[REDACTED]', safe: 'value' }],
    });
  });
});

function createLogger() {
  return {
    errorHandler: {
      startCatching: vi.fn(),
    },
    eventLogger: {
      startLogging: vi.fn(),
    },
    hooks: [] as Array<(message: { data: unknown[] }) => { data: unknown[] }>,
    info: vi.fn(),
    initialize: vi.fn(),
    transports: {
      console: {
        level: 'silly' as string | false,
      },
      file: {
        getFile: vi.fn(() => ({ path: '/logs/main.log' })),
        level: 'silly' as string | false,
        maxSize: 1024,
      },
      ipc: {
        level: 'silly' as string | false,
      },
      remote: {
        level: false as string | false,
      },
    },
  };
}
