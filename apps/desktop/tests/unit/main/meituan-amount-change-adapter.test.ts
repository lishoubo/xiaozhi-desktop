import { describe, expect, it, vi } from 'vitest';
import { createMeituanAmountChangeAdapter } from '../../../src/main/channels/meituan/amount-change-adapter';
import type { AmountParseResult } from '../../../src/main/channels/types';
import type { AmountSaveObserved } from '../../../src/shared/types/amount-change';
import type { JsonObject } from '../../../src/shared/types/json';

/** 取出 `{ kind: 'report' }` 里的上报体；不是上报（上下文/丢弃）时给 undefined。 */
function reportOf(result: AmountParseResult | null) {
  return result?.kind === 'report' ? result.report : undefined;
}

/** 取自真实踩点 `docs/踩点/美团/改价踩点.md` 的 referer —— 批量设价页。 */
const REAL_PAGE_URL = 'https://me.meituan.com/ebooking/merchant/product/batch-price';

/** 同一份踩点里的真实保存端点 URL（截去冗长的 `mtgsig` 风控参数）。 */
const REAL_ENDPOINT_URL =
  'https://me.meituan.com/api/gw/v1/product/price/updatePriceV2' +
  '?yodaReady=h5&csecplatform=4&csecversion=4.3.0';

/**
 * 踩点里的真实请求体（两条 goodsList 是两个不同房型，各自带平日/周末两档价）。
 * `goodsBaseInfo` 里与解析无关的字段保留原样，用来验证「原样透传」。
 */
const REAL_REQUEST_BODY = {
  poiId: '762662011',
  partnerId: 4595635,
  currency: 'CNY',
  createFlag: true,
  goodsList: [
    {
      goodsBaseInfo: {
        goodsId: 847226645,
        goodsName: 'I书韵I大床房（阅享静读）-不含早-入住当天18:00前免费取消-❤阅读台灯+茶包咖啡',
        preGoodsId: '64472d01da3fa7ab168924a8',
        goodsStatus: 2,
        goodsType: 1,
        sellChannel: 15,
        paymentType: 0,
        priceChangeMode: 8,
        auditStatus: 4,
        maxAdultAdmissibility: 2,
        breakFastNum: 0,
      },
      ratioConfig: { ratioType: null, ratioChange: false, newRatio: null },
      priceRecordWay: 8,
      weekDiff: true,
      calcPriceUnifiedDateModel: {
        dates: [{ startDate: '2026-08-25', endDate: '2026-08-26' }],
        calcPriceWeekModels: [
          {
            inWeek: [1, 2, 3, 4, 7],
            calcPriceInfo: { salePrice: { operateType: 1, operateNum: '100' } },
          },
          {
            inWeek: [5, 6],
            calcPriceInfo: { salePrice: { operateType: 1, operateNum: '200' } },
          },
        ],
      },
    },
    {
      goodsBaseInfo: {
        goodsId: 847317669,
        goodsName: 'I经济I 大床房（简约舒适）-不含早-入住当天18:00前免费取消-❤极速退房+免押金',
        preGoodsId: '64472d02da3fa7ab168924ad',
        goodsStatus: 2,
        goodsType: 1,
        sellChannel: 15,
        paymentType: 0,
        priceChangeMode: 8,
        auditStatus: 4,
        maxAdultAdmissibility: 2,
        breakFastNum: 0,
      },
      ratioConfig: { ratioType: null, ratioChange: false, newRatio: null },
      priceRecordWay: 8,
      weekDiff: true,
      calcPriceUnifiedDateModel: {
        dates: [{ startDate: '2026-08-25', endDate: '2026-08-26' }],
        calcPriceWeekModels: [
          {
            inWeek: [1, 2, 3, 4, 7],
            calcPriceInfo: { salePrice: { operateType: 1, operateNum: '100' } },
          },
          {
            inWeek: [5, 6],
            calcPriceInfo: { salePrice: { operateType: 1, operateNum: '200' } },
          },
        ],
      },
    },
  ],
  extendParam: {},
} as const;

/** 踩点里的真实成功响应。`data` 是异步任务串。 */
const REAL_SUCCESS_RESPONSE = JSON.stringify({
  code: 10000,
  error: null,
  traceId: '-1122036753226671259',
  data: 'hotel_sc_dealing__update_price_and_relation_4595635_762662011_3030917926517748',
  success: true,
});

// ─── 房态房量（踩点 `docs/踩点/美团/单房态房量01.md`）────────────────────────────

const REAL_ROOM_STATUS_URL =
  'https://me.meituan.com/api/gw/v1/product/goods/inventory/status/switch?yodaReady=h5&csecplatform=4';
