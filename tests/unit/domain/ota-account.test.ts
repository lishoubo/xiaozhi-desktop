import { describe, expect, it } from 'vitest';
import { toChannelId, toOtaAccountId, toOtaHotelId } from '../../../src/domain/identity';
import { createOtaAccount, InvalidOtaAccountError } from '../../../src/domain/ota-account';

function input(overrides: Partial<Parameters<typeof createOtaAccount>[0]> = {}) {
  return {
    id: toOtaAccountId('account-1'),
    channel: toChannelId('douyin'),
    otaHotelId: toOtaHotelId('dy-111'),
    otaHotelName: null,
    partitionName: 'persist:xiaozhi:prod:douyin:short-id',
    channelContext: null,
    discoveredAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('createOtaAccount', () => {
  it('创建一个持有 partitionName 指针的账号', () => {
    const account = createOtaAccount(input());
    expect(account.partitionName).toBe('persist:xiaozhi:prod:douyin:short-id');
    expect(account.otaHotelId).toBe('dy-111');
  });

  it('partitionName 为空时拒绝创建——账号必须有登录态指针', () => {
    expect(() => createOtaAccount(input({ partitionName: '' }))).toThrow(InvalidOtaAccountError);
  });

  it('otaHotelName 允许为 null——探测到门店名之前的状态', () => {
    const account = createOtaAccount(input({ otaHotelName: null }));
    expect(account.otaHotelName).toBeNull();
  });

  it('channelContext 允许为 null——携程场景恒为 null', () => {
    const account = createOtaAccount(input({ channelContext: null }));
    expect(account.channelContext).toBeNull();
  });

  it('channelContext 非空时原样保留——抖音场景存 groupid', () => {
    const account = createOtaAccount(input({ channelContext: 'group-123' }));
    expect(account.channelContext).toBe('group-123');
  });

  it('discoveredAt 原样保留', () => {
    const account = createOtaAccount(input({ discoveredAt: 1_699_999_999_999 }));
    expect(account.discoveredAt).toBe(1_699_999_999_999);
  });
});
