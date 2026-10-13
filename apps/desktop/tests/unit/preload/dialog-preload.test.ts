// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  send: vi.fn(),
  executeInMainWorld: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcRenderer: { send: electronMock.send },
  contextBridge: { executeInMainWorld: electronMock.executeInMainWorld },
}));

describe('embedded dialog preload relay', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.send.mockReset();
    electronMock.executeInMainWorld.mockReset();
  });

  it('relays only the dialog kind and leaves the original dialog visible', async () => {
    const nativeAlert = vi.fn();
    window.alert = nativeAlert;
    electronMock.executeInMainWorld.mockImplementation(({ func, args }) => func(...args));

    await import('../../../src/dialog-preload');
    window.alert('private message');

    expect(nativeAlert).toHaveBeenCalledWith('private message');
    expect(electronMock.send).toHaveBeenCalledWith('embedded-web:javascript-dialog', 'alert');
    expect(electronMock.send).toHaveBeenCalledTimes(1);
  });
});
