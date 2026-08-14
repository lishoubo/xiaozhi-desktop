import { describe, expect, it } from 'vitest';
import {
  boundChannelsOfHotel,
  requiresUnbindBeforeBinding,
} from '../../src/renderer/hotel-management/model';
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

  it('同渠道一条解绑一条在用时，该渠道仍被占用', () => {
    const bound = boundChannelsOfHotel([
      account({ id: 1, source: 'ctrip', status: 'UNBOUND' }),
      account({ id: 2, source: 'ctrip', status: 'BOUND' }),
    ]);

    expect(bound).toEqual(new Set(['ctrip']));
  });
});

describe('requiresUnbindBeforeBinding', () => {
  /** 普通新增绑定：该渠道本来就没绑，永远不需要解绑。 */
  it('不是替换场景时永远不需要解绑', () => {
    expect(requiresUnbindBeforeBinding(null, 'dy-999')).toBe(false);
  });

  it('还没选门店时不提示', () => {
    expect(requiresUnbindBeforeBinding('dy-111', undefined)).toBe(false);
  });

  /** 换成别的门店 → 远端只允许一个活跃绑定，提交必被拒。 */
  it('选中的门店与原绑定不同时需要先解绑', () => {
    expect(requiresUnbindBeforeBinding('dy-111', 'dy-222')).toBe(true);
  });

  /** 重新绑同一家不冲突——用户换了账号但门店没变，属于正常路径。 */
  it('选中的就是原来那家门店时不需要解绑', () => {
    expect(requiresUnbindBeforeBinding('dy-111', 'dy-111')).toBe(false);
  });
});
