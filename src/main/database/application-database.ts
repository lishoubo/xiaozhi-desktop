import Database from 'better-sqlite3';
import type { AppLogger } from '../../shared/logging';
import { chinaMainlandHolidaySeed } from '../calendar/china-holidays';
import {
  HOTEL_OPERATIONS_MOCK_GROUP,
  hotelOperationsMockEvents,
} from '../calendar/hotel-operations-mock';

export type ApplicationDatabase = Database.Database;

type ApplicationDatabaseOptions = Readonly<{
  includeMockData?: boolean;
}>;

type Migration = Readonly<{
  version: number;
  name: string;
  apply: (database: ApplicationDatabase) => void;
}>;

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create-calendar-storage',
    apply(database) {
      database.exec(`
        CREATE TABLE calendar_groups (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          color TEXT NOT NULL CHECK (color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
          is_system INTEGER NOT NULL CHECK (is_system IN (0, 1)),
          sort_order INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE calendar_events (
          id TEXT PRIMARY KEY,
          calendar_id TEXT NOT NULL REFERENCES calendar_groups(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
          starts_at TEXT NOT NULL,
          ends_at TEXT NOT NULL CHECK (ends_at > starts_at),
          is_all_day INTEGER NOT NULL CHECK (is_all_day IN (0, 1)),
          source TEXT NOT NULL CHECK (source IN ('holiday-seed', 'user')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX calendar_events_range_idx ON calendar_events(starts_at, ends_at);
        CREATE INDEX calendar_events_group_idx ON calendar_events(calendar_id);
      `);

      const insertGroup = database.prepare(`
        INSERT INTO calendar_groups (id, label, color, is_system, sort_order)
        VALUES (@id, @label, @color, @isSystem, @sortOrder)
      `);
      insertGroup.run({
        id: 'china-mainland-holidays',
        label: '中国大陆节假日',
        color: '#dd5b00',
        isSystem: 1,
        sortOrder: 0,
      });
      insertGroup.run({
        id: 'personal',
        label: '我的日历',
        color: '#5645d4',
        isSystem: 1,
        sortOrder: 1,
      });

      const insertEvent = database.prepare(`
        INSERT INTO calendar_events
          (id, calendar_id, title, starts_at, ends_at, is_all_day, source)
        VALUES
          (@id, @calendarId, @title, @startsAt, @endsAt, @allDay, @source)
      `);
      for (const event of chinaMainlandHolidaySeed()) {
        insertEvent.run({ ...event, allDay: event.allDay ? 1 : 0 });
      }
    },
  },
  {
    version: 2,
    name: 'add-calendar-event-notes',
    apply(database) {
      database.exec(`
        ALTER TABLE calendar_events
        ADD COLUMN notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000);
      `);
    },
  },
];

function migrate(database: ApplicationDatabase): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const appliedRows = database
    .prepare<[], { version: number }>('SELECT version FROM schema_migrations')
    .all();
  const applied = new Set(appliedRows.map(({ version }) => version));
  let appliedCount = 0;

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.transaction(() => {
      migration.apply(database);
      database
        .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
    })();
    appliedCount += 1;
  }
  return appliedCount;
}

function synchronizeMockData(database: ApplicationDatabase, includeMockData: boolean): number {
  return database.transaction(() => {
    database
      .prepare('DELETE FROM calendar_events WHERE calendar_id = ?')
      .run(HOTEL_OPERATIONS_MOCK_GROUP.id);
    database
      .prepare('DELETE FROM calendar_groups WHERE id = ?')
      .run(HOTEL_OPERATIONS_MOCK_GROUP.id);
    if (!includeMockData) return 0;

    database
      .prepare(
        `
        INSERT INTO calendar_groups (id, label, color, is_system, sort_order)
        VALUES (@id, @label, @color, @isSystem, 2)
      `,
      )
      .run({
        ...HOTEL_OPERATIONS_MOCK_GROUP,
        isSystem: HOTEL_OPERATIONS_MOCK_GROUP.isSystem ? 1 : 0,
      });
    const insertEvent = database.prepare(`
      INSERT INTO calendar_events
        (id, calendar_id, title, starts_at, ends_at, is_all_day, notes, source)
      VALUES
        (@id, @calendarId, @title, @startsAt, @endsAt, @allDay, @notes, 'user')
    `);
    const events = hotelOperationsMockEvents();
    for (const event of events) insertEvent.run({ ...event, allDay: event.allDay ? 1 : 0 });
    return events.length;
  })();
}

export function openApplicationDatabase(
  filename: string,
  logger: AppLogger,
  options: ApplicationDatabaseOptions = {},
): ApplicationDatabase {
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    const migrationsApplied = migrate(database);
    const mockEventsSeeded = synchronizeMockData(database, options.includeMockData === true);
    logger.info('Application database initialized', { migrationsApplied, mockEventsSeeded });
    return database;
  } catch (error) {
    logger.error('Application database initialization failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    database.close();
    throw error;
  }
}
