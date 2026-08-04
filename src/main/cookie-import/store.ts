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
import type { ChannelId } from '../../domain/identity';
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

/** 供"添加账号"面板判断"从cookie创建"是否可用（add-account-flow-per-channel/design.md §5.2）。 */
export async function hasImportedCookies(userDataDir: string, channel: ChannelId): Promise<boolean> {
  return (await readImportedCookies(userDataDir, channel)) !== null;
}

/**
 * 携程"从cookie创建"探测成功建号后调用——一份携程 cookie 只对应一个账号，
 * 消费后删除，使该渠道重新回到"未导入"状态（design.md 决策5）。
 * 目录本不存在时静默忽略。
 */
export async function deleteImportedCookies(userDataDir: string, channel: ChannelId): Promise<void> {
  const directory = channelDirectory(userDataDir, channel);
  await fs.rm(directory, { recursive: true, force: true });
}
