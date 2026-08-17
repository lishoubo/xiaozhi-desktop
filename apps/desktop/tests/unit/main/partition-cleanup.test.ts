import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import {
  cleanupOrphanPartitions,
  cleanupRetiredPartitions,
} from '../../../src/main/browser/partition-cleanup';
import {
  listPartitionRecords,
  recordPartitionCreated,
  updatePartitionState,
} from '../../../src/main/file-store/partition-ledger';

const DOUYIN = toChannelId('douyin');
const directories: string[] = [];

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaozhi-partition-cleanup-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

async function seed(dir: string, name: string, retired: boolean): Promise<void> {
  await recordPartitionCreated(dir, {
    partitionName: name,
    channel: DOUYIN,
    environment: 'dev',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  if (retired) {
    await updatePartitionState(dir, name, { kind: 'retired', retiredAt: '2026-01-02T00:00:00.000Z' });
  }
}

function createDeps(dir: string, claimed: readonly string[] = []) {
  return {
    userDataDir: dir,
    isPartitionClaimed: (name: string) => claimed.includes(name),
    clearPartitionStorage: vi.fn().mockResolvedValue(undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('启动时清理退休 partition', () => {
  it('清空 retired 的存储并把状态推进为 cleared', async () => {
    const dir = tempDir();
    await seed(dir, 'persist:retired', true);
    const deps = createDeps(dir);

    expect(await cleanupRetiredPartitions(deps)).toEqual({ cleared: 1, skipped: 0 });

    expect(deps.clearPartitionStorage).toHaveBeenCalledWith('persist:retired');
    expect((await listPartitionRecords(dir))[0]?.state.kind).toBe('cleared');
  });

  it('不碰 pending 与 claimed', async () => {
    const dir = tempDir();
    await seed(dir, 'persist:pending', false);
    await recordPartitionCreated(dir, {
      partitionName: 'persist:claimed',
      channel: DOUYIN,
      environment: 'dev',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await updatePartitionState(dir, 'persist:claimed', {
      kind: 'claimed',
      credentialId: 'cred-1',
    });
    const deps = createDeps(dir);

    expect(await cleanupRetiredPartitions(deps)).toEqual({ cleared: 0, skipped: 0 });
    expect(deps.clearPartitionStorage).not.toHaveBeenCalled();
  });

  /**
   * 🔴 事故防线：账本说它退休了，但 credential 表说还在用 —— 以 credential 表为准。
   * 清了就是用户掉登录态。
   */
  it('账本说 retired 但仍被 credential 引用时绝不清理', async () => {
    const dir = tempDir();
    await seed(dir, 'persist:claimed-again', true);
    const deps = createDeps(dir, ['persist:claimed-again']);

    expect(await cleanupRetiredPartitions(deps)).toEqual({ cleared: 0, skipped: 1 });

    expect(deps.clearPartitionStorage).not.toHaveBeenCalled();
    // 状态保持 retired：这里没有 credentialId，不编造 claimed 记录。
    expect((await listPartitionRecords(dir))[0]?.state.kind).toBe('retired');
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Retired partition is claimed again; cleanup skipped',
      expect.anything(),
    );
  });

  it('单个清理失败不阻断其余，失败项留在 retired 等下次启动', async () => {
    const dir = tempDir();
    await seed(dir, 'persist:bad', true);
    await seed(dir, 'persist:good', true);
    const deps = createDeps(dir);
    deps.clearPartitionStorage.mockImplementation(async (name: string) => {
      if (name === 'persist:bad') throw new Error('locked');
    });

    expect(await cleanupRetiredPartitions(deps)).toEqual({ cleared: 1, skipped: 1 });

    const records = await listPartitionRecords(dir);
    expect(records.find((r) => r.partitionName === 'persist:bad')?.state.kind).toBe('retired');
    expect(records.find((r) => r.partitionName === 'persist:good')?.state.kind).toBe('cleared');
  });

  it('没有 retired 记录时直接返回，不读写存储', async () => {
    const dir = tempDir();
    const deps = createDeps(dir);

    expect(await cleanupRetiredPartitions(deps)).toEqual({ cleared: 0, skipped: 0 });
    expect(deps.clearPartitionStorage).not.toHaveBeenCalled();
  });
});

/** 目录名是 partition 名去掉 `persist:` 前缀后的 URL 编码。 */
function makePartitionDir(userDataDir: string, partitionName: string): void {
  const encoded = encodeURIComponent(partitionName.replace(/^persist:/, ''));
  fs.mkdirSync(path.join(userDataDir, 'Partitions', encoded), { recursive: true });
}

describe('清理孤儿 partition（账本建立前泄漏的）', () => {
  it('清掉磁盘上无人认领、账本里也没有的 partition', async () => {
    const dir = tempDir();
    makePartitionDir(dir, 'persist:xiaozhi:dev:douyin:orphan');
    const deps = createDeps(dir);

    expect(await cleanupOrphanPartitions(deps)).toEqual({ cleared: 1 });
    expect(deps.clearPartitionStorage).toHaveBeenCalledWith('persist:xiaozhi:dev:douyin:orphan');
  });

  it('账本里有活记录的不算孤儿', async () => {
    const dir = tempDir();
    const name = 'persist:xiaozhi:dev:douyin:known';
    makePartitionDir(dir, name);
    await seed(dir, name, false); // pending：可能正在登录中

    const deps = createDeps(dir);
    expect(await cleanupOrphanPartitions(deps)).toEqual({ cleared: 0 });
    expect(deps.clearPartitionStorage).not.toHaveBeenCalled();
  });

  it('被 credential 引用的不算孤儿', async () => {
    const dir = tempDir();
    const name = 'persist:xiaozhi:dev:douyin:claimed';
    makePartitionDir(dir, name);
    const deps = createDeps(dir, [name]);

    expect(await cleanupOrphanPartitions(deps)).toEqual({ cleared: 0 });
    expect(deps.clearPartitionStorage).not.toHaveBeenCalled();
  });

  /**
   * 🔴 回归：2026-08-17 真机事故。环境段从 `prod` 改成 `dev` 后，19 个旧 partition
   * 每次启动全被当孤儿清空——因为孤儿判定依据「credential 表里没有」，而另一套环境的
   * partition 在本环境的表里必然查不到。表现是「cookie 导入成功却仍停在登录页」。
   */
  it('绝不碰其他环境的 partition —— 它们在本环境的 credential 表里必然查不到', async () => {
    const dir = tempDir();
    makePartitionDir(dir, 'persist:xiaozhi:prod:douyin:legacy');
    makePartitionDir(dir, 'persist:xiaozhi:pre:ctrip:other-env');
    const deps = createDeps(dir);

    expect(await cleanupOrphanPartitions(deps)).toEqual({ cleared: 0 });
    expect(deps.clearPartitionStorage).not.toHaveBeenCalled();
  });

  /** 🔴 基础设施 partition 存着后端与 RMS 的会话，清了会掉登录。 */
  it('绝不碰 server-api / rms-api 等基础设施 partition', async () => {
    const dir = tempDir();
    makePartitionDir(dir, 'persist:xiaozhi:server-api');
    makePartitionDir(dir, 'persist:xiaozhi:rms-api');
    const deps = createDeps(dir);

    expect(await cleanupOrphanPartitions(deps)).toEqual({ cleared: 0 });
    expect(deps.clearPartitionStorage).not.toHaveBeenCalled();
  });

  it('Partitions 目录不存在时安静跳过', async () => {
    const dir = tempDir();
    const deps = createDeps(dir);

    expect(await cleanupOrphanPartitions(deps)).toEqual({ cleared: 0 });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'Partition directory could not be listed; orphan cleanup skipped',
      expect.anything(),
    );
  });

  it('已 cleared 的记录不妨碍它被再次识别为孤儿', async () => {
    const dir = tempDir();
    const name = 'persist:xiaozhi:dev:douyin:recleared';
    makePartitionDir(dir, name);
    await seed(dir, name, true);
    await updatePartitionState(dir, name, { kind: 'cleared', clearedAt: new Date().toISOString() });

    const deps = createDeps(dir);
    // cleared 不是活状态：目录还在、没人认领，就该继续清（清空是幂等的）。
    expect(await cleanupOrphanPartitions(deps)).toEqual({ cleared: 1 });
  });
});