const REAL_INVENTORY_URL =
  'https://me.meituan.com/api/gw/v1/product/goods/inventory/update?yodaReady=h5&csecplatform=4';

/** 单独关房（`status: 0`）。开房那份只差 `status: 1` 与多一个 `syncChecked`。 */
const REAL_ROOM_STATUS_BODY = {
  partnerId: 4595635,
  poiId: '762662011',
  pattern: 1,
  containerId: 221352465,
  startDate: '2026-09-30',
  endDate: '2026-09-30',
  status: 0,
  roomId: 354223780,
  limitType: 1,
  roomCategory: 1,
} as const;

/**
 * 改房量 —— ⚠️ 同一请求里**房态与房量并存**：`invSwitch` 是房态，`countType`/`count`/
 * `limitChangeValue` 是房量。两个日期段各带一组参数。
 */
const REAL_INVENTORY_BODY = {
  poiId: '762662011',
  partnerId: 4595635,
  changeType: 1,
  modifyInventoryModelList: [
    {
      modifyInventorySubjectsModel: {
        goodsIdList: [],
        dayRoomIdList: [354223780],
        hourRoomIdList: [],
      },
      separateOperateInvDateList: [
        {
          startDate: '2026-09-30',
          endDate: '2026-09-30',
          modifyParamByEffectWeek: [
            {
              effectWeek: [1, 2, 3, 4, 5, 6, 7],
              updateInventoryUnifyInvUnitParam: {
                invSwitch: 1,
                countType: 1526,
                limitChangeValue: 3,
                count: 1,
              },
            },
          ],
        },
        {
          startDate: '2026-09-29',
          endDate: '2026-09-29',
          modifyParamByEffectWeek: [
            {
              effectWeek: [1, 2, 3, 4, 5, 6, 7],
              updateInventoryUnifyInvUnitParam: {
                invSwitch: 0,
                countType: 1020,
                limitChangeValue: 0,
                count: 0,
              },
            },
          ],
        },
      ],
    },
  ],
} as const;

const REAL_ROOM_CLOSE_URL =
  'https://me.meituan.com/api/gw/v1/product/goods/inventory/roomstatus/submitaudit?yodaReady=h5';

/**
 * **关房**的真实请求体（踩点 `docs/踩点/美团/关房.md`）。
 *
 * ⚠️ 与开房形状不同：日期是单个 `date`（不是 startDate/endDate），多了 `goodsIds`、
 * `reason`、`roomName`。端点也不同（要走审核）。
 */
const REAL_ROOM_CLOSE_BODY = {
  partnerId: 4720332,
  poiId: '1756785213',
  pattern: 1,
  containerId: 282464264,
  date: '2026-08-17',
  status: 0,
  roomId: 413866969,
  goodsIds: [952161333, 2429288289, 2429295192],
  limitType: 1,
  roomName: '悦享大床房',
  roomCategory: 1,
  reason: '',
} as const;

/** 房态房量的真实成功响应 —— 与改价同构（`code` + `success`），只有 `data` 是布尔。 */
const ROOM_STATUS_SUCCESS_RESPONSE = JSON.stringify({
  code: 10000,
  error: null,
  traceId: '4981198717741582555',
  data: true,
  success: true,
});

function createLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function observedWith(requestBody: JsonObject): AmountSaveObserved {
  return {
    endpointId: 'updatePriceV2',
    endpointUrl: REAL_ENDPOINT_URL,
    requestBody,
    responseBody: REAL_SUCCESS_RESPONSE,
    pageUrl: REAL_PAGE_URL,
  };
}

/** 试算端点的真实 URL（`docs/踩点/美团/改价踩点2.md`）。 */
const REAL_CALC_URL =
  'https://me.meituan.com/api/gw/v1/product/price/separate/calcPriceV2?yodaReady=h5';

/**
 * 试算请求体 —— 与提交体的差别：多一个 `operateType`，没有 `createFlag`，且
 * `goodsList[]` 里同时带着**当前价**（`unifiedDatePriceInfos`）与操作指令。
 */
const REAL_CALC_REQUEST_BODY = {
  poiId: '762662011',
  partnerId: 4595635,
  currency: 'CNY',
  goodsList: [
    {
      goodsBaseInfo: { goodsId: 847226645, goodsName: 'I书韵I大床房（阅享静读）' },
      priceRecordWay: 8,
      weekDiff: true,
      operateType: 1,
      calcPriceUnifiedDateModel: {
        dates: [{ startDate: '2026-08-25', endDate: '2026-08-26' }],
        calcPriceWeekModels: [
          {
            inWeek: [1, 2, 3, 4, 7],
            calcPriceInfo: { salePrice: { operateType: 1, operateNum: '100' } },
          },
        ],
      },
    },
  ],
} as const;

