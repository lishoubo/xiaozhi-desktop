import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { createDesktopApi } from '../../../src/preload/api';

describe('createDesktopApi', () => {
  it('exposes only the supported runtime versions', () => {
    const invoke = vi.fn();
    const api = createDesktopApi(
      {
        chrome: '140.0.0',
        electron: '43.0.0',
        node: '24.0.0',
      },
      invoke,
    );

    expect(api.versions).toEqual({
      chrome: '140.0.0',
      electron: '43.0.0',
      node: '24.0.0',
    });
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.versions)).toBe(true);
    expect(Object.isFrozen(api.settings)).toBe(true);
  });

  it('maps the settings API to fixed IPC channels', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await api.settings.list();
    await api.settings.get('theme');
    await api.settings.set('theme', { mode: 'dark' });
    await api.settings.delete('theme');

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.settings.list],
      [IPC_CHANNELS.settings.get, 'theme'],
      [IPC_CHANNELS.settings.set, { key: 'theme', value: { mode: 'dark' } }],
      [IPC_CHANNELS.settings.delete, 'theme'],
    ]);
  });
});
