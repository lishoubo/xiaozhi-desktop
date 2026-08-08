import { describe, expect, it } from 'vitest';
import { boundChannelsOfHotel } from '../../src/renderer/hotel-management/model';
import type { RmsOtaAccountDto } from '../../src/shared/hotel-management';

function account(overrides: Partial<RmsOtaAccountDto> = {}): RmsOtaAccountDto {
  return {
    id: 1,
    hotelId: 1001,
    otaHotelId: 'dy-1',
    otaHotelName: '测试酒店',
    status: 'BOUND',
    source: 'douyin',
    bindExtra: null,
    ...overrides,
  };
}

describe('boundChannelsOfHotel', () => {
  it('没有账号时没有渠道被占用', () => {
    expect(boundChannelsOfHotel([])).toEqual(new Set());
  });

  it('列出所有占用了绑定位的渠道', () => {
    const bound = boundChannelsOfHotel([
      account({ source: 'douyin' }),
      account({ id: 2, source: 'ctrip' }),
    ]);

    expect(bound).toEqual(new Set(['douyin', 'ctrip']));
  });

  /**
   * 关键场景：失效的绑定仍然占位。远端拒绝的依据是「已存在活跃绑定」，而不是
   * 「这个账号还好使」——放它进可选列表，用户选了照样被拒。
   */
  it('登录失效的账号仍然占着该渠道', () => {
    expect(boundChannelsOfHotel([account({ status: 'LOGIN_EXPIRED' })])).toEqual(
      new Set(['douyin']),
    );
  });

  it('已解绑的账号释放绑定位', () => {
    expect(boundChannelsOfHotel([account({ status: 'UNBOUND' })])).toEqual(new Set());
  });

  it('同渠道多个账号只算一次', () => {
    const bound = boundChannelsOfHotel([
      account({ id: 1, source: 'meituan' }),
      account({ id: 2, source: 'meituan', otaHotelId: 'mt-2' }),
    ]);

    expect(bound).toEqual(new Set(['meituan']));
  });

  it('同渠道一条解绑一条在用时，该渠道仍被占用', () => {
    const bound = boundChannelsOfHotel([
      account({ id: 1, source: 'ctrip', status: 'UNBOUND' }),
      account({ id: 2, source: 'ctrip', status: 'BOUND' }),
    ]);

    expect(bound).toEqual(new Set(['ctrip']));
  });
});
