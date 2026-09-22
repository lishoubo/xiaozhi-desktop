import Database from 'better-sqlite3';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
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
  {
    version: 3,
    name: 'create-ota-credential',
    apply(database) {
      database.exec(`
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
      `);
    },
  },
  {
    version: 4,
    name: 'add-ota-credential-channel-account-id',
    apply(database) {
      database.exec(`
        ALTER TABLE ota_credential ADD COLUMN channel_account_id TEXT;
        CREATE INDEX ota_credential_channel_account_idx
          ON ota_credential(channel, channel_account_id);
      `);
    },
  },
  {
    version: 5,
    name: 'create-ota-hotel-prob',
    apply(database) {
      database.exec(`
        CREATE TABLE ota_hotel_prob (
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

        CREATE UNIQUE INDEX ota_hotel_prob_channel_hotel_idx ON ota_hotel_prob(channel, ota_hotel_id);
        CREATE INDEX ota_hotel_prob_credential_idx ON ota_hotel_prob(credential_id);
      `);
    },
  },
  {
    version: 6,
    name: 'rename-ota-hotel-prob-to-ota-hotel',
    apply(database) {
      database.exec(`
        DROP TABLE ota_hotel_prob;

        CREATE TABLE ota_hotel (
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

        CREATE UNIQUE INDEX ota_hotel_channel_hotel_idx ON ota_hotel(channel, ota_hotel_id);
        CREATE INDEX ota_hotel_credential_idx ON ota_hotel(credential_id);
      `);
    },
  },
  {
    version: 7,
    name: 'ota-hotel-stores-hotel-info-only',
    apply(database) {
      // `discovered_at` 是「探测即写库」的产物。写入时机后移到用户确认之后，
      // 探测不再落库，该列不再有意义——留着会让人以为探测仍在写库。既有记录
      // 都是探测自动写入、无用户确认背书的，一并丢弃（沿用 migration 6 的
      // drop-and-recreate 做法）。绑定关系由远端持有，本地不新增相关字段。
      database.exec(`
        DROP TABLE ota_hotel;

        CREATE TABLE ota_hotel (
          id TEXT PRIMARY KEY,
          credential_id TEXT NOT NULL REFERENCES ota_credential(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          channel TEXT NOT NULL,
          ota_hotel_id TEXT NOT NULL,
          ota_hotel_name TEXT,
          bind_extra TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX ota_hotel_channel_hotel_idx ON ota_hotel(channel, ota_hotel_id);
        CREATE INDEX ota_hotel_credential_idx ON ota_hotel(credential_id);
      `);
    },
  },
  {
    version: 8,
    name: 'add-ota-credential-channel-account-name',
    apply(database) {
      // 账号名此前只存在 `credential_extra` 里，键随渠道不同（携程 `hotelName`、
      // 抖音 `name`、美团 `login`），每个读取方都得知道这张键表。提到顶层后读取方
      // 只认一个列名，渠道差异收在写入那一侧（见 `channelAccountNameOf`）。
      //
      // 不回填历史数据：`credential_extra` 原样保留，老记录这一列为 NULL，下次该
      // 账号重新探测时自然写上。**读取方必须容忍 NULL。**
      database.exec(`
        ALTER TABLE ota_credential ADD COLUMN channel_account_name TEXT;
      `);
    },
  },
  {
    version: 9,
    name: 'create-ota-inventory-snapshot',
    apply(database) {
      // 渠道价量态的本地基线快照。与 `ota_hotel` / `ota_credential` 的区别：那两张表存的是
      // **本地事实**（用户确认过的绑定、本机的登录态），这张表存的是**渠道事实**——渠道当前
      // 是什么样，由渠道的读接口回答。
      //
      // ⚠️ 空值用 '' 不用 NULL：SQLite 的 UNIQUE 约束里 `NULL != NULL`，可空列参与唯一键
      // 会让同一格每次都 INSERT 新行而不是 upsert（既有 `ota_hotel` 没踩到是因为它的唯一键
      // 两列都非空）。代价是「无此维度」与「空字符串」语义被抹平，用下面的 CHECK 补回
      // 「两个房型 ID 不得同时为空」——同时为空的行无法定位房型，是脏数据。
      //
      // ⚠️ 不加外键：快照是渠道事实，不依赖本地绑定关系。加了外键，未绑定账号的数据就落不了
      // 库，而「还没绑定但已经在看的店」恰恰是要建基线的场景。
      database.exec(`
        CREATE TABLE ota_inventory_snapshot (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          ota_hotel_id TEXT NOT NULL,
          ota_physical_room_id TEXT NOT NULL DEFAULT '',
          ota_sale_room_id TEXT NOT NULL DEFAULT '',
          item_type TEXT NOT NULL CHECK (item_type IN ('roomStatus', 'price')),
          item_date TEXT NOT NULL,
          item_data TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          observed_at INTEGER NOT NULL,
          source_of_truth TEXT NOT NULL CHECK (source_of_truth IN ('readback', 'page-read', 'scan')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK (ota_physical_room_id <> '' OR ota_sale_room_id <> '')
        );

        CREATE UNIQUE INDEX ota_inventory_snapshot_cell_idx ON ota_inventory_snapshot(
          source, ota_hotel_id, ota_sale_room_id, ota_physical_room_id, item_type, item_date
        );

        -- 定时扫描按 (渠道, 酒店, 日期窗口) 一次读一批基线，见 Change B。
        CREATE INDEX ota_inventory_snapshot_scan_idx ON ota_inventory_snapshot(
          source, ota_hotel_id, item_date
        );
      `);
    },
  },
  {
    version: 10,
    name: 'add-ota-inventory-snapshot-room-name',
    apply(database) {
      // 房型名。此前库里只有房型 ID，排查时没法回答「`1569052072` 是哪个房型」。
      //
      // ## 为什么是**一列**而不是配对两个 ID 各一列
      //
      // 两个房型 ID 列**恒有且仅有一个非空**（四个映射点全是「一个填、另一个写 `''`」，
      // 实测 2133 行无一例外）：
      //
      //   携程 roomStatus/price   sale=roomTypeID   physical=''
      //   美团 roomStatus         sale=''           physical=roomId
      //   美团 price              sale=''           physical=goodsId
      //
      // 配两列的话每行必有一列是 NULL，纯浪费。一列 `room_name` 指的就是「这一格
      // 那个非空 ID 的名字」，语义完整无歧义。
      //
      // ⚠️ **不参与比对**：`content_hash` 只取价量态事实字段，房型名改了不构成
      // 价量态变更。写进指纹会让全部既有基线失效，下一轮扫描把整个窗口判成变更。
      //
      // ⚠️ **不进唯一键**：格子的身份仍是 (source, 酒店, 两个房型 ID, 类型, 日期)。
      // 名字只是个标注，渠道改名不该产生一行新记录。
      //
      // 不回填历史数据：老记录这一列为 NULL，下次扫描到该格时自然写上。
      // **读取方必须容忍 NULL。**
      database.exec(`
        ALTER TABLE ota_inventory_snapshot ADD COLUMN room_name TEXT;
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
      error: safeLogErrorDetails(error),
    });
    database.close();
    throw error;
  }
}
