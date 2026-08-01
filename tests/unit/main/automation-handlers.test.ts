import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, listener: (event: { sender: unknown }) => unknown) => {
        handlers.set(channel, listener);
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { registerAutomationHandlers } from '../../../src/main/ipc/automation-handlers';

beforeEach(() => electron.handlers.clear());

describe('automation IPC', () => {
  it('returns the cached startup result only to the main renderer', async () => {
    const sender = {};
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const result = Promise.resolve({ ok: true as const, checkIn: '8月1日' });
    registerAutomationHandlers({ window: { webContents: sender }, result, logger });
    const handler = electron.handlers.get(IPC_CHANNELS.automation.getCtripCheckIn);

    await expect(handler?.({ sender })).resolves.toEqual({ ok: true, checkIn: '8月1日' });
    expect(() => handler?.({ sender: {} })).toThrow('拒绝来自非主应用窗口的请求');
    expect(logger.warn).toHaveBeenCalledWith('Rejected untrusted IPC request', {
      channel: IPC_CHANNELS.automation.getCtripCheckIn,
    });
  });
});
