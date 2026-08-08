import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn(
        (channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => unknown) => {
          handlers.set(channel, listener);
        },
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { createHandlerRegistry } from '../../../src/main/ipc/create-handler-registry';

const trustedSender = { id: 'main-window' };
const window = { webContents: trustedSender };

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function invoke(channel: string, sender: unknown, ...args: unknown[]): unknown {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`未注册的测试 channel: ${channel}`);
  return handler({ sender }, ...args);
}

beforeEach(() => {
  electron.handlers.clear();
  vi.clearAllMocks();
});

describe('createHandlerRegistry', () => {
  it('传递通过校验的参数并返回 listener 的结果', () => {
    const logger = createLogger();
    const registry = createHandlerRegistry({ window, logger });
    const listener = vi.fn((_value: string) => 'ok');

    registry.handle('demo:echo', z.tuple([z.string()]), '参数无效', listener);

    expect(invoke('demo:echo', trustedSender, 'hello')).toBe('ok');
    expect(listener).toHaveBeenCalledWith('hello');
  });

  it('拒绝来自非主窗口的请求，且不调用 listener', () => {
    const logger = createLogger();
    const registry = createHandlerRegistry({ window, logger });
    const listener = vi.fn();

    registry.handle('demo:echo', z.tuple([z.string()]), '参数无效', listener);

    expect(() => invoke('demo:echo', { id: 'other-window' }, 'hello')).toThrow(
      '拒绝来自非主应用窗口的请求',
    );
    expect(listener).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Rejected untrusted IPC request', {
      channel: 'demo:echo',
    });
  });

  it('参数不合 schema 时抛出调用方指定的文案，不泄漏 zod 内部报错', () => {
    const logger = createLogger();
    const registry = createHandlerRegistry({ window, logger });
    const listener = vi.fn();

    registry.handle('demo:echo', z.tuple([z.string()]), '日程参数无效', listener);

    expect(() => invoke('demo:echo', trustedSender, 42)).toThrow('日程参数无效');
    expect(listener).not.toHaveBeenCalled();
  });

  it('handleWithEvent 把原始 event 透给 listener', () => {
    const logger = createLogger();
    const registry = createHandlerRegistry({ window, logger });
    const listener = vi.fn((_event: unknown, _value: string) => 'ok');

    registry.handleWithEvent('demo:with-event', z.tuple([z.string()]), '参数无效', listener);
    invoke('demo:with-event', trustedSender, 'hello');

    expect(listener).toHaveBeenCalledWith({ sender: trustedSender }, 'hello');
  });

  it('dispose 注销本 registry 注册过的全部 channel', () => {
    const logger = createLogger();
    const registry = createHandlerRegistry({ window, logger });

    registry.handle('demo:a', z.tuple([]), '参数无效', () => undefined);
    registry.handle('demo:b', z.tuple([]), '参数无效', () => undefined);
    expect(electron.handlers.size).toBe(2);

    registry.dispose();

    expect(electron.handlers.size).toBe(0);
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('demo:a');
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('demo:b');
  });
});
