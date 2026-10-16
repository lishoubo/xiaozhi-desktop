import { describe, expect, it, vi } from 'vitest';
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

function setup(userType: 'STAFF' | 'HOTEL' | undefined) {
  registered.clear();
  const browserManager = {
    list: vi.fn(() => []),
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
    currentSession: vi.fn(async () => ({ ...identity, userType })),
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

  it.each(['HOTEL', undefined] as const)(
    'rejects %s before reusing an old tab',
    async (userType) => {
      const { open, browserManager, accessToken } = setup(userType);
      await expect(open()).rejects.toThrow('仅服务商用户可打开小智平台');
      expect(browserManager.list).not.toHaveBeenCalled();
      expect(accessToken).not.toHaveBeenCalled();
    },
  );
});
