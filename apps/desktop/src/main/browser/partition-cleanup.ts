/**
 * 启动时的 partition 清理 —— 把账本里 `retired` 的登录态存储清空。
 *
 * ## 为什么在启动时做
 *
 * 此刻**一个标签页都还没开**，「有没有人在用」这个守卫天然满足，是全流程里
 * 最安全的时机。运行期的清理是尽力而为（被标签页占用就推迟），推迟下来的部分
 * 由这里兜底 —— 此前退休标记只存在内存 Set 里，重启即丢，推迟的清理再也不会发生。
 *
 * ## 仍然要查 credential
 *
 * 账本可能与 credential 表不一致（账本是索引，credential 表才是权威）：
 * 譬如退休后又被重新认领。**任何时候都以「有没有 credential 指向它」为准**，
 * 这是真机事故的教训 —— 清掉了某个账号当前的登录态，用户只能看到登录页。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_ENVIRONMENT } from '../../shared/app-environment';
import type { AppLogger } from '../../shared/logging';
import { listPartitionRecords, updatePartitionState } from '../file-store/partition-ledger';

export type PartitionCleanupDependencies = Readonly<{
  userDataDir: string;
  /** 仍被某条 credential 指向则**绝不清理**。 */
  isPartitionClaimed: (partitionName: string) => boolean;
  clearPartitionStorage: (partitionName: string) => Promise<void>;
  logger: AppLogger;
}>;

export async function cleanupRetiredPartitions(
  deps: PartitionCleanupDependencies,
): Promise<Readonly<{ cleared: number; skipped: number }>> {
  const records = await listPartitionRecords(deps.userDataDir);
  const retired = records.filter((record) => record.state.kind === 'retired');
  if (retired.length === 0) return { cleared: 0, skipped: 0 };

  let cleared = 0;
  let skipped = 0;
  for (const record of retired) {
    if (deps.isPartitionClaimed(record.partitionName)) {
      // 退休后又被认领（账本落后于 credential 表，后者才是权威）。不清它。
      // 账本状态留在 retired 不动：这里没有 credentialId，编一个假的会污染账本；
      // 下次该 credential 再被探测时，`markPartitionClaimed` 会自然纠正过来。
      deps.logger.warn('Retired partition is claimed again; cleanup skipped', {
        partitionName: record.partitionName,
      });
      skipped += 1;
      continue;
    }
    try {
      await deps.clearPartitionStorage(record.partitionName);
      await updatePartitionState(deps.userDataDir, record.partitionName, {
        kind: 'cleared',
        clearedAt: new Date().toISOString(),
      });
      cleared += 1;
    } catch (error) {
      // 单个失败不阻断其余：状态留在 retired，下次启动再试。
      skipped += 1;
      deps.logger.warn('Retired partition could not be cleared at startup', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  deps.logger.info('Retired partitions cleanup finished', { cleared, skipped });
  return { cleared, skipped };
}

/**
 * 清理**孤儿** partition —— 磁盘上有目录，但既没有 credential 指向它、账本里也
 * 没有活记录。它们是账本建立之前泄漏的（真机上 21 个目录里有 11 个是这种）。
 *
 * ## 为什么这里要读磁盘目录，而账本方案刻意避开它
 *
 * `<userData>/Partitions/` 的目录结构是 Chromium 的实现细节、不是公开契约，
 * 常规路径依赖它是错的。但孤儿的定义就是「账本里没有」——不扫磁盘就永远发现不了。
 * 所以它只用在这条**兜底**路径上：扫不到、格式变了都只是少清几个，不影响功能。
 *
 * 目录名是 partition 名的 URL 编码（`persist:a:b` → `a%3Ab`，`persist:` 前缀被
 * Chromium 剥掉）。解码失败的目录一律跳过 —— 认不出来的东西不碰。
 */
export async function cleanupOrphanPartitions(
  deps: PartitionCleanupDependencies,
): Promise<Readonly<{ cleared: number }>> {
  const records = await listPartitionRecords(deps.userDataDir);
  // 账本里有活记录的都不算孤儿：pending 可能正在登录中，claimed/retired 各有归属。
  const known = new Set(
    records.filter((record) => record.state.kind !== 'cleared').map((r) => r.partitionName),
  );

  let names: readonly string[];
  try {
    names = await listPartitionDirectoryNames(deps.userDataDir);
  } catch (error) {
    deps.logger.warn('Partition directory could not be listed; orphan cleanup skipped', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { cleared: 0 };
  }

  let cleared = 0;
  for (const partitionName of names) {
    if (known.has(partitionName) || deps.isPartitionClaimed(partitionName)) continue;
    // 基础设施 partition（server-api / rms-api）不属于任何 credential，
    // 但绝不能清 —— 它们存着后端与 RMS 的会话。
    if (!isOtaLoginPartition(partitionName)) continue;

    try {
      await deps.clearPartitionStorage(partitionName);
      cleared += 1;
    } catch (error) {
      deps.logger.warn('Orphan partition could not be cleared', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  if (cleared > 0) deps.logger.info('Orphan partitions cleared', { cleared });
  return { cleared };
}

/**
 * 只清「**本环境**的 OTA 登录态」：`persist:xiaozhi:<本环境>:<channel>:<shortId>`。
 *
 * `persist:xiaozhi:server-api` / `:rms-api` 段数不足，天然被挡在外面。
 *
 * ⚠️ **环境段必须比对**，不能只看前缀加段数。孤儿判定的依据是「credential 表里没有」，
 * 而 credential 表是**按环境隔离**的——另一套环境的 partition 在本环境的表里必然查不到，
 * 于是会被当成孤儿清空。2026-08-17 真机就是这么炸的：环境段从 `prod` 改成 `dev` 后，
 * 19 个旧 partition 每次启动全被清，导入 cookie 后新建的 partition 也在下一轮被清掉，
 * 用户看到的现象是「导入成功却仍停在登录页」。
 *
 * 正常情况下三套环境的数据目录本就不共享，跨环境的 partition 不会出现在同一个
 * `Partitions/` 下；但**换环境命名规则时同一目录里会新旧并存**，这道判断就是那时的守卫。
 */
function isOtaLoginPartition(partitionName: string): boolean {
  const segments = partitionName.split(':');
  // persist:xiaozhi:<env>:<channel>:<shortId>
  return (
    partitionName.startsWith('persist:xiaozhi:') &&
    segments.length === 5 &&
    segments[2] === APP_ENVIRONMENT
  );
}

async function listPartitionDirectoryNames(userDataDir: string): Promise<readonly string[]> {
  const entries = await fs.readdir(path.join(userDataDir, 'Partitions'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        // Chromium 存盘时剥掉了 `persist:` 前缀并对其余部分做 URL 编码。
        return [`persist:${decodeURIComponent(entry.name)}`];
      } catch {
        return [];
      }
    });
}
