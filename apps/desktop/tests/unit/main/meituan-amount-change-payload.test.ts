import { describe, expect, it } from 'vitest';
import { toMeituanAmountChangeRaw } from '../../../src/main/channels/meituan/amount-change-payload';

/** 真机响应（2026-08-12，门店 762662011）的骨架，只截去与解析无关的静态字段。 */
function calcResponse(goodsDetail: Record<string, unknown>): string {
  return JSON.stringify({
    code: 10000,
    error: null,
    traceId: '-546321091878745095',
    data: {
      goodsDetails: [goodsDetail],
      globalPricePrompt: { prompts: null, unifiedSubRatio: null },
    },
    success: true,
  });
}

/** 形状①（统一日期）的一条房型明细，字段取自真机。 */
const UNIFIED_DETAIL = {
  goodsBaseInfo: {
    goodsId: 847317669,
    goodsName: 'I经济I 大床房（简约舒适）',
    preGoodsId: '64472d02da3fa7ab168924ad',
    goodsStatus: 2,
    breakFastNum: 0,
  },
  priceRecordWay: 8,
  pricePrompt: { prompts: [], noPriceDates: null },
  unifiedDatePriceInfos: {
    dates: [{ startDate: '2026-08-25', endDate: '2026-08-26' }],
    weekPriceInfos: [
      {
        inWeek: [1, 2, 3, 4, 5, 6, 7],
        priceInfo: { salePrice: '19066', basePrice: '16587' },
        originalPriceInfo: { salePrice: '18966', basePrice: '16500' },
      },
    ],
  },
  priceInfos: null,
  // 服务端按区间内实际日期重拆过的分档 —— 与请求的 [1..7] 对不上
  realPriceInfos: [
    {
      startDate: '2026-08-25',
      endDate: '2026-08-26',
      weekPriceInfos: [{ inWeek: [2, 3], priceInfo: { salePrice: '19066' } }],
    },
  ],
  weekDiff: false,
  ratioConfig: { ratioType: null, ratioChange: false, newRatio: null },
};

describe('美团 changeRaw 模型', () => {
  /** 我们是旁听者，不会拿 traceId 回头找美团对账；成功与否已由 isSuccessful 判过。 */
  it('剔掉信封层，只留 data', () => {
    const raw = toMeituanAmountChangeRaw(calcResponse(UNIFIED_DETAIL));

    expect(raw).not.toHaveProperty('code');
    expect(raw).not.toHaveProperty('error');
    expect(raw).not.toHaveProperty('traceId');
    expect(raw).not.toHaveProperty('success');
    expect(raw).toHaveProperty('goodsDetails');
    expect(raw).toHaveProperty('globalPricePrompt');
  });

  /**
   * `realPriceInfos` 的 `inWeek` 是服务端按「区间内实际存在的日期 + 原价是否相同」重拆过的
   * （本例 `[2,3]`），与用户选的周次档 `[1..7]` 对不上 —— 留着会诱导 RMS 把价格安错档。
   * 这是**有害**字段，不只是冗余。
   */
  it('剔掉 realPriceInfos —— 它的周次档与请求对不上', () => {
    const raw = toMeituanAmountChangeRaw(calcResponse(UNIFIED_DETAIL));
    const details = raw?.goodsDetails as Record<string, unknown>[];

    expect(details[0]).not.toHaveProperty('realPriceInfos');
  });

  /** 26 个字段全是房型静态属性（房型名、早餐数、审核状态…），与改了什么价无关。 */
  it('goodsBaseInfo 收成只剩 goodsId', () => {
    const raw = toMeituanAmountChangeRaw(calcResponse(UNIFIED_DETAIL));
    const details = raw?.goodsDetails as Record<string, unknown>[];

    expect(details[0].goodsBaseInfo).toEqual({ goodsId: 847317669 });
  });

  /** 改前 189.66 → 改后 190.66，这是 RMS 跟价唯一要的东西，一个字段都不能丢。 */
  it('改前价与改后价原样保留', () => {
    const raw = toMeituanAmountChangeRaw(calcResponse(UNIFIED_DETAIL));
    const details = raw?.goodsDetails as { unifiedDatePriceInfos: Record<string, unknown> }[];

    expect(details[0].unifiedDatePriceInfos).toEqual(UNIFIED_DETAIL.unifiedDatePriceInfos);
  });

  /** 语义未知的一律留着：剔错了 RMS 侧再也看不到原始数据，不可恢复。 */
  it('语义未知的字段原样保留', () => {
    const raw = toMeituanAmountChangeRaw(calcResponse(UNIFIED_DETAIL));
    const details = raw?.goodsDetails as Record<string, unknown>[];

    expect(details[0].ratioConfig).toEqual(UNIFIED_DETAIL.ratioConfig);
    expect(details[0].pricePrompt).toEqual(UNIFIED_DETAIL.pricePrompt);
    expect(details[0].priceRecordWay).toBe(8);
    expect(details[0].weekDiff).toBe(false);
    expect(raw?.globalPricePrompt).toEqual({ prompts: null, unifiedSubRatio: null });
  });

  /** 形状②：日期跟着每一段走，`priceInfos` 有值而 `unifiedDatePriceInfos` 为 null。 */
  it('形状②（分段日期）同样处理', () => {
    const raw = toMeituanAmountChangeRaw(
      calcResponse({
        goodsBaseInfo: { goodsId: 847226645, goodsName: '要被剔掉的' },
        unifiedDatePriceInfos: null,
        priceInfos: [
          {
            startDate: '2026-08-25',
            endDate: '2026-08-26',
            weekPriceInfos: [{ inWeek: [2, 3], priceInfo: { salePrice: '19066' } }],
          },
          {
            startDate: '2026-08-27',
            endDate: '2026-08-28',
            weekPriceInfos: [{ inWeek: [4, 5], priceInfo: { salePrice: '20000' } }],
          },
        ],
      }),
    );
    const details = raw?.goodsDetails as Record<string, unknown>[];

    expect(details[0].goodsBaseInfo).toEqual({ goodsId: 847226645 });
    expect(details[0].priceInfos).toHaveLength(2);
  });

  it('多个房型逐条裁剪', () => {
    const raw = toMeituanAmountChangeRaw(
      JSON.stringify({
        code: 10000,
        data: {
          goodsDetails: [
            { goodsBaseInfo: { goodsId: 1, goodsName: 'A' }, realPriceInfos: [{}] },
            { goodsBaseInfo: { goodsId: 2, goodsName: 'B' }, realPriceInfos: [{}] },
          ],
        },
        success: true,
      }),
    );
    const details = raw?.goodsDetails as Record<string, unknown>[];

    expect(details).toHaveLength(2);
    expect(details.map((d) => d.goodsBaseInfo)).toEqual([{ goodsId: 1 }, { goodsId: 2 }]);
    expect(details.every((d) => !('realPriceInfos' in d))).toBe(true);
  });

  /** 认不出的形状返回 null，调用方据此**保留上一条**，宁可用旧的也不要存个空壳。 */
  it('形状不认识时返回 null', () => {
    expect(toMeituanAmountChangeRaw('<html>502 Bad Gateway</html>')).toBeNull();
    expect(toMeituanAmountChangeRaw('{"code":10000,"data":null}')).toBeNull();
    // data 是字符串（`updatePriceV2` 的响应就是这样，别把它当试算）
    expect(toMeituanAmountChangeRaw('{"code":10000,"data":"hotel_sc_dealing__x"}')).toBeNull();
  });
});
