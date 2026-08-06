import { describe, expect, it } from 'vitest';
import {
  toChannelId,
  toOtaAccountId,
  toOtaCredentialId,
  toOtaHotelId,
} from '../../../src/domain/identity';
import { createOtaAccount, InvalidOtaAccountError } from '../../../src/domain/ota-account';

function input(overrides: Partial<Parameters<typeof createOtaAccount>[0]> = {}) {
  return {
    id: toOtaAccountId('account-1'),
    credentialId: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    otaHotelId: toOtaHotelId('dy-111'),
    otaHotelName: null,
    bindExtra: null,
    discoveredAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('createOtaAccount', () => {
  it('创建一个引用 credential 的酒店账号', () => {
    const account = createOtaAccount(input());
    expect(account.credentialId).toBe('credential-1');
    expect(account.otaHotelId).toBe('dy-111');
    expect(account).not.toHaveProperty('partitionName');
  });

  it('credentialId 为空时拒绝创建', () => {
    expect(() =>
      createOtaAccount(input({ credentialId: '' as ReturnType<typeof toOtaCredentialId> })),
    ).toThrow(InvalidOtaAccountError);
  });

  it('otaHotelName 允许为 null——探测到门店名之前的状态', () => {
    const account = createOtaAccount(input({ otaHotelName: null }));
    expect(account.otaHotelName).toBeNull();
  });

  it('bindExtra 允许为 null——携程场景恒为 null', () => {
    const account = createOtaAccount(input({ bindExtra: null }));
    expect(account.bindExtra).toBeNull();
  });

  it('bindExtra 非空时保留结构化渠道信息', () => {
    const account = createOtaAccount(input({ bindExtra: { merchantGroupId: 'group-123' } }));
    expect(account.bindExtra).toEqual({ merchantGroupId: 'group-123' });
  });

  it('discoveredAt 原样保留', () => {
    const account = createOtaAccount(input({ discoveredAt: 1_699_999_999_999 }));
    expect(account.discoveredAt).toBe(1_699_999_999_999);
  });
});
