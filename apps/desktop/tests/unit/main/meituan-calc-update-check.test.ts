import { describe, expect, it } from 'vitest';
import {
  extractMeituanCalcCells,
  mergeMeituanCalcCells,
  rebuildGoodsDetails,
  submittedGoodsDateKeys,
  toMeituanAmountChangeRaw,
  type MeituanCalcCell,
} from '../../../src/main/channels/meituan/amount-change-payload';
import { buildMeituanCalcUpdateCheck } from '../../../src/main/channels/meituan/calc-update-check';
import type { JsonObject } from '../../../src/shared/types/json';

/**
 * 累积与对账的用例 —— **全部取自真实踩点序列**，不是构造的假数据。
 *
 * 这一组钉住的是本次改动的核心：美团的 `calcPriceV2` 只重算用户当次触碰的那部分，
 * 整条覆盖会静默丢掉先算的房型（用户改 3 个只报 1 个）。
 *
 * 踩点出处：`docs/踩点/美团/批量改房价-基础改价.md`、`批量改房价-高级改价.md`、
 * `房价房量日历踩点.md`、`改价踩点.md`。
 */

/** 一条 calc 响应的信封，`data.goodsDetails` 由各用例给。 */
function calcResponse(goodsDetails: readonly JsonObject[]): string {
  return JSON.stringify({
    code: 10000,
    error: null,
    traceId: '-546321091878745095',
    data: { goodsDetails, globalPricePrompt: { prompts: null, unifiedSubRatio: null } },
    success: true,
  });
}

/** 形状①（统一日期）的一条房型明细。 */
function unifiedDetail(
  goodsId: number,
  startDate: string,
  endDate: string,
  weeks: readonly { inWeek: number[]; from: string; to: string }[],
): JsonObject {
  return {
    goodsBaseInfo: { goodsId },
    priceRecordWay: 8,
    weekDiff: weeks.length > 1,
    unifiedDatePriceInfos: {
      dates: [{ startDate, endDate }],
      weekPriceInfos: weeks.map((w) => ({
        inWeek: w.inWeek,
        priceInfo: { salePrice: w.to, basePrice: '57200' },
        originalPriceInfo: { salePrice: w.from, basePrice: '57340' },
      })),
    },
    priceInfos: null,
  } as JsonObject;
}

/** `updatePriceV2` 提交体的骨架。 */
function submitBody(
  goods: readonly {
    goodsId: number;
    startDate: string;
    endDate: string;
    weeks: readonly { inWeek: number[]; operateType: number; operateNum: string }[];
  }[],
): JsonObject {
  return {
    poiId: '1834077877',
    partnerId: 4824962,
    currency: 'CNY',
    createFlag: true,
    goodsList: goods.map((g) => ({
      goodsBaseInfo: { goodsId: g.goodsId },
      priceRecordWay: 8,
      weekDiff: g.weeks.length > 1,
      calcPriceUnifiedDateModel: {
        dates: [{ startDate: g.startDate, endDate: g.endDate }],
        calcPriceWeekModels: g.weeks.map((w) => ({
          inWeek: w.inWeek,
          calcPriceInfo: {
            salePrice: { operateType: w.operateType, operateNum: w.operateNum },
            basePrice: { operateType: 3, operateNum: '' },
          },
        })),
      },
    })),
  } as JsonObject;
}

/** 依次喂入多条 calc 响应，返回累积结果。 */
function accumulate(responses: readonly string[]): Record<string, MeituanCalcCell> {
  let cells: Record<string, MeituanCalcCell> = {};
  for (const response of responses) {
    const raw = toMeituanAmountChangeRaw(response);
    if (!raw) throw new Error('fixture 不该解析失败');
    cells = mergeMeituanCalcCells(cells, extractMeituanCalcCells(raw)).cells;
  }
  return cells;
}

