import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openApplicationDatabase } from '../../../../src/main/database/application-database';

type LegacyAccount = Readonly<{
  id: string;
  channel: string;
  otaHotelId: string;
  otaHotelName?: string | null;
  partitionName: string;
  channelContext?: string | null;
  discoveredAt?: number;
}>;

const temporaryDirectories: string[] = [];

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function legacyDatabase(accounts: readonly LegacyAccount[] = []): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-credential-migration-'));
  temporaryDirectories.push(directory);
  const filename = path.join(directory, 'application.sqlite');
  const database = new Database(filename);
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO schema_migrations(version, name) VALUES
      (1, 'create-calendar-storage'),
      (2, 'add-calendar-event-notes'),
      (3, 'create-ota-account'),
      (4, 'rename-ota-account-display-name'),
      (5, 'add-ota-account-channel-context-and-discovered-at');

    CREATE TABLE calendar_groups (id TEXT PRIMARY KEY);
    CREATE TABLE calendar_events (id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL);

    CREATE TABLE ota_account (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      ota_hotel_id TEXT NOT NULL,
      ota_hotel_name TEXT,
      partition_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      channel_context TEXT,
      discovered_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX ota_account_channel_hotel_idx ON ota_account(channel, ota_hotel_id);
  `);
  const insert = database.prepare(`
    INSERT INTO ota_account
      (id, channel, ota_hotel_id, ota_hotel_name, partition_name, channel_context, discovered_at)
    VALUES
      (@id, @channel, @otaHotelId, @otaHotelName, @partitionName, @channelContext, @discoveredAt)
  `);
  for (const account of accounts) {
    insert.run({
      otaHotelName: null,
      channelContext: null,
      discoveredAt: 0,
      ...account,
    });
  }
  database.close();
  return filename;
}

function version6Database(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-credential-v6-migration-'));
  temporaryDirectories.push(directory);
  const filename = path.join(directory, 'application.sqlite');
  const database = new Database(filename);
  database.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO schema_migrations(version, name) VALUES
      (1, 'create-calendar-storage'),
      (2, 'add-calendar-event-notes'),
      (3, 'create-ota-account'),
      (4, 'rename-ota-account-display-name'),
      (5, 'add-ota-account-channel-context-and-discovered-at'),
      (6, 'split-ota-credential-from-account');

    CREATE TABLE calendar_groups (id TEXT PRIMARY KEY);
    CREATE TABLE calendar_events (calendar_id TEXT NOT NULL);

    CREATE TABLE ota_credential (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      partition_name TEXT NOT NULL UNIQUE,
      credential_extra TEXT,
      discovered_at INTEGER NOT NULL,
      last_refreshed_at INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO ota_credential
      (id, channel, partition_name, credential_extra, discovered_at, last_refreshed_at)
    VALUES
      ('credential-1', 'meituan', 'persist:xiaozhi:prod:meituan:one', NULL, 1700000000000, NULL);

    CREATE TABLE ota_account (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL REFERENCES ota_credential(id) ON UPDATE CASCADE ON DELETE RESTRICT,
      channel TEXT NOT NULL,
      ota_hotel_id TEXT NOT NULL,
      ota_hotel_name TEXT,
      bind_extra TEXT,
      discovered_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX ota_account_channel_hotel_idx ON ota_account(channel, ota_hotel_id);
    CREATE INDEX ota_account_credential_idx ON ota_account(credential_id);
  `);
  database.close();
  return filename;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('OTA credential v6 migration', () => {
  it('丢弃所有旧账号并创建空的新 schema，不保留 legacy 表', () => {
    const database = openApplicationDatabase(
      legacyDatabase([
        {
          id: 'unknown-account',
          channel: 'unknown',
          otaHotelId: 'hotel-1',
          partitionName: 'persist:xiaozhi:prod:unknown:one',
          channelContext: '旧格式无需解析',
        },
      ]),
      createLogger(),
    );

    expect(database.prepare('SELECT COUNT(*) AS count FROM ota_credential').get()).toEqual({
      count: 0,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM ota_account').get()).toEqual({
      count: 0,
    });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ota_account_legacy_v5'",
        )
        .get(),
    ).toBeUndefined();
    database.close();
  });

  it('新版账号表通过受限外键关联 credential，并记录 version 6', () => {
    const database = openApplicationDatabase(legacyDatabase(), createLogger());

    expect(database.prepare('PRAGMA foreign_key_list(ota_account)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'ota_credential',
          from: 'credential_id',
          to: 'id',
          on_update: 'CASCADE',
          on_delete: 'RESTRICT',
        }),
      ]),
    );
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 6').get(),
    ).toEqual({ count: 1 });
    database.close();
  });
});

describe('OTA credential channel account v7 migration', () => {
  it('保留 v6 credential，并增加可空渠道账号字段和普通联合索引', () => {
    const database = openApplicationDatabase(version6Database(), createLogger());

    expect(
      database
        .prepare('SELECT id, channel_account_id AS channelAccountId FROM ota_credential')
        .all(),
    ).toEqual([{ id: 'credential-1', channelAccountId: null }]);
    expect(database.prepare('PRAGMA index_list(ota_credential)').all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ota_credential_channel_account_idx', unique: 0 }),
      ]),
    );
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 7').get(),
    ).toEqual({ count: 1 });
    database.close();
  });
});
