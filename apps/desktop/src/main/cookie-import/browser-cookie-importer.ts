import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { CookiesSetDetails } from 'electron';
import { z, type ZodType } from 'zod';
import type { ChannelId } from '../ids';
import type { BrowserCookieSource, BrowserCookieSourceId } from '../../shared/browser';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
import {
  channelForCookieDomain,
  chromiumTimestampToUnix,
  isSupportedCookieDomain,
} from './cookie-import';

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
  id: 'chrome' | 'edge' | 'qq' | '360' | 'sogou';
  name: string;
  roots: readonly string[];
  keychainAccount: string;
  keychainService: string;
}>;

const SOURCE_NAMES: Readonly<Record<BrowserCookieSourceId, string>> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  firefox: 'Mozilla Firefox',
  safari: 'Safari',
  qq: 'QQ 浏览器',
  '360': '360 安全浏览器',
  sogou: '搜狗高速浏览器',
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
  const appData = environment.APPDATA;
  if (platform === 'win32' && localAppData) {
    return [
      {
        id: 'qq',
        name: SOURCE_NAMES.qq,
        roots: [path.join(localAppData, 'Tencent', 'QQBrowser', 'User Data')],
        keychainAccount: '',
        keychainService: '',
      },
      {
        id: '360',
        name: SOURCE_NAMES['360'],
        roots: [
          ...(appData ? [path.join(appData, '360se6', 'User Data')] : []),
          path.join(localAppData, '360Chrome', 'Chrome', 'User Data'),
        ],
        keychainAccount: '',
        keychainService: '',
      },
      {
        id: 'sogou',
        name: SOURCE_NAMES.sogou,
        roots: [
          path.join(localAppData, 'SogouExplorer', 'User Data'),
          ...(appData ? [path.join(appData, 'SogouExplorer', 'Webkit')] : []),
        ],
        keychainAccount: '',
        keychainService: '',
      },
      {
        id: 'edge',
        name: SOURCE_NAMES.edge,
        roots: [path.join(localAppData, 'Microsoft', 'Edge', 'User Data')],
        keychainAccount: '',
        keychainService: '',
      },
      {
        id: 'chrome',
        name: SOURCE_NAMES.chrome,
        roots: [path.join(localAppData, 'Google', 'Chrome', 'User Data')],
        keychainAccount: '',
        keychainService: '',
      },
    ];
  }
  if (platform === 'darwin') {
    return [
      {
        id: 'qq',
        name: SOURCE_NAMES.qq,
        roots: [path.join(homeDirectory, 'Library', 'Application Support', 'QQBrowser')],
        keychainAccount: 'QQBrowser',
        keychainService: 'QQBrowser Safe Storage',
      },
      {
        id: '360',
        name: SOURCE_NAMES['360'],
        roots: [path.join(homeDirectory, 'Library', 'Application Support', '360Chrome')],
        keychainAccount: '360Chrome',
        keychainService: '360Chrome Safe Storage',
      },
      {
        id: 'chrome',
        name: SOURCE_NAMES.chrome,
        roots: [path.join(homeDirectory, 'Library', 'Application Support', 'Google', 'Chrome')],
        keychainAccount: 'Chrome',
        keychainService: 'Chrome Safe Storage',
      },
      {
        id: 'edge',
        name: SOURCE_NAMES.edge,
        roots: [path.join(homeDirectory, 'Library', 'Application Support', 'Microsoft Edge')],
        keychainAccount: 'Microsoft Edge',
        keychainService: 'Microsoft Edge Safe Storage',
      },
    ];
  }
  return [
    {
      id: '360',
      name: SOURCE_NAMES['360'],
      roots: [
        path.join(homeDirectory, '.config', '360browser'),
        path.join(homeDirectory, '.config', '360chrome'),
      ],
      keychainAccount: '',
      keychainService: '',
    },
    {
      id: 'chrome',
      name: SOURCE_NAMES.chrome,
      roots: [path.join(homeDirectory, '.config', 'google-chrome')],
      keychainAccount: '',
      keychainService: '',
    },
    {
      id: 'edge',
      name: SOURCE_NAMES.edge,
      roots: [path.join(homeDirectory, '.config', 'microsoft-edge')],
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

async function findChromiumDefinitionDatabase(
  definition: ChromiumDefinition,
): Promise<string | null> {
  return newestFile(
    (await Promise.all(definition.roots.map((root) => findChromiumDatabase(root)))).filter(
      (databasePath): databasePath is string => databasePath !== null,
    ),
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

/**
 * 同 `runFile`，但把 `input` 写进 stdin，且**失败时把 stderr 并进错误信息**。
 * `execFile` 默认只给 "Command failed: <cmd>"，被调用方真正的报错全在 stderr，
 * 丢掉它等于丢掉唯一的线索。
 */
function runWithInput(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { encoding: 'utf8', windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout.trim());
          return;
        }
        const detail = stderr.trim();
        reject(detail ? new Error(`${error.message.trim()} | stderr: ${detail}`) : error);
      },
    );
    child.stdin?.on('error', reject);
    child.stdin?.end(input);
  });
}

