import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BrowserCookieImporter,
  parseSafariCookieStore,
} from '../../../src/main/browser/browser-cookie-importer';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-butler-cookie-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('BrowserCookieImporter', () => {
  it('keeps Safari available on macOS when its cookie store cannot be accessed yet', async () => {
    const home = temporaryDirectory();

    await expect(new BrowserCookieImporter(home, 'darwin', {}).listSources()).resolves.toEqual([
      { id: 'safari', name: 'Safari' },
    ]);
  });

  it('detects Safari and installed browsers on macOS', async () => {
    const home = temporaryDirectory();
    touch(path.join(home, 'Library', 'Cookies', 'Cookies.binarycookies'));
    touch(
      path.join(
        home,
        'Library',
        'Application Support',
        'Google',
        'Chrome',
        'Default',
        'Network',
        'Cookies',
      ),
    );
    touch(
      path.join(
        home,
        'Library',
        'Application Support',
        'Firefox',
        'Profiles',
        'default-release',
        'cookies.sqlite',
      ),
    );

    await expect(new BrowserCookieImporter(home, 'darwin', {}).listSources()).resolves.toEqual([
      { id: 'safari', name: 'Safari' },
      { id: 'chrome', name: 'Google Chrome' },
      { id: 'firefox', name: 'Mozilla Firefox' },
    ]);
  });

  it('detects the system Edge profile on Windows', async () => {
    const root = temporaryDirectory();
    const localAppData = path.join(root, 'AppData', 'Local');
    touch(
      path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Network', 'Cookies'),
    );

    await expect(
      new BrowserCookieImporter(root, 'win32', { LOCALAPPDATA: localAppData }).listSources(),
    ).resolves.toEqual([{ id: 'edge', name: 'Microsoft Edge' }]);
  });

  it('reads only supported domains from a Firefox profile', async () => {
    const home = temporaryDirectory();
    const databasePath = path.join(home, '.mozilla', 'firefox', 'default', 'cookies.sqlite');
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE moz_cookies (
        host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER,
        isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER
      );
      INSERT INTO moz_cookies VALUES
        ('.meituan.com', 'session', 'token', '/', 1900000000, 1, 1, 1),
        ('.unrelated.example', 'private', 'ignored', '/', 1900000000, 1, 1, 1);
    `);
    database.close();

    await expect(
      new BrowserCookieImporter(home, 'linux', {}).readCookies('firefox'),
    ).resolves.toEqual({
      failed: 0,
      cookies: [
        {
          domain: '.meituan.com',
          expirationDate: 1_900_000_000,
          httpOnly: true,
          name: 'session',
          path: '/',
          sameSite: 'lax',
          secure: true,
          url: 'https://meituan.com/',
          value: 'token',
        },
      ],
    });
  });

  it('reports Windows app-bound encryption instead of attempting to bypass it', async () => {
    const root = temporaryDirectory();
    const localAppData = path.join(root, 'AppData', 'Local');
    const databasePath = path.join(
      localAppData,
      'Microsoft',
      'Edge',
      'User Data',
      'Default',
      'Network',
      'Cookies',
    );
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE cookies (
        host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,
        expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER
      );
      CREATE TABLE meta (key TEXT, value TEXT);
      INSERT INTO meta VALUES ('version', '24');
    `);
    database
      .prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('.ctrip.com', 'session', '', Buffer.from('v20protected'), '/', 0, 1, 1, 1);
    database.close();

    await expect(
      new BrowserCookieImporter(root, 'win32', {
        LOCALAPPDATA: localAppData,
      }).readCookies('edge'),
    ).rejects.toThrow('Windows 应用绑定加密');
  });
});

describe('parseSafariCookieStore', () => {
  it('reads supported OTA cookies from the Safari binary store', () => {
    const domain = Buffer.from('.ctrip.com\0');
    const name = Buffer.from('session\0');
    const cookiePath = Buffer.from('/\0');
    const value = Buffer.from('token\0');
    const record = Buffer.alloc(
      56 + domain.length + name.length + cookiePath.length + value.length,
    );
    record.writeUInt32LE(record.length, 0);
    record.writeUInt32LE(5, 8);
    record.writeUInt32LE(56, 16);
    record.writeUInt32LE(56 + domain.length, 20);
    record.writeUInt32LE(56 + domain.length + name.length, 24);
    record.writeUInt32LE(56 + domain.length + name.length + cookiePath.length, 28);
    record.writeDoubleLE(721_692_800, 40);
    Buffer.concat([domain, name, cookiePath, value]).copy(record, 56);

    const page = Buffer.alloc(12 + record.length);
    page.writeUInt32LE(1, 4);
    page.writeUInt32LE(12, 8);
    record.copy(page, 12);
    const store = Buffer.alloc(12 + page.length);
    store.write('cook');
    store.writeUInt32BE(1, 4);
    store.writeUInt32BE(page.length, 8);
    page.copy(store, 12);

    expect(parseSafariCookieStore(store)).toEqual([
      {
        domain: '.ctrip.com',
        expirationDate: 1_700_000_000,
        httpOnly: true,
        name: 'session',
        path: '/',
        secure: true,
        url: 'https://ctrip.com/',
        value: 'token',
      },
    ]);
  });
});
