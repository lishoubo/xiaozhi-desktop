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
    expect(Object.isFrozen(api.browser)).toBe(true);
  });

  it('does not expose generic settings storage to the renderer', () => {
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, vi.fn());

    expect(api).not.toHaveProperty('settings');
  });

  it('maps browser actions to fixed IPC channels', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await api.browser.create('ctrip', 'https://ebooking.ctrip.com/');
    await api.browser.activate('tab-1');
    await api.browser.close('tab-1');
    await api.browser.goBack('tab-1');
    await api.browser.goForward('tab-1');
    await api.browser.hide();
    await api.browser.list();
    await api.browser.reload('tab-1');
    await api.browser.setBounds({ x: 80, y: 120, width: 800, height: 600 });
    await api.cookies.listSources();
    await api.cookies.import('edge');

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.browser.create, { channelId: 'ctrip', url: 'https://ebooking.ctrip.com/' }],
      [IPC_CHANNELS.browser.activate, 'tab-1'],
      [IPC_CHANNELS.browser.close, 'tab-1'],
      [IPC_CHANNELS.browser.goBack, 'tab-1'],
      [IPC_CHANNELS.browser.goForward, 'tab-1'],
      [IPC_CHANNELS.browser.hide],
      [IPC_CHANNELS.browser.list],
      [IPC_CHANNELS.browser.reload, 'tab-1'],
      [IPC_CHANNELS.browser.setBounds, { x: 80, y: 120, width: 800, height: 600 }],
      [IPC_CHANNELS.cookies.listSources],
      [IPC_CHANNELS.cookies.import, 'edge'],
    ]);
  });
});
