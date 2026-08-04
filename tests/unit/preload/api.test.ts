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
      if (channel === IPC_CHANNELS.browser.create || channel === IPC_CHANNELS.browser.activate) {
        return tab;
      }
      if (channel === IPC_CHANNELS.browser.list) return [tab];
      if (channel === IPC_CHANNELS.cookies.listSources) {
        return [{ id: 'edge', name: 'Microsoft Edge' }];
      }
      if (channel === IPC_CHANNELS.cookies.import) return { imported: 1, failed: 0 };
      if (channel === IPC_CHANNELS.automation.getCtripCheckIn) return null;
      return undefined;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await api.browser.acknowledgeInterception();
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
    await api.automation.getCtripCheckIn();

    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.browser.acknowledgeInterception],
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
      [IPC_CHANNELS.automation.getCtripCheckIn],
    ]);
  });

  it('subscribes to sanitized embedded-browser interception events', () => {
    const subscribe = vi.fn();
    const listener = vi.fn();
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, vi.fn(), subscribe);

    api.browser.onRequestIntercepted(listener);
    const subscription = subscribe.mock.calls[0][1] as (value: unknown) => void;
    subscription({ ruleId: 'ctrip-soa2' });

    expect(subscribe).toHaveBeenCalledWith(
      IPC_CHANNELS.browser.requestIntercepted,
      expect.any(Function),
    );
    expect(listener).toHaveBeenCalledWith({ ruleId: 'ctrip-soa2' });
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
    const interceptionListener = vi.fn();
    const stateListener = vi.fn();
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, vi.fn(), subscribe);

    api.browser.onRequestIntercepted(interceptionListener);
    api.browser.onStateChanged(stateListener);
    const interceptionSubscription = subscribe.mock.calls[0][1] as (value: unknown) => void;
    const stateSubscription = subscribe.mock.calls[1][1] as (value: unknown) => void;
    interceptionSubscription({ ruleId: 'unexpected-rule' });
    stateSubscription({ id: 'tab-1' });

    expect(interceptionListener).not.toHaveBeenCalled();
    expect(stateListener).not.toHaveBeenCalled();
  });

  it('rejects malformed invoke responses before returning them to the renderer', async () => {
    const api = createDesktopApi(
      { chrome: '1', electron: '2', node: '3' },
      vi.fn().mockResolvedValue({ autoLaunch: 'yes', version: '1.0.0' }),
    );

    await expect(api.system.getPreferences()).rejects.toThrow('主进程返回的数据格式无效');
  });

  it('maps otaAccount actions to fixed IPC channels', async () => {
    const account = {
      id: 'a1',
      channel: 'douyin',
      otaHotelId: 'dy-1',
      otaHotelName: '门店A',
      partitionName: 'persist:xiaozhi:prod:douyin:short',
      channelContext: 'group-1',
      discoveredAt: 1000,
    };
    const tab = {
      id: 'tab-1',
      channelId: 'douyin',
      title: '抖音来客',
      url: 'https://life.douyin.com/p/home?groupid=group-1',
      canGoBack: false,
      canGoForward: false,
      loading: false,
      partitionName: 'persist:xiaozhi:prod:douyin:short',
    };
    const invoke = vi.fn(async (channel: string) => {
      if (channel === IPC_CHANNELS.otaAccount.listByChannel) return [account];
      if (channel === IPC_CHANNELS.otaAccount.openExisting) return tab;
      return undefined;
    });
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, invoke);

    await expect(api.otaAccount.listByChannel('douyin')).resolves.toEqual([account]);
    await expect(api.otaAccount.openExisting('a1')).resolves.toEqual(tab);
    expect(invoke.mock.calls).toEqual([
      [IPC_CHANNELS.otaAccount.listByChannel, 'douyin'],
      [IPC_CHANNELS.otaAccount.openExisting, 'a1'],
    ]);
  });

  it('subscribes to sanitized ota-account bound events', () => {
    const subscribe = vi.fn();
    const listener = vi.fn();
    const api = createDesktopApi({ chrome: '1', electron: '2', node: '3' }, vi.fn(), subscribe);

    api.otaAccount.onAccountBound(listener);
    const subscription = subscribe.mock.calls[0][1] as (value: unknown) => void;
    subscription({ channel: 'douyin' });

    expect(subscribe).toHaveBeenCalledWith(IPC_CHANNELS.otaAccount.accountBound, expect.any(Function));
    expect(listener).toHaveBeenCalledWith({ channel: 'douyin' });
  });
});