/**
 * 试算的真实响应（`改价踩点2.md` 第一条，只截去与解析无关的静态字段）。
 *
 * 三处关键：
 * - `unifiedDatePriceInfos.weekPriceInfos[].inWeek` = `[1,2,3,4,7]`，**与请求的周次档一致**
 * - `realPriceInfos[].weekPriceInfos[].inWeek` = `[2,3]`，服务端按区间内实际日期重拆过，
 *   **与请求档对不上** —— 这正是它必须被剔掉的理由
 * - `priceInfo`（改后 24113 = 241.13 元）与 `originalPriceInfo`（改前 24013 = 240.13 元）
 *   成对出现，这是 RMS 算绝对价的唯一素材
 */
const REAL_CALC_RESPONSE = JSON.stringify({
  code: 10000,
  error: null,
  traceId: '7960274533135046393',
  data: {
    goodsDetails: [
      {
        goodsBaseInfo: {
          goodsId: 847226645,
          goodsName: 'I书韵I大床房（阅享静读）',
          preGoodsId: '64472d01da3fa7ab168924a8',
          goodsStatus: 2,
        },
        priceRecordWay: 8,
        pricePrompt: { prompts: [], noPriceDates: null },
        unifiedDatePriceInfos: {
          dates: [{ startDate: '2026-08-25', endDate: '2026-08-26' }],
          weekPriceInfos: [
            {
              inWeek: [1, 2, 3, 4, 7],
              priceInfo: { salePrice: '24113', basePrice: '20978', subPrice: '3135' },
              originalPriceInfo: { salePrice: '24013', basePrice: '20891', subPrice: '3122' },
            },
          ],
        },
        priceInfos: null,
        realPriceInfos: [
          {
            startDate: '2026-08-25',
            endDate: '2026-08-26',
            weekPriceInfos: [
              {
                inWeek: [2, 3],
                priceInfo: { salePrice: '24113' },
                originalPriceInfo: { salePrice: '24013' },
              },
            ],
          },
        ],
        weekDiff: true,
        ratioConfig: { ratioType: null, ratioChange: false, newRatio: null },
      },
    ],
    globalPricePrompt: { prompts: null, unifiedSubRatio: null },
  },
  success: true,
});

function calcObserved(
  overrides: Partial<AmountSaveObserved> = {},
): AmountSaveObserved {
  return {
    endpointId: 'calcPriceV2',
    endpointUrl: REAL_CALC_URL,
    requestBody: REAL_CALC_REQUEST_BODY as unknown as JsonObject,
    responseBody: REAL_CALC_RESPONSE,
    pageUrl: REAL_PAGE_URL,
    ...overrides,
  };
}

/** 取出 `{ kind: 'context' }` 里的上下文；不是上下文时给 undefined。 */
function contextOf(result: AmountParseResult | null) {
  return result?.kind === 'context' ? result.context : undefined;
}

