import { describe, expect, it } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import { APP_ENVIRONMENT } from '../../../src/shared/app-environment';
import { isCurrentLayoutPartition, toPartitionName } from '../../../src/main/browser/partition';

describe('toPartitionName', () => {
  it('同渠道的两个短id得到不同 partition —— 这是 D1 的修复点', () => {
    const a = toPartitionName(toChannelId('ctrip'), 'short-id-1');
    const b = toPartitionName(toChannelId('ctrip'), 'short-id-2');
    expect(a).not.toBe(b);
  });

  it('不同渠道互不干扰 —— 导入携程不该覆盖美团', () => {
    const ctrip = toPartitionName(toChannelId('ctrip'), 'short-id-1');
    const meituan = toPartitionName(toChannelId('meituan'), 'short-id-1');
    expect(ctrip).not.toBe(meituan);
  });

  it('名称带上构建期环境段 —— 换环境后旧名字成为孤儿，不会被误认', () => {
    expect(toPartitionName(toChannelId('ctrip'), 'short-id-1')).toContain(`:${APP_ENVIRONMENT}:`);
  });

  it('环境不由调用方传入 —— 它只有构建期一个来源', () => {
    // 形参只剩 (channel, shortId)：多传的实参会被忽略，环境段始终来自构建期常量。
    expect(toPartitionName.length).toBe(2);
  });

  it('相同的入参永远得到相同的 partition（幂等）', () => {
    expect(toPartitionName(toChannelId('ctrip'), 'short-id-1')).toBe(
      toPartitionName(toChannelId('ctrip'), 'short-id-1'),
    );
  });

  it('生成 Electron 要求的 persist: 前缀，否则不会落盘', () => {
    expect(toPartitionName(toChannelId('ctrip'), 'short-id-1')).toMatch(/^persist:/);
  });

  it('绝不等于旧的全局共享 partition', () => {
    // 账号隔离改造前所有账号共用的旧 partition，用户磁盘上可能仍存在。
    expect(toPartitionName(toChannelId('ctrip'), 'short-id-1')).not.toBe(
      'persist:hotel-butler-browser',
    );
  });
});

describe('isCurrentLayoutPartition', () => {
  it('识别当前布局生成的 partition', () => {
    expect(isCurrentLayoutPartition(toPartitionName(toChannelId('ctrip'), 'short-id-1'))).toBe(true);
  });

  it('把旧的共享 partition 判为非当前布局（legacy）', () => {
    expect(isCurrentLayoutPartition('persist:hotel-butler-browser')).toBe(false);
  });
});