describe('美团 calc 累积', () => {
  /**
   * `批量改房价-基础改价.md` 的真实序列。旧实现「整条覆盖」在这里只会留下最后一条 calc
   * 的那一个房型 —— 用户改了 3 个房型，RMS 只收到 1 个。这是本次改动要修的核心缺陷。
   */
  it('多次 calc 各只带一部分房型时，全部累积下来', () => {
    const cells = accumulate([
      // req0：勾选 3 个房型，初次试算（全周档）
      calcResponse([
        unifiedDetail(1135787306, '2026-08-27', '2026-08-28', [
          { inWeek: [1, 2, 3, 4, 5, 6, 7], from: '65159', to: '65000' },
        ]),
        unifiedDetail(1135800654, '2026-08-27', '2026-08-28', [
          { inWeek: [1, 2, 3, 4, 5, 6, 7], from: '67091', to: '67100' },
        ]),
        unifiedDetail(1135818026, '2026-08-27', '2026-08-28', [
          { inWeek: [1, 2, 3, 4, 5, 6, 7], from: '69023', to: '69100' },
        ]),
      ]),
      // req1：开周末差异定价，**只重算 787306**
      calcResponse([
        unifiedDetail(1135787306, '2026-08-26', '2026-08-29', [
          { inWeek: [5, 6], from: '65159', to: '65100' },
        ]),
      ]),
      // req3：改第三个房型，**只重算 818026**
      calcResponse([
        unifiedDetail(1135818026, '2026-08-26', '2026-08-29', [
          { inWeek: [1, 2, 3, 4, 7], from: '69023', to: '69000' },
        ]),
      ]),
    ]);

    // 3 个初始格 + 2 个新格（日期区间也变了，所以不覆盖而是并存）
    expect(Object.keys(cells)).toHaveLength(5);
    const goodsIds = new Set(Object.values(cells).map((cell) => cell.goodsId));
    expect(goodsIds).toEqual(new Set(['1135787306', '1135800654', '1135818026']));
  });

  /**
   * `批量改房价-高级改价.md`：同一个房型 1135806569 在两个不同日期段各被改了一次。
   * 累积键若不含日期区间，第二次会把第一次覆盖掉 —— 这是决策 1 的关键用例。
   */
  it('同房型的不同日期段不互相覆盖', () => {
    const cells = accumulate([
      calcResponse([
        unifiedDetail(1135806569, '2026-09-09', '2026-09-10', [
          { inWeek: [3, 4], from: '44432', to: '44332' },
        ]),
      ]),
      calcResponse([
        unifiedDetail(1135806569, '2026-09-03', '2026-09-04', [
          { inWeek: [4, 5], from: '44432', to: '44332' },
        ]),
      ]),
    ]);

    expect(Object.keys(cells)).toEqual([
      '1135806569|2026-09-09|2026-09-10|3,4',
      '1135806569|2026-09-03|2026-09-04|4,5',
    ]);
  });

  /**
   * 同一格改两次：第二次 calc 的 `originalPriceInfo` 已经是第一次改动的结果
   * （65159 →① 65100 →② 65000）。直接整条覆盖会让 RMS 看到「65100 → 65000」这个中间态，
   * 丢失用户操作前的真实起点。
   */
  it('同格覆盖时改前价保留首次、改后价取最新', () => {
    const cells = accumulate([
      calcResponse([
        unifiedDetail(1135787306, '2026-08-26', '2026-08-29', [
          { inWeek: [5, 6], from: '65159', to: '65100' },
        ]),
      ]),
      calcResponse([
        unifiedDetail(1135787306, '2026-08-26', '2026-08-29', [
          { inWeek: [5, 6], from: '65100', to: '65000' },
        ]),
      ]),
    ]);

    const cell = Object.values(cells)[0];
    expect(Object.keys(cells)).toHaveLength(1);
    expect(cell.originalSalePrice).toBe('65159');
    expect(cell.salePrice).toBe('65000');
    // 整条 originalPriceInfo 也搬回首次那份，不只 salePrice
    expect(cell.weekPriceInfo.originalPriceInfo).toMatchObject({ salePrice: '65159' });
  });

  /** `priceInfo` 为 null 的档是「区间内没有实际日期落入」，不是一次改动。 */
  it('跳过 priceInfo 为 null 的空档', () => {
    const cells = accumulate([
      calcResponse([
        {
          goodsBaseInfo: { goodsId: 1135787306 },
          unifiedDatePriceInfos: {
            dates: [{ startDate: '2026-08-26', endDate: '2026-08-29' }],
            weekPriceInfos: [
              { inWeek: [1, 2, 3, 4, 7], priceInfo: null, originalPriceInfo: null },
              {
                inWeek: [5, 6],
                priceInfo: { salePrice: '65100' },
                originalPriceInfo: { salePrice: '65159' },
              },
            ],
          },
          priceInfos: null,
        } as JsonObject,
      ]),
    ]);

    expect(Object.keys(cells)).toEqual(['1135787306|2026-08-26|2026-08-29|5,6']);
  });
});

