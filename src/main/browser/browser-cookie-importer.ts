import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { CookiesSetDetails } from 'electron';
import { z, type ZodType } from 'zod';
import type { BrowserCookieSource, BrowserCookieSourceId } from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';
import { chromiumTimestampToUnix, isSupportedCookieDomain } from './cookie-import';

type SupportedPlatform = NodeJS.Platform;

const chromiumRowSchema = z.strictObject({
  host_key: z.string(),
  name: z.string(),
  value: z.string(),
  encrypted_value: z.instanceof(Buffer),
  path: z.string(),
  expires_utc: z.number(),
  is_secure: z.number(),
  is_httponly: z.number(),
  samesite: z.number(),
});

const firefoxRowSchema = z.strictObject({
  host: z.string(),
  name: z.string(),
  value: z.string(),
  path: z.string(),
  expiry: z.number(),
  isSecure: z.number(),
  isHttpOnly: z.number(),
  sameSite: z.number(),
});

const chromiumLocalStateSchema = z.object({
  os_crypt: z.object({ encrypted_key: z.string() }),
});

function parseBrowserData<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('浏览器 Cookie 数据格式无效');
  return result.data;
}

type ChromiumDefinition = Readonly<{
  id: 'chrome' | 'edge';
  name: string;
  root: string;
  keychainAccount: string;
  keychainService: string;
}>;

const SOURCE_NAMES: Readonly<Record<BrowserCookieSourceId, string>> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  safari: 'Safari',
};

function source(id: BrowserCookieSourceId): BrowserCookieSource {
  return { id, name: SOURCE_NAMES[id] };
}

function chromiumDefinitions(
  homeDirectory: string,
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv,
): ChromiumDefinition[] {
  const localAppData = environment.LOCALAPPDATA;
  if (platform === 'win32' && localAppData) {
    return [
      {
        id: 'edge',
        name: SOURCE_NAMES.edge,
        root: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
        keychainAccount: '',
        keychainService: '',
      },
      {
        id: 'chrome',
        name: SOURCE_NAMES.chrome,
        root: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
        keychainAccount: '',
        keychainService: '',
      },
    ];
  }
  if (platform === 'darwin') {
    return [
      {
        id: 'chrome',
        name: SOURCE_NAMES.chrome,
        root: path.join(homeDirectory, 'Library', 'Application Support', 'Google', 'Chrome'),
        keychainAccount: 'Chrome',
        keychainService: 'Chrome Safe Storage',
      },
      {
        id: 'edge',
        name: SOURCE_NAMES.edge,
        root: path.join(homeDirectory, 'Library', 'Application Support', 'Microsoft Edge'),
        keychainAccount: 'Microsoft Edge',
        keychainService: 'Microsoft Edge Safe Storage',
      },
    ];
  }
  return [
    {
      id: 'chrome',
      name: SOURCE_NAMES.chrome,
      root: path.join(homeDirectory, '.config', 'google-chrome'),
      keychainAccount: '',
      keychainService: '',
    },
    {
      id: 'edge',
      name: SOURCE_NAMES.edge,
      root: path.join(homeDirectory, '.config', 'microsoft-edge'),
      keychainAccount: '',
      keychainService: '',
    },
  ];
}

function firefoxRoot(
  homeDirectory: string,
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv,
): string | null {
  if (platform === 'win32') {
    return environment.APPDATA
      ? path.join(environment.APPDATA, 'Mozilla', 'Firefox', 'Profiles')
      : null;
  }
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'Firefox', 'Profiles');
  }
  return path.join(homeDirectory, '.mozilla', 'firefox');
}

