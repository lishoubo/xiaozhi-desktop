import { describe, expect, it, vi } from 'vitest';
import type { CalendarInstanceApi } from '@svar-ui/svelte-calendar';
import {
  bindCalendarPersistence,
  toCalendarEvents,
} from '../../src/renderer/calendar/calendar-data-source';

describe('calendar renderer data source adapter', () => {
  it('converts persisted local date-times to SVAR Date events', () => {
    const [event] = toCalendarEvents([
      {
        id: 'event-1',
        calendarId: 'personal',
        title: '需求复盘',
        startsAt: '2026-08-03T09:30:00.000',
        endsAt: '2026-08-03T10:30:00.000',
        allDay: false,
        notes: '关注预订节奏',
        source: 'user',
      },
    ]);

    expect(event).toEqual(
      expect.objectContaining({
        id: 'event-1',
        text: '需求复盘',
        calendarId: 'personal',
        start: new Date(2026, 7, 3, 9, 30),
        end: new Date(2026, 7, 3, 10, 30),
        notes: '关注预订节奏',
      }),
    );
  });

  it('persists SVAR add, update, and delete actions through the replaceable data source', async () => {
    const interceptors = new Map<string, (value: never) => unknown>();
    const listeners = new Map<string, (value: never) => unknown>();
    const api = {
      intercept: vi.fn((name: string, handler: (value: never) => unknown) =>
        interceptors.set(name, handler),
      ),
      on: vi.fn((name: string, handler: (value: never) => unknown) => listeners.set(name, handler)),
      detach: vi.fn(),
    } as unknown as CalendarInstanceApi;
    const dataSource = {
      load: vi.fn(),
      createEvent: vi.fn().mockResolvedValue(undefined),
      updateEvent: vi.fn().mockResolvedValue(undefined),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    };
    const onFailure = vi.fn();
    const createId = vi.fn().mockReturnValueOnce('event-1').mockReturnValueOnce('event-2');
    const unbind = bindCalendarPersistence(api, dataSource, onFailure, createId);
    const addAction = {
      event: {
        id: undefined as string | undefined,
        text: undefined as string | undefined,
        calendarId: undefined as string | undefined,
        start: new Date(2026, 7, 3, 9),
        end: new Date(2026, 7, 3, 10),
        notes: '初始备注',
      },
      edit: true,
    };

    interceptors.get('add-event')?.(addAction as never);
    await listeners.get('add-event')?.(addAction as never);

    expect(dataSource.createEvent).toHaveBeenCalledWith({
      id: 'event-1',
      calendarId: 'personal',
      title: '新日程',
      startsAt: '2026-08-03T09:00:00.000',
      endsAt: '2026-08-03T10:00:00.000',
      allDay: false,
      notes: '初始备注',
    });

    await listeners.get('update-event')?.({
      id: 'event-1',
      event: {
        text: '夏季需求复盘',
        notes: '确认九月价格策略',
      },
    } as never);

    expect(dataSource.updateEvent).toHaveBeenCalledWith({
      id: 'event-1',
      event: {
        title: '夏季需求复盘',
        notes: '确认九月价格策略',
      },
    });

    const existingAction = {
      event: {
        start: new Date(2026, 7, 4, 9),
        end: new Date(2026, 7, 4, 10),
      },
      edit: false,
    };
    interceptors.get('add-event')?.(existingAction as never);
    await listeners.get('add-event')?.(existingAction as never);
    await listeners.get('delete-event')?.({ id: 'event-2' } as never);
    expect(dataSource.deleteEvent).toHaveBeenCalledWith('event-2');
    expect(onFailure).not.toHaveBeenCalled();

    unbind();
    expect(api.detach).toHaveBeenCalledOnce();
  });
});
