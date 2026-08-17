import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import {
  listPartitionRecords,
  prune,
  recordPartitionCreated,
  updatePartitionState,
  type PartitionRecord,
} from '../../../src/main/file-store/partition-ledger';

const DOUYIN = toChannelId('douyin');
const directories: string[] = [];

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaozhi-partition-ledger-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function record(overrides: Partial<PartitionRecord> = {}): PartitionRecord {
  return {
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    channel: DOUYIN,
    environment: 'prod',
    createdAt: '2026-01-01T00:00:00.000Z',
    state: { kind: 'pending' },
    ...overrides,
  };
}

describe('partition 账本', () => {
  it('登记新建的 partition，初始状态 pending', async () => {
    const dir = tempDir();

    await recordPartitionCreated(dir, {
      partitionName: 'persist:xiaozhi:prod:douyin:aaa',
      channel: DOUYIN,
      environment: 'prod',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(await listPartitionRecords(dir)).toEqual([
      expect.objectContaining({
        partitionName: 'persist:xiaozhi:prod:douyin:aaa',
        state: { kind: 'pending' },
      }),
    ]);
  });

  it('推进状态：pending → claimed → retired → cleared', async () => {
    const dir = tempDir();
    const name = 'persist:xiaozhi:prod:douyin:aaa';
    await recordPartitionCreated(dir, {
      partitionName: name,
      channel: DOUYIN,
      environment: 'prod',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await updatePartitionState(dir, name, { kind: 'claimed', credentialId: 'cred-1' });
    expect((await listPartitionRecords(dir))[0]?.state).toEqual({
      kind: 'claimed',
      credentialId: 'cred-1',
    });

    await updatePartitionState(dir, name, { kind: 'retired', retiredAt: 'T1' });
    expect((await listPartitionRecords(dir))[0]?.state).toEqual({
      kind: 'retired',
      retiredAt: 'T1',
    });

    await updatePartitionState(dir, name, { kind: 'cleared', clearedAt: 'T2' });
    expect((await listPartitionRecords(dir))[0]?.state).toEqual({
      kind: 'cleared',
      clearedAt: 'T2',
    });
    // 全程只有一条记录 —— 状态是改出来的，不是追加出来的。
    expect(await listPartitionRecords(dir)).toHaveLength(1);
  });

  /**
   * 账本建立之前创建的 partition 不在记录里，但它们照样会被替换、退休。
   * 带 fallback 时补记一条，否则这些 partition 永远进不了清理流程。
   */
  it('未登记的 partition 带 fallback 时补记', async () => {
    const dir = tempDir();

    await updatePartitionState(
      dir,
      'persist:xiaozhi:prod:douyin:legacy',
      { kind: 'retired', retiredAt: 'T1' },
      { channel: DOUYIN, environment: 'prod' },
    );

    expect(await listPartitionRecords(dir)).toEqual([
      expect.objectContaining({
        partitionName: 'persist:xiaozhi:prod:douyin:legacy',
        state: { kind: 'retired', retiredAt: 'T1' },
      }),
    ]);
  });

  it('未登记且无 fallback 时跳过，不编造记录', async () => {
    const dir = tempDir();

    await updatePartitionState(dir, 'persist:unknown', { kind: 'retired', retiredAt: 'T1' });

    expect(await listPartitionRecords(dir)).toEqual([]);
  });

  it('账本文件损坏时当作空账本，不抛错', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'partitions.json'), '{ not json', 'utf8');

    expect(await listPartitionRecords(dir)).toEqual([]);
  });

  it('并发写入不丢条目', async () => {
    const dir = tempDir();

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        recordPartitionCreated(dir, {
          partitionName: `persist:xiaozhi:prod:douyin:p${index}`,
          channel: DOUYIN,
          environment: 'prod',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    expect(await listPartitionRecords(dir)).toHaveLength(8);
  });
});

describe('partition 账本 — cleared 裁剪', () => {
  const recent = new Date().toISOString();

  it('活状态一律不裁剪，哪怕数量很大', () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      record({ partitionName: `p${index}`, state: { kind: 'pending' } }),
    );

    // pending 堆积是要暴露的信号（认领链路坏了），不是要裁掉的噪音。
    expect(prune(many)).toHaveLength(200);
  });

  it('cleared 超过数量上限时只留最近的', () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      record({
        partitionName: `p${index}`,
        // 序号越大时间越新
        state: { kind: 'cleared', clearedAt: new Date(Date.now() - index * 1000).toISOString() },
      }),
    );

    const kept = prune(many);
    expect(kept).toHaveLength(50);
    expect(kept.map((r) => r.partitionName)).toContain('p0');
    expect(kept.map((r) => r.partitionName)).not.toContain('p79');
  });

  it('cleared 超过时间上限时丢弃，即使数量没超', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const records = [
      record({ partitionName: 'fresh', state: { kind: 'cleared', clearedAt: recent } }),
      record({ partitionName: 'stale', state: { kind: 'cleared', clearedAt: old } }),
    ];

    expect(prune(records).map((r) => r.partitionName)).toEqual(['fresh']);
  });

  it('活状态与 cleared 混合时只裁后者', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const records = [
      record({ partitionName: 'claimed', state: { kind: 'claimed', credentialId: 'c1' } }),
      record({ partitionName: 'retired', state: { kind: 'retired', retiredAt: old } }),
      record({ partitionName: 'stale', state: { kind: 'cleared', clearedAt: old } }),
    ];

    // retired 同样是 40 天前的，但它是活状态 —— 还没清理，不能丢。
    expect(prune(records).map((r) => r.partitionName).sort()).toEqual(['claimed', 'retired']);
  });
});
