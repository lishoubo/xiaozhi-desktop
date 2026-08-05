/**
 * 按渠道存取导入的 cookie —— `<userData>/cookie-imports/<channel>/`。
 *
 * 同渠道再次导入直接覆盖（design.md 决策 1）。不提供删除或清理能力：
 * 这是这次导入结果在"去登录"发生前的暂存区，登录标签页关闭后触发的账号
 * 探测才是这份数据真正被消费的地方，导入文件本身不需要生命周期管理。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CookiesSetDetails } from 'electron';
import { parseChannelId, type ChannelId } from '../../domain/identity';
import type { BrowserCookieSourceId } from '../../shared/browser';

const COOKIE_IMPORTS_DIRNAME = 'cookie-imports';

export type CookieImportManifest = Readonly<{
  importedAt: string;
  sourceId: BrowserCookieSourceId;
}>;

export type ImportedChannelCookies = Readonly<{
  manifest: CookieImportManifest;
  cookies: readonly CookiesSetDetails[];
}>;

function channelDirectory(userDataDir: string, channel: ChannelId): string {
  return path.join(userDataDir, COOKIE_IMPORTS_DIRNAME, channel);
}

export async function writeImportedCookies(
  userDataDir: string,
  channel: ChannelId,
  cookies: readonly CookiesSetDetails[],
  manifest: CookieImportManifest,
): Promise<void> {
  const directory = channelDirectory(userDataDir, channel);
  await fs.mkdir(directory, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(directory, 'cookies.json'), JSON.stringify(cookies), 'utf8'),
    fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest), 'utf8'),
  ]);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** 渠道未导入过时返回 null，不抛错——调用方按"待登录确认"以外的状态处理。 */
export async function readImportedCookies(
  userDataDir: string,
  channel: ChannelId,
): Promise<ImportedChannelCookies | null> {
  const directory = channelDirectory(userDataDir, channel);
  const [cookies, manifest] = await Promise.all([
    readJsonFile<CookiesSetDetails[]>(path.join(directory, 'cookies.json')),
    readJsonFile<CookieImportManifest>(path.join(directory, 'manifest.json')),
  ]);
  if (!cookies || !manifest) return null;
  return { manifest, cookies };
}

export type ImportedChannelSummary = Readonly<{
  channel: ChannelId;
  importedAt: string;
}>;

/** 供设置页"已登录 Cookie 列表"展示所有已导入渠道（add-account-flow-per-channel/design.md §10.3）。 */
export async function listImportedChannels(
  userDataDir: string,
): Promise<readonly ImportedChannelSummary[]> {
  const root = path.join(userDataDir, COOKIE_IMPORTS_DIRNAME);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }

  const summaries = await Promise.all(
    entries.map(async (entry): Promise<ImportedChannelSummary | null> => {
      const channel = parseChannelId(entry);
      if (!channel) return null;
      const manifest = await readJsonFile<CookieImportManifest>(
        path.join(root, entry, 'manifest.json'),
      );
      return manifest ? { channel, importedAt: manifest.importedAt } : null;
    }),
  );
  return summaries.filter((summary): summary is ImportedChannelSummary => summary !== null);
}