describe('美团 goodsDetails 重建', () => {
  /**
   * 用户中途改了日期范围时，旧区间的格子不会被覆盖而是并存（键里含日期）。上报体不该
   * 出现用户**已经放弃**的中间状态 —— 决策 4b。
   */
  it('按提交体过滤掉过期的日期区间', () => {
    const cells = accumulate([
      calcResponse([
        unifiedDetail(1135787306, '2026-08-27', '2026-08-28', [
          { inWeek: [1, 2, 3, 4, 5, 6, 7], from: '65159', to: '65000' },
        ]),
      ]),
      calcResponse([
        unifiedDetail(1135787306, '2026-08-26', '2026-08-29', [
          { inWeek: [5, 6], from: '65159', to: '65100' },
        ]),
      ]),
    ]);
    const submit = submitBody([
      {
        goodsId: 1135787306,
        startDate: '2026-08-26',
        endDate: '2026-08-29',
        weeks: [{ inWeek: [5, 6], operateType: 6, operateNum: '65100' }],
      },
    ]);

    const details = rebuildGoodsDetails(cells, submittedGoodsDateKeys(submit)) as unknown as {
      priceInfos: { startDate: string; endDate: string }[];
    }[];

    expect(details).toHaveLength(1);
    expect(details[0].priceInfos).toHaveLength(1);
    expect(details[0].priceInfos[0]).toMatchObject({
      startDate: '2026-08-26',
      endDate: '2026-08-29',
    });
  });

  /** 形状②（`priceInfos[]`）能表达多段日期，形状①不能 —— 统一用②输出。 */
  it('统一输出形状②，整条 weekPriceInfo 原样放回', () => {
    const cells = accumulate([
      calcResponse([
        unifiedDetail(1135787306, '2026-08-26', '2026-08-29', [
          { inWeek: [5, 6], from: '65159', to: '65100' },
        ]),
      ]),
    ]);

    const details = rebuildGoodsDetails(cells) as unknown as {
      unifiedDatePriceInfos: null;
      priceInfos: { weekPriceInfos: Record<string, unknown>[] }[];
    }[];

    expect(details[0].unifiedDatePriceInfos).toBeNull();
    // basePrice 这类未参与对账的字段也在 —— 裁剪的判据是「与本次改动无关」，不是「看不懂」
    expect(details[0].priceInfos[0].weekPriceInfos[0]).toMatchObject({
      inWeek: [5, 6],
      priceInfo: { salePrice: '65100', basePrice: '57200' },
      originalPriceInfo: { salePrice: '65159' },
    });
  });
});

