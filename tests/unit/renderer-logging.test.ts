import { describe, expect, it, vi } from 'vitest';
import { configureRendererLogging } from '../../src/renderer/logging';

describe('configureRendererLogging', () => {
  it('forwards production diagnostics to the main process and catches renderer failures', () => {
    const logger = createLogger();

    configureRendererLogging(logger, { isDevelopment: false });

    expect(logger.transports.console.level).toBe('warn');
    expect(logger.transports.ipc.level).toBe('info');
    expect(logger.errorHandler.startCatching).toHaveBeenCalledWith({
      showDialog: false,
    });
    expect(logger.info).toHaveBeenCalledWith('Renderer logging initialized');
  });

  it('keeps debug-level console and file diagnostics in development', () => {
    const logger = createLogger();

    configureRendererLogging(logger, { isDevelopment: true });

    expect(logger.transports.console.level).toBe('debug');
    expect(logger.transports.ipc.level).toBe('debug');
  });
});

function createLogger() {
  return {
    errorHandler: {
      startCatching: vi.fn(),
    },
    hooks: [] as Array<(message: { data: unknown[] }) => { data: unknown[] }>,
    info: vi.fn(),
    transports: {
      console: {
        level: 'silly' as string | false,
      },
      ipc: {
        level: 'silly' as string | false,
      },
    },
  };
}
