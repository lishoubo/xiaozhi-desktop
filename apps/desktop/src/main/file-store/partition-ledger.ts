/**
 * partition 账本 —— `<userData>/partitions.json`。**每个被创建过的 partition
 * 都在这里有一条记录**，状态随生命周期推进。
 *
 * ## 为什么需要它
 *
 * 此前 partition 的真相散在三处，谁都不完整：
 *
 * ```
 * ota_credential.partition_name   只覆盖「已认领」
 * pending-partitions.json         只覆盖「待认领」，且 listPendingPartitions 零调用方
 *                                 —— 只写不读，等于没有
 * <userData>/Partitions/ 目录     是全集，但依赖 Chromium 未公开的目录结构
 * ```
 *
 * 结果是**无法枚举全集**：真机上 21 个目录只有 9 个被 credential 引用，
 * 另外 11 个既无人认领也无处可查（本模块建立前的遗留）。
 *
 * ## 状态机
 *
 * ```
 * created ──→ pending ──探测成功──→ claimed ──被替换──→ retired ──清空──→ cleared
 *                 │                                                        │
 *                 └──────────── 用户放弃/探测失败，长期未认领 ─────────────┘
 * ```
 *
 * `retired` 必须落盘而不是只存内存：此前它是 `BrowserManager` 的内存 Set，
 * 重启即清空，「标记了退休但当时有标签页占用」的 partition 之后再也没人清。
 *
 * ## 保留策略
 *
 * `cleared` 之外的状态**全部保留**，因为它们是活事实；`cleared` 只有追溯价值，
 * 按数量 + 时间双上限裁剪，否则账本本身会无限增长 —— 那就只是把「目录只增不减」
 * 换成「JSON 只增不减」。
 *
 * ⚠️ **活状态不设上限是有意的**：`pending` 若堆到异常数量，说明认领链路出了问题，
 * 那是要暴露的信号，不是要裁掉的噪音。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChannelId } from '../ids';

const LEDGER_FILENAME = 'partitions.json';

/** `cleared` 条目的双上限，先命中者生效。 */
const CLEARED_MAX_ENTRIES = 50;
const CLEARED_MAX_AGE_DAYS = 30;

export type PartitionState =
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'claimed'; credentialId: string }>
  | Readonly<{ kind: 'retired'; retiredAt: string }>
  | Readonly<{ kind: 'cleared'; clearedAt: string }>;

/**
 * 创建一份 partition 时要登记的事实。沿用 `PendingPartition` 这个名字是因为
 * 调用方签名里已经用它表达「新建出来、还没被认领」，换名字只会制造无谓 diff。
 */
export type PendingPartition = Readonly<{
  partitionName: string;
  channel: ChannelId;
  environment: 'prod' | 'dev';
  createdAt: string;
}>;

export type PartitionRecord = Readonly<{
  partitionName: string;
  channel: ChannelId;
  environment: 'prod' | 'dev';
  createdAt: string;
  state: PartitionState;
}>;

function filePath(userDataDir: string): string {
  return path.join(userDataDir, LEDGER_FILENAME);
}

async function readAll(userDataDir: string): Promise<PartitionRecord[]> {
  try {
    const raw = await fs.readFile(filePath(userDataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PartitionRecord[]) : [];
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    // 账本损坏不该让应用起不来：它是可重建的索引，不是权威数据
    // （权威是 credential 表与磁盘目录）。当作空账本继续，下次写入即自愈。
    return [];
  }
}

async function writeAll(userDataDir: string, records: readonly PartitionRecord[]): Promise<void> {
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(filePath(userDataDir), JSON.stringify(prune(records)), 'utf8');
}

/** 见文件头「保留策略」。只裁 `cleared`，活状态一律保留。 */
export function prune(records: readonly PartitionRecord[]): readonly PartitionRecord[] {
  const alive = records.filter((record) => record.state.kind !== 'cleared');
  const cutoff = Date.now() - CLEARED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const cleared = records
    .filter((record) => record.state.kind === 'cleared')
    .sort((a, b) => clearedAt(b).localeCompare(clearedAt(a)))
    .filter((record, index) => index < CLEARED_MAX_ENTRIES && notExpired(clearedAt(record), cutoff));
  return [...alive, ...cleared];
}

/**
 * 时间戳解析不出来时**保留**该条目，而不是当成「无限旧」丢掉。
 *
 * 裁剪是清理噪音，不该因为一个脏时间戳就静默删记录 —— 记录本身还有追溯价值，
 * 而且下次写入会盖上正确的时间。丢弃只在「确认它足够旧」时发生。
 */
function notExpired(timestamp: string, cutoff: number): boolean {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) || parsed >= cutoff;
}

function clearedAt(record: PartitionRecord): string {
  return record.state.kind === 'cleared' ? record.state.clearedAt : '';
}

/**
 * 用户可能连续开多个标签页，读-改-写必须序列化，否则并发写入互相覆盖丢条目。
 * 整个 main 进程只有一份账本，用模块级 promise 链当互斥锁即可，不引入文件锁库。
 */
let mutex: Promise<unknown> = Promise.resolve();

function withMutex<T>(task: () => Promise<T>): Promise<T> {
  const next = mutex.then(task, task);
  mutex = next.catch(() => {});
  return next;
}

/** 新建一份 partition 时登记，状态 `pending`。 */
export function recordPartitionCreated(
  userDataDir: string,
  entry: Readonly<{
    partitionName: string;
    channel: ChannelId;
    environment: 'prod' | 'dev';
    createdAt: string;
  }>,
): Promise<void> {
  return withMutex(async () => {
    const records = await readAll(userDataDir);
    const others = records.filter((record) => record.partitionName !== entry.partitionName);
    await writeAll(userDataDir, [...others, { ...entry, state: { kind: 'pending' } }]);
  });
}

/** 状态迁移。partition 不在账本里时**补记一条**——账本建立前创建的那些也要能推进。 */
export function updatePartitionState(
  userDataDir: string,
  partitionName: string,
  state: PartitionState,
  fallback?: Readonly<{ channel: ChannelId; environment: 'prod' | 'dev' }>,
): Promise<void> {
  return withMutex(async () => {
    const records = await readAll(userDataDir);
    const existing = records.find((record) => record.partitionName === partitionName);
    const others = records.filter((record) => record.partitionName !== partitionName);
    if (!existing && !fallback) {
      // 既不在账本、调用方也没给渠道信息 —— 无从补记，跳过而不是编一条假的。
      return;
    }
    const base: PartitionRecord = existing ?? {
      partitionName,
      channel: fallback!.channel,
      environment: fallback!.environment,
      createdAt: new Date().toISOString(),
      state: { kind: 'pending' },
    };
    await writeAll(userDataDir, [...others, { ...base, state }]);
  });
}

export function listPartitionRecords(userDataDir: string): Promise<readonly PartitionRecord[]> {
  return withMutex(() => readAll(userDataDir));
}