async function chromiumPassword(
  definition: ChromiumDefinition,
  platform: SupportedPlatform,
  databasePath: string,
  environment: NodeJS.ProcessEnv,
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

  const localStatePath = path.join(
    definition.roots.find((root) => {
      const relative = path.relative(root, databasePath);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    }) ?? definition.roots[0],
    'Local State',
  );
  const localState = parseBrowserData(
    chromiumLocalStateSchema,
    JSON.parse(await fs.readFile(localStatePath, 'utf8')),
  );
  const encodedKey = localState.os_crypt.encrypted_key;
  const encryptedKey = Buffer.from(encodedKey, 'base64');
  const dpapiKey = encryptedKey.subarray(Buffer.from('DPAPI').length).toString('base64');
  return unprotectWithDpapi(dpapiKey, environment);
}

/**
 * 解 Windows DPAPI 保护的主密钥。Chromium 用 `CurrentUser` 作用域保护它，
 * 只有同一个 Windows 账户能解开——这也是这条路只能在本机跑的原因。
 *
 * 三个刻意的选择，都是 2026-08-25 真机排查时踩出来的：
 *
 * 1. **走绝对路径而非 `powershell.exe`**。Electron 打包进程继承到的 `PATH`
 *    不保证含 `System32`（安装器、任务计划、部分安全软件都会改），裸名字
 *    解析失败报的是 `spawn powershell.exe ENOENT`，与「读不到 cookie」看着
 *    毫无关系。用 `%SystemRoot%` 拼出绝对路径，少一层不确定性。
 * 2. **密钥走 stdin 而非命令行参数**。base64 主密钥有数百字符，作为
 *    `$args[0]` 拼进命令行会撞上长度限制与引号转义，且会出现在进程命令行里
 *    （任务管理器可见）。stdin 两个问题都没有。
 * 3. **失败时带上 stderr**。`execFile` 的默认错误只有 "Command failed"，
 *    PowerShell 真正的话都在 stderr 里。
 */
async function unprotectWithDpapi(
  dpapiKey: string,
  environment: NodeJS.ProcessEnv,
): Promise<Buffer> {
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT ?? String.raw`C:\Windows`;
  const powershellPath = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  // 从 stdin 读一行 base64，解保护后再以 base64 写回 stdout。
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '$encoded = [Console]::In.ReadToEnd().Trim()',
    '$protected = [Convert]::FromBase64String($encoded)',
    '$plain = [Security.Cryptography.ProtectedData]::Unprotect(' +
      '$protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($plain))',
  ].join('; ');

  const executable = (await exists(powershellPath)) ? powershellPath : 'powershell.exe';
  const stdout = await runWithInput(
    executable,
    ['-NoProfile', '-NonInteractive', '-Command', script],
    `${dpapiKey}\n`,
  );
  const key = Buffer.from(stdout, 'base64');
  // DPAPI 解出的 Chromium 主密钥固定 32 字节；长度不对说明 stdout 里混进了别的
  // 东西（PowerShell 横幅、profile 输出），继续往下走只会在 AES 那步报一个更
  // 难懂的错。
  if (key.length !== 32) {
    throw new Error(
      `DPAPI 解密返回了 ${key.length} 字节的密钥（期望 32 字节），` +
        `PowerShell 输出可能混入了额外内容`,
    );
  }
  return key;
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

/** cookie 值的加密前缀，`plain` 表示该行本来就是明文。 */
function encryptionPrefix(row: z.infer<typeof chromiumRowSchema>): string {
  if (row.value) return 'plain';
  if (row.encrypted_value.length === 0) return 'empty';
  return row.encrypted_value.subarray(0, 3).toString('ascii');
}