describe('美团价量态改动适配器', () => {
  describe('isWatchableUrl', () => {
    it('认踩点里的批量设价页', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl(REAL_PAGE_URL)).toBe(true);
    });

    it('认同一商品模块下的兄弟路由（前缀匹配，避免漏认导致监听被整个关掉）', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(
        adapter.isWatchableUrl('https://me.meituan.com/ebooking/merchant/product/price-calendar'),
      ).toBe(true);
    });

    it('不认美团站内的其他页面', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl('https://me.meituan.com/ebooking/merchant/order/list')).toBe(
        false,
      );
    });

    it('不认非可信域名与非 HTTPS', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl('https://evil.example.com/ebooking/merchant/product')).toBe(
        false,
      );
      expect(adapter.isWatchableUrl('http://me.meituan.com/ebooking/merchant/product')).toBe(false);
    });
  });

  describe('isSuccessful', () => {
    it('踩点的真实成功响应判为成功', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful(REAL_SUCCESS_RESPONSE, 'updatePriceV2')).toBe(true);
    });

    it('网关码非 10000 判为失败', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(
        adapter.isSuccessful(
          JSON.stringify({ code: 10001, error: '限价规则不通过', data: null, success: false }),
          'updatePriceV2',
        ),
      ).toBe(false);
    });

    it('code 为 10000 但 success 为 false 时仍判失败（保守口径）', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(
        adapter.isSuccessful(JSON.stringify({ code: 10000, error: null, success: false }), 'updatePriceV2'),
      ).toBe(false);
    });

    it('响应体不是 JSON 时判为失败', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful('<html>502 Bad Gateway</html>', 'updatePriceV2')).toBe(false);
    });
  });

  /**
   * 提交（`updatePriceV2`）只当**触发器** —— 它的请求体一个字节都不上报，上报的是存着的
   * 那条试算。所以这一组断言的重点是「发出去的内容来自 calc 而不是 update」。
   */
  describe('parse — updatePriceV2（触发器）', () => {
    /** 一次完整的试算上下文，形状与 `parse` 处理 calc 后交出的一致。 */
    function calcContext(overrides: JsonObject = {}): JsonObject {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const context = contextOf(adapter.parse(calcObserved(), null)) as JsonObject;
      return { ...context, ...overrides };
    }

    it('上报的是试算结果，提交体不发', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const context = calcContext();

      const report = reportOf(adapter.parse(observedWith({ ...REAL_REQUEST_BODY }), context));

      expect(report?.source).toBe('meituan');
      // endpointId / endpointUrl 都指向试算那次 —— 内容出处要如实
      expect(report?.endpointId).toBe('calcPriceV2');
      expect(report?.endpointUrl).toBe(REAL_CALC_URL);
      expect(report?.otaHotelId).toBe('762662011');
      // changeRaw 的内容来自**试算**，不是提交体 —— 后者只有「+1 元」这类相对操作，
      // RMS 既算不出绝对价也无从校验。提交体的字段一个都不该出现在里面。
      expect(report?.changeRaw).not.toHaveProperty('createFlag');
      expect(report?.changeRaw).not.toHaveProperty('goodsList');
      // 累积的格子重建成 goodsDetails[]，形状与 calc 响应一致
      expect(report?.changeRaw.goodsDetails).toBeInstanceOf(Array);
      expect(Object.keys(context.cells as JsonObject)).toHaveLength(1);
    });

    /** 改前 189.66 → 改后 190.66，这是 RMS 跟价唯一要的东西。 */
    it('上报体里能读到改前价与改后价', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      const report = reportOf(
        adapter.parse(observedWith({ ...REAL_REQUEST_BODY }), calcContext()),
      );
      // 重建统一输出**形状②**（`priceInfos[]`）—— 它能表达多段日期，形状①不能。
      const data = report?.changeRaw as unknown as {
        goodsDetails: {
          priceInfos: { weekPriceInfos: Record<string, unknown>[] }[];
        }[];
      };
      const week = data.goodsDetails[0].priceInfos[0].weekPriceInfos[0];

      expect(week.originalPriceInfo).toMatchObject({ salePrice: '24013' });
      expect(week.priceInfo).toMatchObject({ salePrice: '24113' });
      expect(week.inWeek).toEqual([1, 2, 3, 4, 7]);
      // ⚠️ 整条原样放回 —— basePrice / subPrice 这些也在，不只 salePrice
      expect(week.priceInfo).toMatchObject({ basePrice: '20978', subPrice: '3135' });
    });

    /**
     * 一次改价打两遍同一个端点（②预检 `false` → ③执行 `true`），请求体只差这一个字段、
     * 响应完全一样。不过滤会重复上报，且②的 success 只代表「请确认」—— 用户点取消就是假成功。
     */
    it('createFlag 为 false 的预检请求不上报，只记 info', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      const result = adapter.parse(
        observedWith({ ...REAL_REQUEST_BODY, createFlag: false }),
        calcContext(),
      );

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        'Meituan amount change: pre-check request (createFlag not true), not reporting',
        expect.objectContaining({ createFlag: false }),
      );
      // 不是硬错误，不该 warn
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('createFlag 缺失时同样不上报（只认显式 true）', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const withoutFlag = { ...REAL_REQUEST_BODY } as Record<string, unknown>;
      delete withoutFlag.createFlag;

      expect(adapter.parse(observedWith(withoutFlag as JsonObject), calcContext())).toBeNull();
    });

    it('取不到任何 goodsId 时返回 null 并 warn（拦到的不是改价请求）', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      const result = adapter.parse(
        observedWith({ poiId: '762662011', createFlag: true, goodsList: [] }),
        calcContext(),
      );

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Meituan amount change: request body had no goodsId',
        expect.objectContaining({ endpointId: 'updatePriceV2' }),
      );
    });

    /** 没有试算就没有可上报的内容 —— 提交体那份相对操作对 RMS 是死信息，宁可丢弃。 */
    it('没有试算结果时丢弃并 warn', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      const result = adapter.parse(observedWith({ ...REAL_REQUEST_BODY }), null);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Meituan amount change: no calcPriceV2 result to report, dropping',
        expect.objectContaining({ goodsIds: ['847226645', '847317669'], hasContext: false }),
      );
    });

    it('上下文形状不认识时同样丢弃', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      expect(
        adapter.parse(observedWith({ ...REAL_REQUEST_BODY }), { something: 'else' }),
      ).toBeNull();
    });

    /** 门店 ID 取自试算那次；试算里缺了才退回提交体。 */
    it('试算缺 poiId 时退回提交体里的 poiId', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      const report = reportOf(
        adapter.parse(observedWith({ ...REAL_REQUEST_BODY }), calcContext({ otaHotelId: '' })),
      );

      expect(report?.otaHotelId).toBe('762662011');
    });

    it('两处都没有 poiId 时留空串让 RMS 靠 goodsId 反查并 warn', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      const report = reportOf(
        adapter.parse(
          observedWith({ createFlag: true, goodsList: [{ goodsBaseInfo: { goodsId: 847226645 } }] }),
          calcContext({ otaHotelId: '' }),
        ),
      );

      expect(report).toBeDefined();
      expect(report?.otaHotelId).toBe('');
      expect(logger.warn).toHaveBeenCalledWith(
        'Meituan amount change: no poiId, RMS will resolve by goodsId',
        expect.objectContaining({ goodsIds: ['847226645'] }),
      );
    });
  });

  /**
   * 试算端点：**上报的素材就是它**，但此刻不能发（用户可能算完不提交），先存着。
   * 提交那条只当触发器。
   */
  describe('parse — calcPriceV2（上报素材）', () => {
    it('先存着不发 —— 用户可能算完不提交', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      const result = adapter.parse(calcObserved(), null);

      expect(result?.kind).toBe('context');
      expect(reportOf(result)).toBeUndefined();
    });

    /**
     * 多次试算按格累积 —— 美团只重算用户当次触碰的那部分，整条覆盖会丢掉先算的房型。
     */
    it('多次试算累积到同一份 cells 里', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      const first = contextOf(adapter.parse(calcObserved(), null)) as JsonObject;
      // 第二次试算换一个房型（美团只会带这一个）
      const second = contextOf(
        adapter.parse(
          calcObserved({
            responseBody: REAL_CALC_RESPONSE.replace('847226645', '847317669'),
          }),
          first,
        ),
      ) as JsonObject;

      // 两个房型的格子都在，先算的没被挤掉
      expect(Object.keys(second.cells as JsonObject)).toEqual([
        '847226645|2026-08-25|2026-08-26|1,2,3,4,7',
        '847317669|2026-08-25|2026-08-26|1,2,3,4,7',
      ]);
    });

    /**
     * 用户在同一个页面切到另一家门店：上一家的素材与这次改动无关。累积键里没有 poiId，
     * 不重置会让两家的格子混在一条上报里。
     */
    it('门店变了就丢掉已累积的素材', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      const first = contextOf(adapter.parse(calcObserved(), null)) as JsonObject;
      const second = contextOf(
        adapter.parse(
          calcObserved({
            requestBody: { ...REAL_CALC_REQUEST_BODY, poiId: '999888777' } as JsonObject,
          }),
          first,
        ),
      ) as JsonObject;

      expect(second.otaHotelId).toBe('999888777');
      // 上一家的那格不该跟过来
      expect(Object.keys(second.cells as JsonObject)).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledWith(
        'Meituan amount change: poiId changed, resetting accumulated calc cells',
        expect.objectContaining({ previousOtaHotelId: '762662011', otaHotelId: '999888777' }),
      );
    });

    /** 门店 ID 与 URL 只有试算这一刻拿得到，要跟结果一起存下。 */
    it('存下试算结果，连同只此刻可得的门店 ID 与 URL', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      const context = contextOf(adapter.parse(calcObserved(), null));

      expect(context?.otaHotelId).toBe('762662011');
      expect(context?.endpointUrl).toBe(REAL_CALC_URL);
      // 试算请求体整个不留 —— 它那份当前价是「元」，与响应的「分」量纲不一致，且是冗余
      expect(context).not.toHaveProperty('requestBody');

      // 存的是**按格累积**的素材（不再是一份成品 changeRaw）——
      // 键 = goodsId|startDate|endDate|inWeek，见 meituanCalcCellKey
      const cells = context?.cells as Record<string, Record<string, unknown>>;
      expect(Object.keys(cells)).toEqual(['847226645|2026-08-25|2026-08-26|1,2,3,4,7']);

      const cell = Object.values(cells)[0];
      expect(cell.goodsId).toBe('847226645');
      expect(cell.startDate).toBe('2026-08-25');
      expect(cell.endDate).toBe('2026-08-26');
      expect(cell.inWeek).toEqual([1, 2, 3, 4, 7]);
      expect(cell.originalSalePrice).toBe('24013');
      expect(cell.salePrice).toBe('24113');
      // 整条 weekPriceInfo 原样留着 —— 语义未确认的字段更要留（见 payload 文件头）
      expect(cell.weekPriceInfo).toMatchObject({
        priceInfo: { salePrice: '24113', basePrice: '20978', subPrice: '3135' },
        originalPriceInfo: { salePrice: '24013', basePrice: '20891', subPrice: '3122' },
      });
    });

    // 裁剪规则（剔 realPriceInfos、goodsBaseInfo 收成 goodsId、语义未知的一律保留）
    // 归 `amount-change-payload.ts` 管，测试在 `meituan-amount-change-payload.test.ts`。

    /** 认不出的响应形状：返回 null 让机制层留着上一条，宁可用旧的也不要存个空壳。 */
    it('响应形状不认识时返回 null 并 warn（不覆盖上一条）', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      expect(adapter.parse(calcObserved({ responseBody: '<html>502</html>' }), null)).toBeNull();
      expect(
        adapter.parse(calcObserved({ responseBody: '{"code":10000,"data":null}' }), null),
      ).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Meituan amount change: unrecognised calcPriceV2 response, keeping previous',
        expect.objectContaining({ bodySnippet: expect.any(String) }),
      );
    });

    /** 试算请求体里没有 `createFlag` —— 不能被当成「预检」一并丢掉。 */
    it('没有 createFlag 也照常收成上下文', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      expect(REAL_CALC_REQUEST_BODY).not.toHaveProperty('createFlag');
      expect(adapter.parse(calcObserved(), null)?.kind).toBe('context');
    });
  });

  describe('watchedEndpoints', () => {
    it('拦改价两个端点 + 房态房量三个端点', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      expect([...adapter.watchedEndpoints.entries()]).toEqual([
        ['updatePriceV2', '/api/gw/v1/product/price/updatePriceV2'],
        ['calcPriceV2', '/api/gw/v1/product/price/separate/calcPriceV2'],
        ['inventory-status-switch', '/api/gw/v1/product/goods/inventory/status/switch'],
        [
          'inventory-roomstatus-submitaudit',
          '/api/gw/v1/product/goods/inventory/roomstatus/submitaudit',
        ],
        ['inventory-update', '/api/gw/v1/product/goods/inventory/update'],
      ]);
    });

    /**
     * ⚠️ **回归护栏**：开房与关房**不是同一个端点**（2026-08-13 真机联调发现）。
     * 最初只认了 `status/switch`，关房一次都拦不到 —— 而失效方式极具迷惑性：日志里
     * 全是之前开房留下的 `status: 1`，看起来「有上报」，实际关房全丢了。
     */
    it('关房端点独立于开房端点', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());

      expect(adapter.watchedEndpoints.get('inventory-roomstatus-submitaudit')).toBe(
        '/api/gw/v1/product/goods/inventory/roomstatus/submitaudit',
      );
      expect(adapter.watchedEndpoints.get('inventory-status-switch')).toBe(
        '/api/gw/v1/product/goods/inventory/status/switch',
      );
    });

    /**
     * 关房成功后美团会紧跟着发 `order/others/deductRoomCount` 扣减房量。
     * 它是关房的**连带后果**，不是独立操作 —— 拦了会让一次关房产生两条上报。
     */
    it('不拦 deductRoomCount —— 它是关房的连带扣量，拦了会重复上报', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const deductUrl =
        'https://me.meituan.com/api/gw/v1/order/others/deductRoomCount?yodaReady=h5';

      const matched = [...adapter.watchedEndpoints.values()].filter((fragment) =>
        deductUrl.includes(fragment),
      );
      expect(matched).toEqual([]);
    });

    /**
     * ⚠️ **回归护栏**：改房量时美团会先打 `check` 再打 `update`，两者请求体**逐字节相同**。
     * 拦了 check 就会把一次改动上报两遍，而两条的 operationId 不同、RMS 幂等挡不住，
     * 会被当成用户改了两次。与抖音「只收 save_* 不收 check_*」同一类问题。
     */
    it('不拦 inventory/check —— 它与 update 请求体相同，拦了会重复上报', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const checkUrl = 'https://me.meituan.com/api/gw/v1/product/goods/inventory/check?yodaReady=h5';

      const matched = [...adapter.watchedEndpoints.values()].filter((fragment) =>
        checkUrl.includes(fragment),
      );
      expect(matched).toEqual([]);
    });

    /** `matchEndpoint` 是首个命中即返回，片段之间不能有包含关系。 */
    it('四个端点片段互不为子串', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const fragments = [...adapter.watchedEndpoints.values()];

      for (const a of fragments) {
        for (const b of fragments) {
          if (a === b) continue;
          expect(a.includes(b)).toBe(false);
        }
      }
    });

    it('四个端点各自只命中自己的 URL', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const matchOne = (url: string) =>
        [...adapter.watchedEndpoints.entries()]
          .filter(([, fragment]) => url.includes(fragment))
          .map(([id]) => id);

      expect(matchOne(REAL_ENDPOINT_URL)).toEqual(['updatePriceV2']);
      expect(matchOne(REAL_CALC_URL)).toEqual(['calcPriceV2']);
      expect(matchOne(REAL_ROOM_STATUS_URL)).toEqual(['inventory-status-switch']);
      expect(matchOne(REAL_INVENTORY_URL)).toEqual(['inventory-update']);
    });

    /** 两个端点的路径前缀有重叠，匹配是 `url.includes`，别把试算认成保存。 */
    it('真实 URL 各自命中自己的端点', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const calcFragment = adapter.watchedEndpoints.get('calcPriceV2') as string;
      const updateFragment = adapter.watchedEndpoints.get('updatePriceV2') as string;

      expect(REAL_CALC_URL).toContain(calcFragment);
      expect(REAL_CALC_URL).not.toContain(updateFragment);
      expect(REAL_ENDPOINT_URL).toContain(updateFragment);
      expect(REAL_ENDPOINT_URL).not.toContain(calcFragment);
    });
  });

  /**
   * 房态房量 —— 与改价那条路完全独立：不需要试算素材，当场就能上报；请求体也没有一个
   * 字段与改价同名。
   */
  describe('parse — 房态房量', () => {
    const roomStatusObserved = (
      endpointId: string,
      requestBody: JsonObject,
      endpointUrl: string,
    ): AmountSaveObserved => ({
      endpointId,
      endpointUrl,
      requestBody,
      responseBody: ROOM_STATUS_SUCCESS_RESPONSE,
      pageUrl: 'https://me.meituan.com/ebooking/merchant/product',
    });

    it('单独关房：changeType 为 roomStatus，门店取 poiId', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved('inventory-status-switch', REAL_ROOM_STATUS_BODY, REAL_ROOM_STATUS_URL),
          null,
        ),
      );

      expect(report?.changeType).toBe('roomStatus');
      expect(report?.endpointId).toBe('inventory-status-switch');
      expect(report?.otaHotelId).toBe('762662011');
      // 开关方向由 RMS 从 changeRaw 读 —— desktop 不解读渠道语义。
      expect(report?.changeRaw).toEqual(REAL_ROOM_STATUS_BODY);
    });

    it('单独开房：与关房同一个 endpointId，只有 status 不同', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved(
            'inventory-status-switch',
            { ...REAL_ROOM_STATUS_BODY, status: 1, syncChecked: false },
            REAL_ROOM_STATUS_URL,
          ),
          null,
        ),
      );

      expect(report?.endpointId).toBe('inventory-status-switch');
      expect(report?.changeRaw).toMatchObject({ status: 1 });
    });

    /**
     * ⚠️ 关房走独立端点 `roomstatus/submitaudit`（要走审核），与开房的 `status/switch`
     * 不是同一条路。2026-08-13 真机联调发现 —— 之前只认开房那个端点，关房全丢。
     */
    it('关房：独立 endpointId，goodsIds 与 date 都在 changeRaw 里', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved(
            'inventory-roomstatus-submitaudit',
            REAL_ROOM_CLOSE_BODY,
            REAL_ROOM_CLOSE_URL,
          ),
          null,
        ),
      );

      expect(report?.changeType).toBe('roomStatus');
      expect(report?.endpointId).toBe('inventory-roomstatus-submitaudit');
      expect(report?.otaHotelId).toBe('1756785213');
      // 关房恒为 status 0；goodsIds 是 RMS 反查的直接依据；date 是单值不是区间。
      expect(report?.changeRaw).toEqual(REAL_ROOM_CLOSE_BODY);
    });

    /** `goodsIds` 与改价的 goodsId 同源（RMS 台账的 ota_sale_room_type_id），必须能定位。 */
    it('关房：只有 goodsIds 没有 roomId 时仍能定位', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved(
            'inventory-roomstatus-submitaudit',
            { poiId: '1756785213', status: 0, date: '2026-08-17', goodsIds: [952161333] },
            REAL_ROOM_CLOSE_URL,
          ),
          null,
        ),
      );

      expect(report?.changeType).toBe('roomStatus');
    });

    it('改房量：changeType 为 roomStatus，用自己的 endpointId', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved('inventory-update', REAL_INVENTORY_BODY, REAL_INVENTORY_URL),
          null,
        ),
      );

      expect(report?.changeType).toBe('roomStatus');
      expect(report?.endpointId).toBe('inventory-update');
      expect(report?.otaHotelId).toBe('762662011');
    });

    /**
     * ⚠️ **回归护栏**：`countType`（1526/1020/1620/1720 四个值对应房量设值/清零/+1/-1）、
     * `invSwitch`、`limitChangeValue`、`count` 目前都没踩清语义 —— **看不懂正是不能剔的
     * 理由**：剔了永久丢失，留着 RMS 日后踩清就能直接用。这条防止日后有人「顺手清理」。
     */
    it('房量语义字段全部原样保留，一个不剔', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved('inventory-update', REAL_INVENTORY_BODY, REAL_INVENTORY_URL),
          null,
        ),
      );

      expect(report?.changeRaw).toEqual(REAL_INVENTORY_BODY);
    });

    /**
     * 一次 update 就是用户的一次操作 —— 房态（invSwitch）与房量（count）并存时**只发一条**。
     * 拆成两条会生成两个 operationId，让 RMS 以为用户改了两次。
     */
    it('房态房量并存时只产出一条上报', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const result = adapter.parse(
        roomStatusObserved('inventory-update', REAL_INVENTORY_BODY, REAL_INVENTORY_URL),
        null,
      );

      expect(result?.kind).toBe('report');
      const params =
        REAL_INVENTORY_BODY.modifyInventoryModelList[0].separateOperateInvDateList[0]
          .modifyParamByEffectWeek[0].updateInventoryUnifyInvUnitParam;
      // 同一条上报里房态与房量都在。
      expect(params).toMatchObject({ invSwitch: 1, count: 1 });
    });

    /** 钟点房走 hourRoomIdList —— 只收 dayRoomIdList 会把这种场景误判成「没有房型」而丢弃。 */
    it('只有 hourRoomIdList 有值时照常上报', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved(
            'inventory-update',
            {
              poiId: '762662011',
              modifyInventoryModelList: [
                {
                  modifyInventorySubjectsModel: {
                    goodsIdList: [],
                    dayRoomIdList: [],
                    hourRoomIdList: [354223999],
                  },
                  separateOperateInvDateList: [],
                },
              ],
            },
            REAL_INVENTORY_URL,
          ),
          null,
        ),
      );

      expect(report?.changeType).toBe('roomStatus');
    });

    it('房型标识全空时返回 null 并记 warn', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      expect(
        adapter.parse(
          roomStatusObserved(
            'inventory-update',
            {
              poiId: '762662011',
              modifyInventoryModelList: [
                {
                  modifyInventorySubjectsModel: {
                    goodsIdList: [],
                    dayRoomIdList: [],
                    hourRoomIdList: [],
                  },
                },
              ],
            },
            REAL_INVENTORY_URL,
          ),
          null,
        ),
      ).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('房态请求体没有 roomId 时返回 null', () => {
      const logger = createLogger();
      const adapter = createMeituanAmountChangeAdapter(logger);

      expect(
        adapter.parse(
          roomStatusObserved(
            'inventory-status-switch',
            { poiId: '762662011', status: 0 },
            REAL_ROOM_STATUS_URL,
          ),
          null,
        ),
      ).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    /** 房态房量不参与改价的 calc/update 配对，没有素材也能直接上报。 */
    it('不需要试算上下文', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const report = reportOf(
        adapter.parse(
          roomStatusObserved('inventory-status-switch', REAL_ROOM_STATUS_BODY, REAL_ROOM_STATUS_URL),
          null,
        ),
      );

      expect(report).toBeDefined();
    });
  });

  describe('isSuccessful — 房态房量', () => {
    /** 响应与改价同构，只有 data 从任务串变成布尔；判定看的是 code + success。 */
    it('data 为布尔的真实成功响应判为成功', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful(ROOM_STATUS_SUCCESS_RESPONSE, 'inventory-update')).toBe(true);
    });

    it('success 为 false 时判为失败', () => {
      const adapter = createMeituanAmountChangeAdapter(createLogger());
      const rejected = JSON.stringify({ code: 10000, error: '房态修改失败', data: false, success: false });
      expect(adapter.isSuccessful(rejected, 'inventory-status-switch')).toBe(false);
    });
  });
});
