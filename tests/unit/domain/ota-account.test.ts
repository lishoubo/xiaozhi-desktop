import { describe, expect, it } from 'vitest';
import { toChannelId, toOtaAccountId, toOtaHotelId } from '../../../src/domain/identity';
import { createOtaAccount, InvalidOtaAccountError } from '../../../src/domain/ota-account';

function input(overrides: Partial<Parameters<typeof createOtaAccount>[0]> = {}) {
  return {
    id: toOtaAccountId('account-1'),
    channel: toChannelId('douyin'),
    otaHotelId: toOtaHotelId('dy-111'),
    displayName: null,
    partitionName: 'persist:xiaozhi:prod:douyin:short-id',
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

  it('displayName 允许为 null——探测到门店名之前的状态', () => {
    const account = createOtaAccount(input({ displayName: null }));
    expect(account.displayName).toBeNull();
  });
});
