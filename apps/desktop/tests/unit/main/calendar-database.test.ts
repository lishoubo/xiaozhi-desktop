import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteCalendarRepository } from '../../../src/main/calendar/calendar-repository';
import { openApplicationDatabase } from '../../../src/main/database/application-database';

const temporaryDirectories: string[] = [];

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function databasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-butler-calendar-test-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'application.sqlite');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('application calendar database', () => {
  it('migrates a new database and seeds the default groups and 2026-2036 holidays', () => {
    const logger = createLogger();
    const filename = databasePath();
    const database = openApplicationDatabase(filename, logger);
    const repository = new SqliteCalendarRepository(database);

    const snapshot = repository.load();

    expect(snapshot.groups).toEqual([
      {
        id: 'china-mainland-holidays',
        label: '中国大陆节假日',
        color: '#dd5b00',
        isSystem: true,
      },
      { id: 'personal', label: '我的日历', color: '#5645d4', isSystem: true },
    ]);
    expect(snapshot.events).toHaveLength(77);
    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({
      count: 5,
    });
    expect(logger.info).toHaveBeenCalledWith('Application database initialized', {
      migrationsApplied: 5,
      mockEventsSeeded: 0,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(filename);
    database.close();
  });

  it('persists user-created, updated, and deleted events without reseeding deletions', () => {
    const logger = createLogger();
    const filename = databasePath();
    let database = openApplicationDatabase(filename, logger);
    let repository = new SqliteCalendarRepository(database);
    const created = repository.createEvent({
      id: 'user-event-1',
      calendarId: 'personal',
      title: '预测需求复盘',
      startsAt: '2026-08-03T09:00:00.000',
      endsAt: '2026-08-03T10:00:00.000',
      allDay: false,
      notes: '关注暑期入住率和渠道价格变化',
    });

    expect(created.source).toBe('user');
    expect(
      repository.updateEvent({
        id: created.id,
        event: { title: '夏季需求复盘', notes: '确认九月价格策略' },
      }),
    ).toEqual(expect.objectContaining({ title: '夏季需求复盘', notes: '确认九月价格策略' }));
    repository.deleteEvent('cn-holiday-2026-new-year');
    database.close();

    database = openApplicationDatabase(filename, logger);
    repository = new SqliteCalendarRepository(database);
    const reloaded = repository.load();
    expect(reloaded.events).toContainEqual(
      expect.objectContaining({
        id: 'user-event-1',
        title: '夏季需求复盘',
        notes: '确认九月价格策略',
      }),
    );
    expect(reloaded.events.some((event) => event.id === 'cn-holiday-2026-new-year')).toBe(false);
    expect(reloaded.events).toHaveLength(77);
    database.close();
  });

  it('enforces group and date-range integrity in the trusted database layer', () => {
    const database = openApplicationDatabase(databasePath(), createLogger());
    const repository = new SqliteCalendarRepository(database);

    expect(() =>
      repository.createEvent({
        id: 'invalid-group',
        calendarId: 'missing',
        title: '无效日程',
        startsAt: '2026-08-03T09:00:00.000',
        endsAt: '2026-08-03T10:00:00.000',
        allDay: false,
        notes: '',
      }),
    ).toThrow();
    expect(() =>
      repository.createEvent({
        id: 'invalid-range',
        calendarId: 'personal',
        title: '无效日程',
        startsAt: '2026-08-03T10:00:00.000',
        endsAt: '2026-08-03T09:00:00.000',
        allDay: false,
        notes: '',
      }),
    ).toThrow();
    database.close();
  });

  it('seeds hotel-operation mock events only when the environment opts in', () => {
    const filename = databasePath();
    let database = openApplicationDatabase(filename, createLogger(), { includeMockData: true });
    let snapshot = new SqliteCalendarRepository(database).load();

    expect(snapshot.groups).toContainEqual(
      expect.objectContaining({ id: 'mock-hotel-operations', label: '酒店运营示例' }),
    );
    expect(snapshot.events.filter((event) => event.calendarId === 'mock-hotel-operations')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: '每日运营晨会' }),
        expect.objectContaining({ title: '渠道库存与房态核对' }),
        expect.objectContaining({ title: '未来 14 天收益策略调整' }),
      ]),
    );
    database.close();

    database = openApplicationDatabase(filename, createLogger(), { includeMockData: false });
    snapshot = new SqliteCalendarRepository(database).load();
    expect(snapshot.groups.some((group) => group.id === 'mock-hotel-operations')).toBe(false);
    expect(snapshot.events.some((event) => event.calendarId === 'mock-hotel-operations')).toBe(
      false,
    );
    database.close();
  });
});
