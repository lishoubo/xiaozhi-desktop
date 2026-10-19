import { describe, expect, it, vi } from 'vitest';
import type { BrowserTab } from '../../../src/shared/browser';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const registered = vi.hoisted(() => new Map<string, () => unknown>());

vi.mock('../../../src/main/ipc/create-handler-registry', () => ({
  createHandlerRegistry: () => ({
    handle: (channel: string, _schema: unknown, _message: string, listener: () => unknown) => {
      registered.set(channel, listener);
    },
    dispose: () => registered.clear(),
  }),
}));

import { registerInternalPageHandlers } from '../../../src/main/ipc/internal-page-handlers';

const identity = {
  userId: 1,
  username: 'user',
  fullName: null,
  role: 'HOTEL_STAFF',
  orgId: 1,
  accessibleHotelIds: [],
  permissions: [],
};

function setup(
  userType: 'STAFF' | 'HOTEL' | undefined,
  permissions: readonly string[] = [],
  accessibleHotelIds: readonly number[] = [],
) {
  registered.clear();
  const browserManager = {
    list: vi.fn((): BrowserTab[] => []),
    activate: vi.fn(),
    createWithAlreadyPartition: vi.fn(() => ({
      id: 'tab-1',
      channelId: 'xiaozhi',
      title: '小智平台',
      url: 'https://rms.example.com/unified-pricing',
      canGoBack: false,
      canGoForward: false,
      loading: false,
      partitionName: 'persist:xiaozhi:dev:internal',
      failure: null,
    })),
    loadUrl: vi.fn(),
    close: vi.fn(),
  };
  const accessToken = vi.fn(async () => 'token');
  registerInternalPageHandlers({
    window: { webContents: {} },
    browserManager,
    rmsWebOrigin: 'https://rms.example.com',
    accessToken,
    currentSession: vi.fn(async () => ({
      ...identity,
      userType,
      permissions: [...permissions],
      accessibleHotelIds: [...accessibleHotelIds],
    })),
    partitionName: 'persist:xiaozhi:dev:internal',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const open = registered.get(IPC_CHANNELS.internalPage.open);
  if (!open) throw new Error('Internal page handler was not registered');
  return { open, browserManager, accessToken };
}

describe('internal page access', () => {
  it('opens for staff', async () => {
    const { open, browserManager } = setup('STAFF');
    await expect(open()).resolves.toEqual(
      expect.objectContaining({ id: 'tab-1', channelId: 'xiaozhi' }),
    );
    expect(browserManager.createWithAlreadyPartition).toHaveBeenCalledOnce();
  });

  it('opens for a hotel user with personal permission and an accessible hotel', async () => {
    const { open, browserManager } = setup('HOTEL', ['xiaozhi:access'], [8]);
    await expect(open()).resolves.toEqual(expect.objectContaining({ channelId: 'xiaozhi' }));
    expect(browserManager.createWithAlreadyPartition).toHaveBeenCalledOnce();
  });

  it.each([
    ['HOTEL', [], [8]],
    ['HOTEL', ['xiaozhi:access'], []],
    [undefined, ['xiaozhi:access'], [8]],
  ] as const)('rejects identity without both conditions', async (userType, permissions, hotels) => {
    const { open, browserManager, accessToken } = setup(userType, permissions, hotels);
    await expect(open()).rejects.toThrow('当前账号无权打开小智平台');
    expect(browserManager.activate).not.toHaveBeenCalled();
    expect(accessToken).not.toHaveBeenCalled();
  });

  it('closes a stale internal page before rejecting a revoked hotel user', async () => {
    const { open, browserManager } = setup('HOTEL', [], [8]);
    browserManager.list.mockReturnValue([
      {
        id: 'old-tab',
        channelId: 'xiaozhi',
        title: '小智平台',
        url: 'https://rms.example.com/unified-pricing',
        canGoBack: false,
        canGoForward: false,
        loading: false,
        partitionName: 'persist:xiaozhi:dev:internal',
        failure: null,
      },
    ]);
    await expect(open()).rejects.toThrow('当前账号无权打开小智平台');
    expect(browserManager.close).toHaveBeenCalledWith('old-tab');
    expect(browserManager.activate).not.toHaveBeenCalled();
  });
});
