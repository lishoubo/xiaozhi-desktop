import type { ApplicationDatabase } from '../database/application-database';
import type {
  CalendarEventCreateInput,
  CalendarEventRecord,
  CalendarEventUpdateInput,
  CalendarSnapshot,
} from '../../shared/calendar';

type CalendarGroupRow = Readonly<{
  id: string;
  label: string;
  color: string;
  isSystem: number;
}>;

type CalendarEventRow = Readonly<{
  id: string;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: number;
  notes: string;
  source: 'holiday-seed' | 'user';
}>;

function eventFromRow(row: CalendarEventRow): CalendarEventRecord {
  return {
    id: row.id,
    calendarId: row.calendarId,
    title: row.title,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay === 1,
    notes: row.notes,
    source: row.source,
  };
}

export interface CalendarRepository {
  load(): CalendarSnapshot;
  createEvent(input: CalendarEventCreateInput): CalendarEventRecord;
  updateEvent(input: CalendarEventUpdateInput): CalendarEventRecord;
  deleteEvent(id: string): void;
}

export class SqliteCalendarRepository implements CalendarRepository {
  constructor(private readonly database: ApplicationDatabase) {}

  load(): CalendarSnapshot {
    const groups = this.database
      .prepare<[], CalendarGroupRow>(
        `
        SELECT id, label, color, is_system AS isSystem
        FROM calendar_groups
        ORDER BY sort_order, id
      `,
      )
      .all()
      .map((row) => ({
        id: row.id,
        label: row.label,
        color: row.color,
        isSystem: row.isSystem === 1,
      }));
    const events = this.database
      .prepare<[], CalendarEventRow>(
        `
        SELECT
          id,
          calendar_id AS calendarId,
          title,
          starts_at AS startsAt,
          ends_at AS endsAt,
          is_all_day AS allDay,
          notes,
          source
        FROM calendar_events
        ORDER BY starts_at, id
      `,
      )
      .all()
      .map(eventFromRow);
    return { groups, events };
  }

  createEvent(input: CalendarEventCreateInput): CalendarEventRecord {
    this.database
      .prepare(
        `
        INSERT INTO calendar_events
          (id, calendar_id, title, starts_at, ends_at, is_all_day, notes, source)
        VALUES
          (@id, @calendarId, @title, @startsAt, @endsAt, @allDay, @notes, 'user')
      `,
      )
      .run({ ...input, allDay: input.allDay ? 1 : 0 });
    return this.getEvent(input.id);
  }

  updateEvent({ id, event }: CalendarEventUpdateInput): CalendarEventRecord {
    const existing = this.getEvent(id);
    const next = { ...existing, ...event };
    if (next.endsAt <= next.startsAt) throw new Error('日程结束时间必须晚于开始时间');
    this.database
      .prepare(
        `
        UPDATE calendar_events
        SET
          calendar_id = @calendarId,
          title = @title,
          starts_at = @startsAt,
          ends_at = @endsAt,
          is_all_day = @allDay,
          notes = @notes,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `,
      )
      .run({ ...next, allDay: next.allDay ? 1 : 0 });
    return this.getEvent(id);
  }

  deleteEvent(id: string): void {
    const result = this.database.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error('未找到日程');
  }

  private getEvent(id: string): CalendarEventRecord {
    const row = this.database
      .prepare<[string], CalendarEventRow>(
        `
        SELECT
          id,
          calendar_id AS calendarId,
          title,
          starts_at AS startsAt,
          ends_at AS endsAt,
          is_all_day AS allDay,
          notes,
          source
        FROM calendar_events
        WHERE id = ?
      `,
      )
      .get(id);
    if (!row) throw new Error('未找到日程');
    return eventFromRow(row);
  }
}
