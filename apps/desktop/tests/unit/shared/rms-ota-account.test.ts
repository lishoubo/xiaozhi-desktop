import { describe, expect, it } from 'vitest';
import { toChannelId } from '../../../src/main/ids';
import {
  createRmsOtaAccount,
  InvalidRmsOtaAccountError,
} from '../../../src/shared/types/rms-ota-account';

function input(overrides: Partial<Parameters<typeof createRmsOtaAccount>[0]> = {}) {
  return {
    id: 1,
    hotelId: 1,
    otaHotelId: 'ota-hotel-1',
    otaHotelName: '示例 OTA 酒店',
    status: 'active',
    source: toChannelId('douyin'),
    bindExtra: null,
    ...overrides,
  };
}

describe('createRmsOtaAccount', () => {
  it('创建一个最小 OTA account 投影', () => {
    const account = createRmsOtaAccount(input());
    expect(account.id).toBe(1);
    expect(account.hotelId).toBe(1);
    expect(account.source).toBe('douyin');
  });

  it('拒绝非正整数 id', () => {
    expect(() => createRmsOtaAccount(input({ id: 0 }))).toThrow(InvalidRmsOtaAccountError);
  });

  it('拒绝非正整数 hotelId', () => {
    expect(() => createRmsOtaAccount(input({ hotelId: 0 }))).toThrow(InvalidRmsOtaAccountError);
  });

  it('拒绝空白 status', () => {
    expect(() => createRmsOtaAccount(input({ status: '  ' }))).toThrow(InvalidRmsOtaAccountError);
  });

  it('保留结构化 bindExtra', () => {
    const account = createRmsOtaAccount(input({ bindExtra: { note: 'x' } }));
    expect(account.bindExtra).toEqual({ note: 'x' });
  });
});
