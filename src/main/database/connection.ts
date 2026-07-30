import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseConnection = Readonly<{
  db: AppDatabase;
  close: () => void;
}>;

export function openDatabase(databasePath: string, migrationsFolder: string): DatabaseConnection {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('busy_timeout = 5000');

    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });

    return {
      db,
      close: () => sqlite.close(),
    };
  } catch (error: unknown) {
    sqlite.close();
    throw error;
  }
}
