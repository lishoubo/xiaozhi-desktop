import { describe, expect, it } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import {
  isCurrentLayoutPartition,
  toPartitionName,
} from '../../../src/main/browser/partition';

describe('toPartitionName', () => {
  it('同渠道的两个短id得到不同 partition —— 这是 D1 的修复点', () => {
    const a = toPartitionName('prod', toChannelId('ctrip'), 'short-id-1');
    const b = toPartitionName('prod', toChannelId('ctrip'), 'short-id-2');
    expect(a).not.toBe(b);
  });

  it('不同渠道互不干扰 —— 导入携程不该覆盖美团', () => {
    const ctrip = toPartitionName('prod', toChannelId('ctrip'), 'short-id-1');
    const meituan = toPartitionName('prod', toChannelId('meituan'), 'short-id-1');
    expect(ctrip).not.toBe(meituan);
  });

  it('prod 与 dev 隔离', () => {
    expect(toPartitionName('prod', toChannelId('ctrip'), 'short-id-1')).not.toBe(
      toPartitionName('dev', toChannelId('ctrip'), 'short-id-1'),
    );
  });

  it('相同的入参永远得到相同的 partition（幂等）', () => {
    expect(toPartitionName('prod', toChannelId('ctrip'), 'short-id-1')).toBe(
      toPartitionName('prod', toChannelId('ctrip'), 'short-id-1'),
    );
  });

  it('生成 Electron 要求的 persist: 前缀，否则不会落盘', () => {
    expect(toPartitionName('prod', toChannelId('ctrip'), 'short-id-1')).toMatch(/^persist:/);
  });

  it('绝不等于旧的全局共享 partition', () => {
    // 账号隔离改造前所有账号共用的旧 partition，用户磁盘上可能仍存在。
    expect(toPartitionName('prod', toChannelId('ctrip'), 'short-id-1')).not.toBe(
      'persist:hotel-butler-browser',
    );
  });
});

describe('isCurrentLayoutPartition', () => {
  it('识别当前布局生成的 partition', () => {
    expect(isCurrentLayoutPartition(toPartitionName('prod', toChannelId('ctrip'), 'short-id-1'))).toBe(
      true,
    );
  });

  it('把旧的共享 partition 判为非当前布局（legacy）', () => {
    expect(isCurrentLayoutPartition('persist:hotel-butler-browser')).toBe(false);
  });
});
