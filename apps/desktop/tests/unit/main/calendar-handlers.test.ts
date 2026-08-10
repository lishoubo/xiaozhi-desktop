import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn(
        (channel: string, listener: (event: { sender: unknown }, ...args: unknown[]) => unknown) =>
          handlers.set(channel, listener),
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { registerCalendarHandlers } from '../../../src/main/ipc/calendar-handlers';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function invoke(channel: string, sender: unknown, ...args: unknown[]): unknown {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`Missing test IPC handler: ${channel}`);
  return handler({ sender }, ...args);
}

beforeEach(() => electron.handlers.clear());

describe('calendar IPC handlers', () => {
  it('maps trusted validated calendar mutations to the repository', () => {
    const sender = {};
    const logger = createLogger();
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
    const repository = {
      load: vi.fn(() => ({ groups: [], events: [] })),
      createEvent: vi.fn(() => event),
      updateEvent: vi.fn(() => ({ ...event, title: '夏季需求复盘' })),
      deleteEvent: vi.fn(),
    };
    registerCalendarHandlers({ window: { webContents: sender }, service: repository, logger });
    const input = {
      id: event.id,
      calendarId: event.calendarId,
      title: event.title,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      allDay: event.allDay,
      notes: event.notes,
    };

    expect(invoke(IPC_CHANNELS.calendar.load, sender)).toEqual({ groups: [], events: [] });
    expect(invoke(IPC_CHANNELS.calendar.createEvent, sender, input)).toEqual(event);
    expect(
      invoke(IPC_CHANNELS.calendar.updateEvent, sender, {
        id: event.id,
        event: { title: '夏季需求复盘' },
      }),
    ).toEqual({ ...event, title: '夏季需求复盘' });
    expect(invoke(IPC_CHANNELS.calendar.deleteEvent, sender, event.id)).toBeUndefined();
    // 日志归 CalendarService 负责，此处只验证 handler 把校验后的入参原样转发。
    expect(repository.createEvent).toHaveBeenCalledWith(input);
    expect(repository.deleteEvent).toHaveBeenCalledWith(event.id);
  });

  // 信任校验由 create-handler-registry.test.ts 覆盖；这里只留日程自身的业务约束。
  it('rejects an event whose end precedes its start, without leaking the title into logs', () => {
    const sender = {};
    const logger = createLogger();
    const repository = {
      load: vi.fn(() => ({ groups: [], events: [] })),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    };
    registerCalendarHandlers({ window: { webContents: sender }, service: repository, logger });

    expect(() =>
      invoke(IPC_CHANNELS.calendar.createEvent, sender, {
        id: 'event-1',
        calendarId: 'personal',
        title: 'private title',
        startsAt: '2026-08-03T10:00:00.000',
        endsAt: '2026-08-03T09:00:00.000',
        allDay: false,
      }),
    ).toThrow('日程参数无效');
    expect(repository.createEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('private title');
  });
});
