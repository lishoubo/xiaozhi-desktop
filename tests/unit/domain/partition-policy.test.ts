import { describe, expect, it } from 'vitest';
import { toChannelId, toOtaAccountId, type BrowserContextKey } from '../../../src/domain/identity';
import {
  isCurrentLayoutPartition,
  LEGACY_SHARED_PARTITION,
  toPartitionName,
} from '../../../src/domain/policy/partition-policy';

function key(channel: string, account: string, environment: 'prod' | 'dev'): BrowserContextKey {
  return {
    environment,
    channel: toChannelId(channel),
    otaAccountId: toOtaAccountId(account),
  };
}

describe('toPartitionName', () => {
  it('同渠道的两个账号得到不同 partition —— 这是 D1 的修复点', () => {
    const a = toPartitionName(key('ctrip', 'ctrip-account-1', 'prod'));
    const b = toPartitionName(key('ctrip', 'ctrip-account-2', 'prod'));
    expect(a).not.toBe(b);
  });

  it('不同渠道互不干扰 —— 导入携程不该覆盖美团', () => {
    const ctrip = toPartitionName(key('ctrip', 'account-1', 'prod'));
    const meituan = toPartitionName(key('meituan', 'account-1', 'prod'));
    expect(ctrip).not.toBe(meituan);
  });

  it('prod 与 dev 隔离', () => {
    expect(toPartitionName(key('ctrip', 'account-1', 'prod'))).not.toBe(
      toPartitionName(key('ctrip', 'account-1', 'dev')),
    );
  });

  it('相同的 key 永远得到相同的 partition（幂等）', () => {
    expect(toPartitionName(key('ctrip', 'account-1', 'prod'))).toBe(
      toPartitionName(key('ctrip', 'account-1', 'prod')),
    );
  });

  it('生成 Electron 要求的 persist: 前缀，否则不会落盘', () => {
    expect(toPartitionName(key('ctrip', 'account-1', 'prod'))).toMatch(/^persist:/);
  });

  it('绝不等于旧的全局共享 partition', () => {
    expect(toPartitionName(key('ctrip', 'account-1', 'prod'))).not.toBe(LEGACY_SHARED_PARTITION);
  });
});

describe('isCurrentLayoutPartition', () => {
  it('识别当前布局生成的 partition', () => {
    expect(isCurrentLayoutPartition(toPartitionName(key('ctrip', 'account-1', 'prod')))).toBe(true);
  });

  it('把旧的共享 partition 判为非当前布局（legacy）', () => {
    expect(isCurrentLayoutPartition(LEGACY_SHARED_PARTITION)).toBe(false);
  });
});