describe('美团 calc/update 对账', () => {
  /**
   * `批量改房价-基础改价.md` 的真实结果：提交 6 个价格档，累积的 calc 素材只覆盖 2 个。
   * 这正是对账要暴露的事实 —— 其余 4 档 RMS 不能拿来跟价。
   */
  it('提交体有而累积素材没有的档标 missing-calc', () => {
    const cells = accumulate([
      calcResponse([
        unifiedDetail(1135787306, '2026-08-26', '2026-08-29', [
          { inWeek: [5, 6], from: '65159', to: '65100' },
        ]),
      ]),
    ]);
    const submit = submitBody([
      {
        goodsId: 1135787306,
        startDate: '2026-08-26',
        endDate: '2026-08-29',
        weeks: [
          { inWeek: [1, 2, 3, 4, 7], operateType: 6, operateNum: '65100' },
          { inWeek: [5, 6], operateType: 6, operateNum: '65100' },
        ],
      },
    ]);

    const check = buildMeituanCalcUpdateCheck(submit, cells);

    expect(check.comparable).toBe(true);
    expect(check.updateOperateTypes).toEqual([6]);
    expect(check.cells).toHaveLength(2);
    expect(check.cells[0]).toMatchObject({
      inWeek: [1, 2, 3, 4, 7],
      status: 'missing-calc',
      updateValue: '65100',
      calcValue: null,
    });
    expect(check.cells[1]).toMatchObject({
      inWeek: [5, 6],
      status: 'matched',
      updateValue: '65100',
      calcValue: '65100',
    });
  });

  /**
   * `房价房量日历踩点.md` 的真实漂移：calc 说改成 470.00，用户又改回 471.00 直接提交，
   * 美团没再发 calc。照发 calc 素材会让 RMS 按一个**从未生效过的价格**跟价 —— 这比漏报
   * 危险得多，是对账存在的首要理由。
   */
  it('用户改完未再触发 calc 时标 mismatched', () => {
    const cells = accumulate([
      calcResponse([
        unifiedDetail(1135785332, '2026-08-27', '2026-08-27', [
          { inWeek: [1, 2, 3, 4, 5, 6, 7], from: '47100', to: '47000' },
        ]),
      ]),
    ]);
    const submit = submitBody([
      {
        goodsId: 1135785332,
        startDate: '2026-08-27',
        endDate: '2026-08-27',
        weeks: [{ inWeek: [1, 2, 3, 4, 5, 6, 7], operateType: 6, operateNum: '47100' }],
      },
    ]);

    const check = buildMeituanCalcUpdateCheck(submit, cells);

    expect(check.cells).toHaveLength(1);
    expect(check.cells[0]).toMatchObject({
      status: 'mismatched',
      updateValue: '47100',
      calcValue: '47000',
    });
  });

  /**
   * `改价踩点.md`：用户用的是「加价 1 元」（`operateType: 1`），`operateNum` 是**增量**
   * 不是绝对价。要比就得用原价换算 —— 那属于语义转换，desktop 不做。
   */
  it('operateType 非 6 时整份不可比', () => {
    const cells = accumulate([
      calcResponse([
        unifiedDetail(847226645, '2026-08-25', '2026-08-26', [
          { inWeek: [1, 2, 3, 4, 7], from: '24013', to: '24113' },
        ]),
      ]),
    ]);
    const submit = submitBody([
      {
        goodsId: 847226645,
        startDate: '2026-08-25',
        endDate: '2026-08-26',
        weeks: [{ inWeek: [1, 2, 3, 4, 7], operateType: 1, operateNum: '100' }],
      },
    ]);

    const check = buildMeituanCalcUpdateCheck(submit, cells);

    expect(check.comparable).toBe(false);
    expect(check.updateOperateTypes).toEqual([1]);
    // 即便这一格有 calc 素材，也不给出一致/不符的结论 —— 两个值量纲不同
    expect(check.cells[0]).toMatchObject({
      status: 'not-comparable',
      updateValue: '100',
      calcValue: '24113',
    });
  });

  /** 未踩清的 operateType 一律按不可比处理，但原值要带出去让它在 RMS 侧可见。 */
  it('未知 operateType 按不可比处理并暴露原值', () => {
    const submit = submitBody([
      {
        goodsId: 847226645,
        startDate: '2026-08-25',
        endDate: '2026-08-26',
        weeks: [{ inWeek: [1, 2, 3, 4, 7], operateType: 99, operateNum: '123' }],
      },
    ]);

    const check = buildMeituanCalcUpdateCheck(submit, {});

    expect(check.comparable).toBe(false);
    expect(check.updateOperateTypes).toEqual([99]);
    expect(check.cells[0].status).toBe('not-comparable');
  });
});
