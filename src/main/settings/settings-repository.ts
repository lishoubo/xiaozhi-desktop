import { eq } from 'drizzle-orm';
import type { JsonValue } from '../../shared/settings';
import type { AppDatabase } from '../database/connection';
import { appSettings } from '../database/schema';

export type StoredSetting = Readonly<{
  key: string;
  value: JsonValue;
  createdAt: number;
  updatedAt: number;
}>;

function deserializeValue(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}

function mapSetting(row: typeof appSettings.$inferSelect): StoredSetting {
  return {
    ...row,
    value: deserializeValue(row.value),
  };
}

export class SettingsRepository {
  public constructor(private readonly db: AppDatabase) {}

  public list(): StoredSetting[] {
    return this.db.query.appSettings
      .findMany({
        orderBy: (settings, { asc }) => [asc(settings.key)],
      })
      .sync()
      .map(mapSetting);
  }

  public get(key: string): StoredSetting | null {
    const row = this.db.query.appSettings
      .findFirst({
        where: (settings, { eq }) => eq(settings.key, key),
      })
      .sync();

    return row ? mapSetting(row) : null;
  }

  public set(key: string, value: JsonValue, now = Date.now()): StoredSetting {
    const serializedValue = JSON.stringify(value);
    const row = this.db
      .insert(appSettings)
      .values({
        key,
        value: serializedValue,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: serializedValue,
          updatedAt: now,
        },
      })
      .returning()
      .get();

    return mapSetting(row);
  }

  public delete(key: string): boolean {
    return (
      this.db
        .delete(appSettings)
        .where(eq(appSettings.key, key))
        .returning({ key: appSettings.key })
        .get() !== undefined
    );
  }
}