async function readChromiumCookies(
  databasePath: string,
  definition: ChromiumDefinition,
  platform: SupportedPlatform,
  environment: NodeJS.ProcessEnv,
  logger: AppLogger,
): Promise<{ cookies: CookiesSetDetails[]; failed: number }> {
  const { rows, version } = await withDatabaseCopy(databasePath, readChromiumRows);
  const relevantRows = rows.filter((row) => isSupportedCookieDomain(row.host_key));

  /**
   * 加密格式分布是排查这条链路的第一手材料：它一次性回答「库里有没有我们要的
   * cookie」「是不是全被应用绑定加密挡住了」「要不要动用 DPAPI」三个问题。
   * 只统计前缀与条数，不含任何 cookie 值。
   */
  const prefixCounts: Record<string, number> = {};
  for (const row of relevantRows) {
    const prefix = encryptionPrefix(row);
    prefixCounts[prefix] = (prefixCounts[prefix] ?? 0) + 1;
  }
  logger.info('Chromium cookie database inspected', {
    source: definition.id,
    databasePath,
    schemaVersion: version,
    totalRows: rows.length,
    relevantRows: relevantRows.length,
    encryptionPrefixes: prefixCounts,
  });

  const appBoundRows = relevantRows.filter((row) => encryptionPrefix(row) === 'v20').length;
  if (appBoundRows > 0 && appBoundRows === relevantRows.length) {
    throw new Error(
      `${definition.name} 已启用 Windows 应用绑定加密，系统不允许其他应用直接读取 Cookie`,
    );
  }

  const needsDecryption = relevantRows.some((row) => !row.value && row.encrypted_value.length > 0);
  const key = needsDecryption
    ? await chromiumPassword(definition, platform, databasePath, environment)
    : null;
  const cookies: CookiesSetDetails[] = [];
  let failed = 0;
  /** 逐行失败的原因分布——同样只记原因，不记 cookie 名与值。 */
  const failureReasons: Record<string, number> = {};
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
    } catch (error: unknown) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    }
  }

  /**
   * 部分行解不开时给出明确结论，而不是静默计入 `failed`。最常见的情形是
   * Chrome/Edge 127+ 的**新旧混合库**：老 cookie 还是 v10，新写入的是 v20，
   * 于是 `appBoundRows === relevantRows.length` 不成立，走不到上面那条提示，
   * 用户只会看到「导入了 N 个」却依然登录不上——真正需要的那几条恰恰在 v20 里。
   */
  if (failed > 0) {
    logger.warn('Some Chromium cookies could not be decrypted', {
      source: definition.id,
      decrypted: cookies.length,
      failed,
      appBoundRows,
      failureReasons,
    });
  }
  if (cookies.length === 0 && failed > 0 && appBoundRows > 0) {
    throw new Error(
      `${definition.name} 已启用 Windows 应用绑定加密，系统不允许其他应用直接读取 Cookie`,
    );
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
      if (await findChromiumDefinitionDatabase(definition)) available.push(source(definition.id));
    }
    if (
      await findFirefoxDatabase(firefoxRoot(this.homeDirectory, this.platform, this.environment))
    ) {
      available.push(source('firefox'));
    }
    return available;
  }

  /**
   * 一次性读取该来源里所有受支持渠道的 cookie，按渠道拆分返回——调用方
   * 不需要（也不能）预先指定渠道，见 design.md 决策 1。
   */
  async readCookies(
    sourceId: BrowserCookieSourceId,
  ): Promise<{ cookiesByChannel: Map<ChannelId, CookiesSetDetails[]>; failed: number }> {
    this.logger.info('Cookie extraction started', { source: sourceId });
    try {
      const { cookies, failed } = await this.readCookiesFromSource(sourceId);
      const cookiesByChannel = new Map<ChannelId, CookiesSetDetails[]>();
      for (const cookie of cookies) {
        const channel = cookie.domain ? channelForCookieDomain(cookie.domain) : null;
        if (!channel) continue;
        const bucket = cookiesByChannel.get(channel);
        if (bucket) bucket.push(cookie);
        else cookiesByChannel.set(channel, [cookie]);
      }
      this.logger.info('Cookie extraction completed', {
        source: sourceId,
        channels: cookiesByChannel.size,
        extracted: cookies.length,
        failed,
      });
      return { cookiesByChannel, failed };
    } catch (error: unknown) {
      // 只记 errorName 等于什么都没说：这条路径抛的几乎全是裸 `new Error(...)`，
      // name 恒为 'Error'。用 safeLogErrorDetails 一并落 message 与 stack，它自带
      // 脱敏，不会把 cookie 值写进日志。
      this.logger.error('Cookie extraction failed', {
        source: sourceId,
        platform: this.platform,
        error: safeLogErrorDetails(error),
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
    const databasePath = await findChromiumDefinitionDatabase(definition);
    if (!databasePath) throw new Error(`未找到 ${definition.name} Cookie 数据`);
    return readChromiumCookies(
      databasePath,
      definition,
      this.platform,
      this.environment,
      this.logger,
    );
  }
}
