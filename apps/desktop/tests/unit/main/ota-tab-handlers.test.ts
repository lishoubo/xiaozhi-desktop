/**
 * `otaTab.openExisting` 的意图透传 —— 绑定流程靠它把「这次打开是为了绑酒店」
 * 带到主进程。intent 来自渲染进程，是不可信输入，必须过 schema 才能进
 * `LoginDetector`。
 */
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn(
        (
          channel: string,
          listener: (event: { sender: unknown }, ...args: unknown[]) => unknown,
        ) => {
          handlers.set(channel, listener);
        },
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { registerOtaTabHandlers } from '../../../src/main/ipc/ota-tab-handlers';

const TAB = { id: 'tab-1', channelId: 'douyin' };

function setup() {
  const sender = {};
  const service = {
    openForNewLogin: vi.fn(),
    openWithImportedCookie: vi.fn(),
    openExisting: vi.fn(() => TAB as never),
    openExistingForBinding: vi.fn(() => TAB as never),
  };
  registerOtaTabHandlers({
    window: { webContents: sender },
    service,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const invoke = (...args: unknown[]) => {
    const handler = electron.handlers.get(IPC_CHANNELS.otaTab.openExisting);
    if (!handler) throw new Error('Missing handler');
    return handler({ sender }, ...args);
  };
  return { service, invoke };
}

describe('otaTab.openExisting 的意图透传', () => {
  it('带绑定意图时原样交给 service', () => {
    const { service, invoke } = setup();
    const intent = { kind: 'bind-hotel', requestId: 'req-1' };

    expect(invoke('credential-1', intent)).toEqual(TAB);
    expect(service.openExisting).toHaveBeenCalledWith('credential-1', intent);
  });

  it('不带意图时是普通打开', () => {
    const { service, invoke } = setup();

    expect(invoke('credential-1')).toEqual(TAB);
    expect(service.openExisting).toHaveBeenCalledWith('credential-1', undefined);
  });

  it('拒绝形状不对的意图，不调 service', () => {
    const { service, invoke } = setup();

    expect(() => invoke('credential-1', { kind: 'drop-tables' })).toThrow('登录凭据标识无效');
    expect(service.openExisting).not.toHaveBeenCalled();
  });
});
