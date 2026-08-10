/**
 * 记录"新建了 partition、但还没被任何 OtaCredential 认领"的登录态——
 * `<userData>/pending-partitions.json`。
 *
 * 为什么不写进 partition 自己的磁盘目录：那是 Electron/Chromium 管理的
 * 黑盒（Cookies/LevelDB/IndexedDB 等，带文件锁与内部清理逻辑），官方连
 * "删除一个 partition"的 API 都没提供，目录结构不是承诺契约，手动塞文件
 * 进去属于依赖未公开的实现细节。见 docs/arch/2026-08-03-login-tab-flows.md。
 *
 * 通用性：这份记录不专属 cookie 导入流程——任何一次 `sessionForLogin`
 * 新建 partition（不管背后是"导入 cookie 后去登录"还是以后可能加的
 * "直接打开渠道浏览器手动登录"）都会产生同样的"待认领"状态，所以单独
 * 存一份索引，不挂在 cookie-import 的 manifest 里。
 *
 * 探测成功（无论新建账号还是查重更新）后，调用方必须调 `removePendingPartition`
 * 摘除对应条目——这是这份记录被消费掉的唯一方式。
 *
 * 为什么不进 `main/database/`：那里是 SQLite（`ApplicationDatabase`），这里
 * 是纯 JSON 文件，介质不同，硬塞进同一目录会让"database"这个名字失真。
 * `main/file-store/` 与 `main/database/` 平级，都是持久化实现，只是介质
 * 不同——以后如果还有别的"不进数据库、直接写文件"的进程级状态，归这里。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelId } from '../ids';

const PENDING_PARTITIONS_FILENAME = 'pending-partitions.json';

export type PendingPartition = Readonly<{
  partitionName: string;
  channel: ChannelId;
  environment: 'prod' | 'dev';
  createdAt: string;
}>;

function filePath(userDataDir: string): string {
  return path.join(userDataDir, PENDING_PARTITIONS_FILENAME);
}

async function readAll(userDataDir: string): Promise<PendingPartition[]> {
  try {
    return JSON.parse(await fs.readFile(filePath(userDataDir), 'utf8')) as PendingPartition[];
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAll(userDataDir: string, entries: readonly PendingPartition[]): Promise<void> {
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(filePath(userDataDir), JSON.stringify(entries), 'utf8');
}

/**
 * 用户可能连续点多个渠道的"去登录"，读-改-写必须序列化，否则并发写入会
 * 互相覆盖丢条目。整个 main 进程只有一份 pending-partitions.json，用一个
 * 模块级的 promise 链承担互斥锁的角色即可，不需要引入文件锁库。
 */
let mutex: Promise<unknown> = Promise.resolve();

function withMutex<T>(task: () => Promise<T>): Promise<T> {
  const next = mutex.then(task, task);
  mutex = next.catch(() => {});
  return next;
}

export function addPendingPartition(userDataDir: string, entry: PendingPartition): Promise<void> {
  return withMutex(async () => {
    const entries = await readAll(userDataDir);
    await writeAll(userDataDir, [...entries, entry]);
  });
}

export function removePendingPartition(userDataDir: string, partitionName: string): Promise<void> {
  return withMutex(async () => {
    const entries = await readAll(userDataDir);
    await writeAll(
      userDataDir,
      entries.filter((entry) => entry.partitionName !== partitionName),
    );
  });
}

export function listPendingPartitions(userDataDir: string): Promise<readonly PendingPartition[]> {
  return withMutex(() => readAll(userDataDir));
}
