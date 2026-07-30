import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseConnection } from '../../../src/main/database/connection';
import { SettingsRepository } from '../../../src/main/settings/settings-repository';

describe('SettingsRepository', () => {
  let connection: DatabaseConnection;
  let repository: SettingsRepository;

  beforeEach(() => {
    connection = openDatabase(':memory:', path.resolve('drizzle'));
    repository = new SettingsRepository(connection.db);
  });

  afterEach(() => {
    connection.close();
  });

  it('creates, reads, updates, lists and deletes JSON settings', () => {
    const created = repository.set('browser.homepage', { url: 'https://example.com' }, 100);
    const updated = repository.set('browser.homepage', { url: 'https://openai.com' }, 200);

    expect(created).toEqual({
      key: 'browser.homepage',
      value: { url: 'https://example.com' },
      createdAt: 100,
      updatedAt: 100,
    });
    expect(updated.createdAt).toBe(100);
    expect(updated.updatedAt).toBe(200);
    expect(repository.get('browser.homepage')).toEqual(updated);
    expect(repository.list()).toEqual([updated]);
    expect(repository.delete('browser.homepage')).toBe(true);
    expect(repository.delete('browser.homepage')).toBe(false);
    expect(repository.get('browser.homepage')).toBeNull();
  });
});
