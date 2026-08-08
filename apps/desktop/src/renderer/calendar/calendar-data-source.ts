import type { CalendarEvent, CalendarInstanceApi } from '@svar-ui/svelte-calendar';
import type {
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventUpdateInput,
  CalendarSnapshot,
} from '../../shared/calendar';

export interface CalendarDataSource {
  load(): Promise<CalendarSnapshot>;
  createEvent(input: CalendarEventCreateInput): Promise<CalendarEventRecord>;
  updateEvent(input: CalendarEventUpdateInput): Promise<CalendarEventRecord>;
  deleteEvent(id: string): Promise<void>;
}

export const desktopCalendarDataSource: CalendarDataSource = {
  load: () => window.hotelButler.calendar.load(),
  createEvent: (input) => window.hotelButler.calendar.createEvent(input),
  updateEvent: (input) => window.hotelButler.calendar.updateEvent(input),
  deleteEvent: (id) => window.hotelButler.calendar.deleteEvent(id),
};

export type CalendarViewEvent = CalendarEvent &
  Readonly<{
    text: string;
    calendarId: string;
    notes: string;
    source: CalendarEventRecord['source'];
  }>;

type EventAction = {
  id?: string | number;
  event: Partial<CalendarEvent>;
};

type IdentifiedAction = { id: string | number };

function isEventAction(value: unknown): value is EventAction {
  return typeof value === 'object' && value !== null && 'event' in value;
}

function isIdentifiedAction(value: unknown): value is IdentifiedAction {
  if (typeof value !== 'object' || value === null || !('id' in value)) return false;
  return typeof value.id === 'string' || typeof value.id === 'number';
}

function parseLocalDateTime(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value);
  if (!match) return new Date(value);
  const [, year, month, day, hour, minute, second, millisecond] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  );
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalDateTime(value: Date): string {
  return `${value.getFullYear()}-${twoDigits(value.getMonth() + 1)}-${twoDigits(value.getDate())}T${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}:${twoDigits(value.getSeconds())}.${String(value.getMilliseconds()).padStart(3, '0')}`;
}

export function toCalendarEvents(events: readonly CalendarEventRecord[]): CalendarViewEvent[] {
  return events.map((event) => ({
    id: event.id,
    text: event.title,
    start: parseLocalDateTime(event.startsAt),
    end: parseLocalDateTime(event.endsAt),
    allDay: event.allDay,
    calendarId: event.calendarId,
    notes: event.notes,
    source: event.source,
  }));
}

function createInputFromEvent(event: Partial<CalendarEvent>): CalendarEventCreateInput {
  if (
    (typeof event.id !== 'string' && typeof event.id !== 'number') ||
    !(event.start instanceof Date) ||
    !(event.end instanceof Date)
  ) {
    throw new Error('日程数据不完整');
  }
  return {
    id: String(event.id),
    calendarId: typeof event.calendarId === 'string' ? event.calendarId : 'personal',
    title: typeof event.text === 'string' && event.text.trim() ? event.text.trim() : '新日程',
    startsAt: toLocalDateTime(event.start),
    endsAt: toLocalDateTime(event.end),
    allDay: event.allDay === true,
    notes: typeof event.notes === 'string' ? event.notes : '',
  };
}

function updateInputFromEvent(
  id: string | number,
  event: Partial<CalendarEvent>,
): CalendarEventUpdateInput | null {
  // 局部逐字段构建，故用可变类型；返回时收敛回只读的 CalendarEventUpdateInput
  const update: {
    -readonly [K in keyof CalendarEventUpdateInput['event']]: CalendarEventUpdateInput['event'][K];
  } = {};
  if (typeof event.text === 'string') update.title = event.text.trim() || '新日程';
  if (event.start instanceof Date) update.startsAt = toLocalDateTime(event.start);
  if (event.end instanceof Date) update.endsAt = toLocalDateTime(event.end);
  if (typeof event.allDay === 'boolean') update.allDay = event.allDay;
  if (typeof event.calendarId === 'string') update.calendarId = event.calendarId;
  if (typeof event.notes === 'string') update.notes = event.notes;
  return Object.keys(update).length > 0 ? { id: String(id), event: update } : null;
}

export function bindCalendarPersistence(
  api: CalendarInstanceApi,
  dataSource: CalendarDataSource,
  onFailure: (error: unknown) => void | Promise<void>,
  createId: () => string = () => crypto.randomUUID(),
): () => void {
  const tag = Symbol('calendar-persistence');
  const persist = async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      await onFailure(error);
    }
  };

  api.intercept(
    'add-event',
    (action) => {
      if (!isEventAction(action)) return;
      action.event.id ??= createId();
      action.event.text =
        typeof action.event.text === 'string' && action.event.text.trim()
          ? action.event.text
          : '新日程';
      action.event.calendarId ??= 'personal';
    },
    { tag },
  );
  api.on(
    'add-event',
    async (action) => {
      if (!isEventAction(action)) return true;
      await persist(() => dataSource.createEvent(createInputFromEvent(action.event)));
      return true;
    },
    { tag },
  );
  api.intercept(
    'update-event',
    (action) => {
      if (!isEventAction(action)) return;
      if (typeof action.event.text === 'string' && !action.event.text.trim()) {
        action.event.text = '新日程';
      }
    },
    { tag },
  );
  api.on(
    'update-event',
    async (action) => {
      if (!isEventAction(action) || !isIdentifiedAction(action)) return true;
      const input = updateInputFromEvent(action.id, action.event);
      if (input) await persist(() => dataSource.updateEvent(input));
      return true;
    },
    { tag },
  );
  api.on(
    'delete-event',
    async (action) => {
      if (!isIdentifiedAction(action)) return true;
      await persist(() => dataSource.deleteEvent(String(action.id)));
      return true;
    },
    { tag },
  );

  return () => api.detach(tag);
}
