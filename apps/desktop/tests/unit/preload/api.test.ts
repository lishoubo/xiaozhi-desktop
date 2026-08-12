import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { createDesktopApi } from '../../../src/preload/api';

describe('createDesktopApi', () => {
  it('maps the narrow auth API without exposing a session token', async () => {
    const employee = {
      id: '2',
      orgId: '42',
      username: 'desktop-demo',
      fullName: '桌面体验员工',
      phone: '13800138000',
      roleCode: 'FRONT_DESK',
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.auth.requestPhoneCode) {
        return { accepted: true, expiresInSeconds: 300 };
      }
      if (channel === IPC_CHANNELS.auth.currentSession) return null;
      if (channel === IPC_CHANNELS.auth.logout) return { success: true };
      return employee;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await expect(api.auth.requestPhoneCode('13800138000')).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 300,
    });
    await expect(api.auth.loginWithPhoneCode('13800138000', '654321')).resolves.toEqual(employee);
    await expect(api.auth.currentSession()).resolves.toBeNull();
    await expect(api.auth.logout()).resolves.toEqual({ success: true });
    expect(JSON.stringify(api)).not.toContain('token');
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.auth.requestPhoneCode, '13800138000'],
      [IPC_CHANNELS.auth.loginWithPhoneCode, '13800138000', '654321'],
      [IPC_CHANNELS.auth.currentSession],
      [IPC_CHANNELS.auth.logout],
    ]);
  });

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

  it('maps Agent conversation deletion to fixed validated IPC channels', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.agent.deleteConversation) return { deletedCount: 1 };
      if (channel === IPC_CHANNELS.agent.clearConversations) return { deletedCount: 4 };
      return undefined;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);
    const conversationId = '11111111-1111-4111-8111-111111111111';

    await expect(api.agent.deleteConversation(conversationId)).resolves.toEqual({
      deletedCount: 1,
    });
    await expect(api.agent.clearConversations()).resolves.toEqual({ deletedCount: 4 });
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.agent.deleteConversation, conversationId],
      [IPC_CHANNELS.agent.clearConversations],
    ]);
  });

  it('maps Agent run cancellation to its validated IPC channel', async () => {
    const runId = '33333333-3333-4333-8333-333333333333';
    const invoke = vi.fn(async () => ({ runId, status: 'cancelled' }));
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await expect(api.agent.cancelRun(runId)).resolves.toEqual({ runId, status: 'cancelled' });
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.agent.cancelRun, runId);
  });

  it('maps browser actions to fixed IPC channels', async () => {
    const tab = {
      id: 'tab-1',
      channelId: 'ctrip',
      title: 'Ctrip',
      url: 'https://ebooking.ctrip.com/',
      canGoBack: false,
      canGoForward: false,
      loading: false,
      partitionName: 'persist:xiaozhi:prod:ctrip:short',
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.browser.activate) return tab;
      if (channel === IPC_CHANNELS.browser.list) return [tab];
      if (channel === IPC_CHANNELS.browser.getAudioMuted) return false;
      if (channel === IPC_CHANNELS.browser.setAudioMuted) return true;
      if (channel === IPC_CHANNELS.cookies.listSources) {
        return [{ id: 'edge', name: 'Microsoft Edge' }];
      }
      if (channel === IPC_CHANNELS.cookies.import) return { imported: 1, failed: 0 };
      if (channel === IPC_CHANNELS.cookies.listImportedChannels) {
        return [{ channel: 'ctrip', importedAt: '2026-08-05T00:00:00.000Z' }];
      }
      return undefined;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await api.browser.activate('tab-1');
    await api.browser.close('tab-1');
    await api.browser.goBack('tab-1');
    await api.browser.goForward('tab-1');
    await api.browser.getAudioMuted();
    await api.browser.hide();
    await api.browser.list();
    await api.browser.reload('tab-1');
    await api.browser.setBounds({ x: 80, y: 120, width: 800, height: 600 });
    await api.browser.setAudioMuted(true);
    await api.cookies.listSources();
    await api.cookies.import('edge');
    await api.cookies.listImportedChannels();

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.browser.activate, 'tab-1'],
      [IPC_CHANNELS.browser.close, 'tab-1'],
      [IPC_CHANNELS.browser.goBack, 'tab-1'],
      [IPC_CHANNELS.browser.goForward, 'tab-1'],
      [IPC_CHANNELS.browser.getAudioMuted],
      [IPC_CHANNELS.browser.hide],
      [IPC_CHANNELS.browser.list],
      [IPC_CHANNELS.browser.reload, 'tab-1'],
      [IPC_CHANNELS.browser.setBounds, { x: 80, y: 120, width: 800, height: 600 }],
      [IPC_CHANNELS.browser.setAudioMuted, true],
      [IPC_CHANNELS.cookies.listSources],
      [IPC_CHANNELS.cookies.import, 'edge'],
      [IPC_CHANNELS.cookies.listImportedChannels],
    ]);
  });

  it('exposes a typed calendar data source over fixed IPC channels', async () => {
    const snapshot = {
      groups: [
        {
          id: 'personal',
          label: '我的日历',
          color: '#5645d4',
          isSystem: true,
        },
      ],
      events: [],
    };
    const event = {
      id: 'event-1',
      calendarId: 'personal',
      title: '需求复盘',
      startsAt: '2026-08-03T09:00:00.000',
      endsAt: '2026-08-03T10:00:00.000',
      allDay: false,
      notes: '',
      source: 'user' as const,
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.calendar.load) return snapshot;
      if (channel === IPC_CHANNELS.calendar.deleteEvent) return undefined;
      return event;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);
    const input = {
      id: event.id,
      calendarId: event.calendarId,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      notes: event.notes,
    };

    await expect(api.calendar.load()).resolves.toEqual(snapshot);
    await expect(api.calendar.createEvent(input)).resolves.toEqual(event);
    await expect(
      api.calendar.updateEvent({ id: event.id, event: { title: '夏季需求复盘' } }),
    ).resolves.toEqual(event);
    await expect(api.calendar.deleteEvent(event.id)).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.calendar.load],
      [IPC_CHANNELS.calendar.createEvent, input],
      [
        IPC_CHANNELS.calendar.updateEvent,
        {
          id: event.id,
          event: { title: '夏季需求复盘' },
        },
      ],
      [IPC_CHANNELS.calendar.deleteEvent, event.id],
    ]);
  });

  it('drops malformed main-process events before they reach renderer listeners', () => {
    const subscribe = vi.fn();
    const stateListener = vi.fn();
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, vi.fn(), subscribe);

    api.browser.onStateChanged(stateListener);
    const stateSubscription = subscribe.mock.calls[0][1] as (value: unknown) => void;
    stateSubscription({ id: 'tab-1' });

    expect(stateListener).not.toHaveBeenCalled();
  });

  it('rejects malformed invoke responses before returning them to the renderer', async () => {
    const api = createDesktopApi(
      { chrome: '1', electron: '2', node: '3' },
      vi.fn().mockResolvedValue({ autoLaunch: 'yes', version: '1.0.0' }),
    );

    await expect(api.system.getPreferences()).rejects.toThrow('主进程返回的数据格式无效');
  });

  it('maps otaCredential reads and opens to fixed IPC channels', async () => {
    const credential = {
      id: 'credential-1',
      channel: 'douyin',
      channelAccountId: 'user-1',
      partitionName: 'persist:xiaozhi:prod:douyin:short',
      credentialExtra: { name: '运营账号' },
      discoveredAt: 1000,
      lastRefreshedAt: null,
    };
    const tab = {
      id: 'tab-1',
      channelId: 'douyin',
      title: '抖音来客',
      url: 'https://life.douyin.com/p/home',
      canGoBack: false,
      canGoForward: false,
      loading: false,
      partitionName: credential.partitionName,
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.otaCredential.listByChannel) return [credential];
      if (channel === IPC_CHANNELS.otaTab.openExisting) return tab;
      return undefined;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await expect(api.otaCredential.listByChannel('douyin')).resolves.toEqual([credential]);
    await expect(api.otaTab.openExisting('credential-1')).resolves.toEqual(tab);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.otaCredential.listByChannel, 'douyin'],
      // 不带意图时第二个参数是 undefined——普通打开，探测候选无人接收。
      [IPC_CHANNELS.otaTab.openExisting, 'credential-1', undefined],
    ]);
  });

  it('subscribes to sanitized ota-credential discovery-completed events', () => {
    const subscribe = vi.fn();
    const listener = vi.fn();
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, vi.fn(), subscribe);

    api.otaCredential.onDiscoveryCompleted(listener);
    const subscription = subscribe.mock.calls[0][1] as (value: unknown) => void;
    subscription({ channel: 'douyin' });

    expect(subscribe).toHaveBeenCalledWith(
      IPC_CHANNELS.otaCredential.discoveryCompleted,
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith({ channel: 'douyin' });
  });

  it('maps hotel management reads and mutations to fixed IPC channels', async () => {
    const snapshot = {
      hotels: [{ id: 1, name: '示例酒店', status: 1 }],
      otaAccounts: [
        {
          id: 30101,
          hotelId: 1,
          otaHotelId: 'ota-1',
          otaHotelName: '示例 OTA 酒店',
          status: 'BOUND',
          source: 'douyin',
          bindExtra: null,
        },
      ],
    };
    const createdHotel = { id: 2, name: '新酒店', status: 1 };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.hotelManagement.load) return snapshot;
      if (channel === IPC_CHANNELS.hotelManagement.createHotel) return createdHotel;
      return undefined;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await expect(api.hotelManagement.load()).resolves.toEqual(snapshot);
    await expect(api.hotelManagement.createHotel({ name: '新酒店' })).resolves.toEqual(
      createdHotel,
    );
    await expect(api.hotelManagement.deleteHotel(1)).resolves.toBeUndefined();
    await expect(api.hotelManagement.unbindOtaAccount(30101)).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.hotelManagement.load],
      [IPC_CHANNELS.hotelManagement.createHotel, { name: '新酒店' }],
      [IPC_CHANNELS.hotelManagement.deleteHotel, 1],
      [IPC_CHANNELS.hotelManagement.unbindOtaAccount, 30101],
    ]);
  });

  it('rejects malformed hotel management snapshots before returning them to the renderer', async () => {
    const api = createDesktopApi(
      { chrome: '1', electron: '2', node: '3' },
      vi.fn().mockResolvedValue({ hotels: [{ id: 1, name: '示例酒店' }], otaAccounts: [] }),
    );

    await expect(api.hotelManagement.load()).rejects.toThrow('主进程返回的数据格式无效');
  });
});