function safariPaths(homeDirectory: string): string[] {
  return [
    path.join(homeDirectory, 'Library', 'Cookies', 'Cookies.binarycookies'),
    path.join(
      homeDirectory,
      'Library',
      'Containers',
      'com.apple.Safari',
      'Data',
      'Library',
      'Cookies',
      'Cookies.binarycookies',
    ),
  ];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function newestFile(filePaths: string[]): Promise<string | null> {
  const existing = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        return { filePath, modified: (await fs.stat(filePath)).mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  return (
    existing
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((left, right) => right.modified - left.modified)[0]?.filePath ?? null
  );
}

async function childDirectories(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

async function findChromiumDatabase(root: string): Promise<string | null> {
  const profileDirectories = await childDirectories(root);
  return newestFile(
    profileDirectories
      .filter((directory) => /^(?:Default|Profile \d+)$/.test(path.basename(directory)))
      .flatMap((directory) => [
        path.join(directory, 'Network', 'Cookies'),
        path.join(directory, 'Cookies'),
      ]),
  );
}

async function findFirefoxDatabase(root: string | null): Promise<string | null> {
  if (!root) return null;
  return newestFile(
    (await childDirectories(root)).map((directory) => path.join(directory, 'cookies.sqlite')),
  );
}

async function withDatabaseCopy<T>(
  databasePath: string,
  read: (database: Database.Database) => T,
): Promise<T> {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'hotel-butler-cookie-import-'),
  );
  const copyPath = path.join(temporaryDirectory, 'Cookies');
  try {
    await fs.copyFile(databasePath, copyPath);
    for (const suffix of ['-wal', '-shm']) {
      const sourcePath = `${databasePath}${suffix}`;
      if (await exists(sourcePath)) await fs.copyFile(sourcePath, `${copyPath}${suffix}`);
    }
    const database = new Database(copyPath, { fileMustExist: true, readonly: true });
    try {
      return read(database);
    } finally {
      database.close();
    }
  } finally {
    await fs.rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function runFile(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

async function chromiumPassword(
  definition: ChromiumDefinition,
  platform: SupportedPlatform,
): Promise<Buffer> {
  if (platform === 'darwin') {
    const password = await runFile('/usr/bin/security', [
      'find-generic-password',
      '-w',
      '-s',
      definition.keychainService,
      '-a',
      definition.keychainAccount,
    ]);
    return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  }
  if (platform === 'linux') {
    return crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
  }

  const localState = parseBrowserData(
    chromiumLocalStateSchema,
    JSON.parse(await fs.readFile(path.join(definition.root, 'Local State'), 'utf8')),
  );
  const encodedKey = localState.os_crypt.encrypted_key;
  const encryptedKey = Buffer.from(encodedKey, 'base64');
  const dpapiKey = encryptedKey.subarray(Buffer.from('DPAPI').length).toString('base64');
  const script =
    '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($args[0]),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
  return Buffer.from(
    await runFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
      dpapiKey,
    ]),
    'base64',
  );
}

function decryptChromiumCookie(
  encryptedValue: Buffer,
  key: Buffer,
  platform: SupportedPlatform,
): Buffer {
  const prefix = encryptedValue.subarray(0, 3).toString('ascii');
  if (prefix === 'v20') throw new Error('浏览器使用了不支持跨应用读取的新加密格式');
  if (platform === 'win32') {
    if (prefix !== 'v10' && prefix !== 'v11') throw new Error('Cookie 加密格式不受支持');
    const nonce = encryptedValue.subarray(3, 15);
    const ciphertext = encryptedValue.subarray(15, -16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(encryptedValue.subarray(-16));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  return Buffer.concat([decipher.update(encryptedValue.subarray(3)), decipher.final()]);
}

function chromiumSameSite(value: number): CookiesSetDetails['sameSite'] {
  if (value === 0) return 'no_restriction';
  if (value === 1) return 'lax';
  if (value === 2) return 'strict';
  return 'unspecified';
}

function cookieDetails(input: {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite?: CookiesSetDetails['sameSite'];
}): CookiesSetDetails {
  return {
    url: `${input.secure ? 'https' : 'http'}://${input.domain.replace(/^\./, '')}${input.path}`,
    name: input.name,
    value: input.value,
    domain: input.domain,
    path: input.path,
    secure: input.secure,
    httpOnly: input.httpOnly,
    ...(input.expirationDate === undefined ? {} : { expirationDate: input.expirationDate }),
    ...(input.sameSite === undefined ? {} : { sameSite: input.sameSite }),
  };
}

function readChromiumRows(database: Database.Database): {
  rows: z.infer<typeof chromiumRowSchema>[];
  version: number;
} {
  const rows = parseBrowserData(
    z.array(chromiumRowSchema),
    database
      .prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc,
              is_secure, is_httponly, samesite
         FROM cookies`,
      )
      .all(),
  );
  const versionRow = parseBrowserData(
    z.strictObject({ value: z.string() }).optional(),
    database.prepare("SELECT value FROM meta WHERE key = 'version'").get(),
  );
  return { rows, version: Number(versionRow?.value ?? 0) };
}

async function readChromiumCookies(
  databasePath: string,
  definition: ChromiumDefinition,
  platform: SupportedPlatform,
): Promise<{ cookies: CookiesSetDetails[]; failed: number }> {
  const { rows, version } = await withDatabaseCopy(databasePath, readChromiumRows);
  const relevantRows = rows.filter((row) => isSupportedCookieDomain(row.host_key));
  const onlyAppBoundValues =
    relevantRows.length > 0 &&
    relevantRows.every(
      (row) => !row.value && row.encrypted_value.subarray(0, 3).toString('ascii') === 'v20',
    );
  if (onlyAppBoundValues) {
    throw new Error(
      `${definition.name} 已启用 Windows 应用绑定加密，系统不允许其他应用直接读取 Cookie`,
    );
  }
  const needsDecryption = relevantRows.some((row) => !row.value && row.encrypted_value.length > 0);
  const key = needsDecryption ? await chromiumPassword(definition, platform) : null;
  const cookies: CookiesSetDetails[] = [];
  let failed = 0;
  for (const row of relevantRows) {
    try {
      let value = row.value;
      if (!value && row.encrypted_value.length > 0) {
        if (!key) throw new Error('浏览器 Cookie 加密密钥不可用');
        const decrypted = decryptChromiumCookie(row.encrypted_value, key, platform);
        value = decrypted.subarray(version >= 24 ? 32 : 0).toString('utf8');
      }
      cookies.push(
        cookieDetails({
          domain: row.host_key,
          name: row.name,
          value,
          path: row.path || '/',
          secure: Boolean(row.is_secure),
          httpOnly: Boolean(row.is_httponly),
          expirationDate: chromiumTimestampToUnix(row.expires_utc),
          sameSite: chromiumSameSite(row.samesite),
        }),
      );
    } catch {
      failed += 1;
    }
  }
  return { cookies, failed };
}

async function readFirefoxCookies(databasePath: string): Promise<CookiesSetDetails[]> {
  const rows = await withDatabaseCopy(databasePath, (database) =>
    parseBrowserData(
      z.array(firefoxRowSchema),
      database
        .prepare(
          `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
             FROM moz_cookies`,
        )
        .all(),
    ),
  );
  return rows
    .filter((row) => isSupportedCookieDomain(row.host))
    .map((row) =>
      cookieDetails({
        domain: row.host,
        name: row.name,
        value: row.value,
        path: row.path || '/',
        secure: Boolean(row.isSecure),
        httpOnly: Boolean(row.isHttpOnly),
        expirationDate: row.expiry > 0 ? row.expiry : undefined,
        sameSite: chromiumSameSite(row.sameSite),
      }),
    );
}

function nullTerminatedString(buffer: Buffer, offset: number): string {
  if (offset < 0 || offset >= buffer.length) return '';
  const end = buffer.indexOf(0, offset);
  return buffer.subarray(offset, end === -1 ? buffer.length : end).toString('utf8');
}

function readSafariCookie(record: Buffer): CookiesSetDetails | null {
  if (record.length < 56) return null;
  const flags = record.readUInt32LE(8);
  const domain = nullTerminatedString(record, record.readUInt32LE(16));
  const name = nullTerminatedString(record, record.readUInt32LE(20));
  const cookiePath = nullTerminatedString(record, record.readUInt32LE(24)) || '/';
  const value = nullTerminatedString(record, record.readUInt32LE(28));
  if (!domain || !name || !isSupportedCookieDomain(domain)) return null;
  const expires = record.readDoubleLE(40) + 978_307_200;
  return cookieDetails({
    domain,
    name,
    value,
    path: cookiePath,
    secure: Boolean(flags & 1),
    httpOnly: Boolean(flags & 4),
    expirationDate: expires > 978_307_200 ? expires : undefined,
  });
}

export function parseSafariCookieStore(buffer: Buffer): CookiesSetDetails[] {
  if (buffer.subarray(0, 4).toString('ascii') !== 'cook' || buffer.length < 8) {
    throw new Error('Safari Cookie 数据格式无效');
  }
  const pageCount = buffer.readUInt32BE(4);
  if (pageCount > Math.floor((buffer.length - 8) / 4)) {
    throw new Error('Safari Cookie 数据格式无效');
  }
  const pageSizes = Array.from({ length: pageCount }, (_, index) =>
    buffer.readUInt32BE(8 + index * 4),
  );
  let pageOffset = 8 + pageCount * 4;
  const cookies: CookiesSetDetails[] = [];
  for (const pageSize of pageSizes) {
    const page = buffer.subarray(pageOffset, pageOffset + pageSize);
    pageOffset += pageSize;
    if (page.length < 8) continue;
    const cookieCount = page.readUInt32LE(4);
    if (cookieCount > Math.floor((page.length - 8) / 4)) continue;
    for (let index = 0; index < cookieCount; index += 1) {
      const offset = page.readUInt32LE(8 + index * 4);
      if (offset + 4 > page.length) continue;
      const size = page.readUInt32LE(offset);
      if (size < 56 || offset + size > page.length) continue;
      const cookie = readSafariCookie(page.subarray(offset, offset + size));
      if (cookie) cookies.push(cookie);
    }
  }
  return cookies;
}

export class BrowserCookieImporter {
  constructor(
    private readonly logger: AppLogger,
    private readonly homeDirectory = os.homedir(),
    private readonly platform: SupportedPlatform = process.platform,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async listSources(): Promise<BrowserCookieSource[]> {
    const available: BrowserCookieSource[] = [];
    if (this.platform === 'darwin') available.push(source('safari'));
    for (const definition of chromiumDefinitions(
      this.homeDirectory,
      this.platform,
      this.environment,
    )) {
      if (await findChromiumDatabase(definition.root)) available.push(source(definition.id));
    }
    if (
      await findFirefoxDatabase(firefoxRoot(this.homeDirectory, this.platform, this.environment))
    ) {
      available.push(source('firefox'));
    }
    return available;
  }

  async readCookies(
    sourceId: BrowserCookieSourceId,
  ): Promise<{ cookies: CookiesSetDetails[]; failed: number }> {
    this.logger.info('Cookie extraction started', { source: sourceId });
    try {
      const result = await this.readCookiesFromSource(sourceId);
      this.logger.info('Cookie extraction completed', {
        source: sourceId,
        extracted: result.cookies.length,
        failed: result.failed,
      });
      return result;
    } catch (error: unknown) {
      this.logger.error('Cookie extraction failed', {
        source: sourceId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  private async readCookiesFromSource(
    sourceId: BrowserCookieSourceId,
  ): Promise<{ cookies: CookiesSetDetails[]; failed: number }> {
    if (sourceId === 'safari') {
      if (this.platform !== 'darwin') throw new Error('当前系统不支持 Safari');
      const databasePath = await newestFile(safariPaths(this.homeDirectory));
      if (!databasePath) throw new Error('未找到 Safari Cookie 数据');
      return { cookies: parseSafariCookieStore(await fs.readFile(databasePath)), failed: 0 };
    }
    if (sourceId === 'firefox') {
      const databasePath = await findFirefoxDatabase(
        firefoxRoot(this.homeDirectory, this.platform, this.environment),
      );
      if (!databasePath) throw new Error('未找到 Mozilla Firefox Cookie 数据');
      return { cookies: await readFirefoxCookies(databasePath), failed: 0 };
    }
    const definition = chromiumDefinitions(
      this.homeDirectory,
      this.platform,
      this.environment,
    ).find((item) => item.id === sourceId);
    if (!definition) throw new Error('当前系统不支持所选浏览器');
    const databasePath = await findChromiumDatabase(definition.root);
    if (!databasePath) throw new Error(`未找到 ${definition.name} Cookie 数据`);
    return readChromiumCookies(databasePath, definition, this.platform);
  }
}
