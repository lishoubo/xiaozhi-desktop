import { describe, expect, it, vi } from 'vitest';
import { createCtripAmountChangeAdapter } from '../../../src/main/channels/ctrip/amount-change-adapter';
import type { AmountParseResult } from '../../../src/main/channels/types';
import type { AmountSaveObserved } from '../../../src/shared/types/amount-change';
import type { JsonObject } from '../../../src/shared/types/json';

/** 取出 `{ kind: 'report' }` 里的上报体；不是上报（上下文/丢弃）时给 undefined。 */
function reportOf(result: AmountParseResult | null) {
  return result?.kind === 'report' ? result.report : undefined;
}

/** 取自真实踩点 `docs/踩点/携程/改价.md` 的 referer —— 房价日历页。 */
const REAL_PAGE_URL = 'https://ebooking.ctrip.com/ebkovsroom/inventory/calendar?microJump=true';

/**
 * 同一份踩点里的真实请求体（去掉冗长的 roomName 空白填充）。两条 roomPriceInfoList 是
 * 同一房型的平日/周末两档价，`refRoomIDs` 是联动房型。
 */
const REAL_REQUEST_BODY = {
  roomPriceInfoList: [
    {
      roomTypeID: 1587157432,
      roomName: '悦享大床房<双早> 预付 1587157432',
      hotelID: 115348672,
      payType: 'PP',
      currency: 'RMB',
      mealNum: 2,
      weekDayIndex: '1111001',
      costPrice: 432.66,
      salePrice: 509.01,
      commissionRate: 0.15,
      commissionValue: null,
      serviceFeeRate: 0,
      refRoomIDs: [1582872853],
      invertRefRoomIDs: [],
    },
    {
      roomTypeID: 1587157432,
      roomName: '悦享大床房<双早> 预付 1587157432',
      hotelID: 115348672,
      payType: 'PP',
      currency: 'RMB',
      mealNum: 2,
      weekDayIndex: '0000110',
      costPrice: 432.67,
      salePrice: 509.02,
      commissionRate: 0.15,
      commissionValue: null,
      serviceFeeRate: 0,
      refRoomIDs: [1582872853],
      invertRefRoomIDs: [],
    },
  ],
  dateRangeInfo: [{ startDate: '2026-08-19', endDate: '2026-08-19' }],
  pageType: 'T',
  weekend: '0000110',
  priceChangeMode: 2,
  checkIllegalCommission: 'T',
} as const;

/** 踩点里的真实成功响应。 */
const REAL_SUCCESS_RESPONSE = JSON.stringify({
  code: 200,
  message: null,
  totalCount: 0,
  returnCode: null,
  data: {
    roomPriceSetResults: [
      {
        resultCode: 0,
        resultMessage: 'Success',
        reqID: 24901486287,
        reqStatus: 'A',
        statusDesc: '房价设置成功',
        hotelID: 115348672,
        roomTypeList: [1587157432, 1582872853],
      },
      {
        resultCode: 0,
        resultMessage: 'Success',
        reqID: 24901486343,
        reqStatus: 'A',
        statusDesc: '房价设置成功',
        hotelID: 115582769,
        roomTypeList: null,
      },
    ],
    roomPriceSetMode: 1,
  },
  otherData: null,
  extendData: null,
});

/**
 * 新模块 `setRCRoomPrice` 的真实请求体（取自踩点 `改价踩点02.md`，去掉与解析无关的
 * `reqHead`/`cipher`/`head` 等框架字段）。**注意没有任何门店 ID 字段。**
 */
const NEW_MODULE_REQUEST_BODY = {
  roomPriceInfos: [
    {
      roomProductId: '1587157522',
      startDate: '2026-08-25',
      endDate: '2026-08-26',
      priceChangeMode: 'sale_commissionRate',
      salePrice: 720,
      costPrice: 611.71,
      commissionRate: 0.1504,
      currency: 'RMB',
      mealNum: 0,
      excludedRelationRoomProductIds: [],
      weekDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    },
    {
      roomProductId: '1587157528',
      startDate: '2026-08-25',
      endDate: '2026-08-26',
      priceChangeMode: 'sale_commissionRate',
      salePrice: 794,
      costPrice: 673.55,
      commissionRate: 0.1517,
      currency: 'RMB',
      mealNum: 2,
      excludedRelationRoomProductIds: [],
      weekDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
    },
  ],
  isFixedCommission: false,
  dateRanges: [{ startDate: '2026-08-25', endDate: '2026-08-26' }],
  priceChangeMode: 'priceMode',
  diffWeekendPrice: false,
} as const;

/** 新模块的真实成功响应（同一份踩点）。 */
const NEW_MODULE_SUCCESS_RESPONSE = JSON.stringify({
  taskId: 'c6e80580-883d-4e97-a0a1-02bb02b772d8_202608',
  resStatus: { rcode: 200, rmsg: '' },
  ResponseStatus: {
    Timestamp: '/Date(1786437409094+0800)/',
    Ack: 'Success',
    Errors: [],
    Extension: [{ Id: 'CLOGGING_TRACE_ID', Value: '1f9b27f0-ee1b-945d-b228-e36f8da0203c' }],
  },
});

/**
 * 房态「关房」的真实请求体（踩点 `docs/踩点/携程/房量01.md`）。开房那份只差
 * `roomStatus: 'G'`，整个请求体其余部分逐字节相同 —— 所以不拆两个 endpointId。
 */
const REAL_CLOSE_ROOM_BODY = {
  hotelRoomInfoDtoList: [
    {
      hotelID: 115348672,
      roomTypeID: 1587157431,
      roomName: '&#24742;&#20139;&#22823;&#24202;&#25151;&lt;&#21333;&#26089;&gt;',
    },
  ],
  dateItemInfoDtoList: [
    {
      startDate: '2026-08-31',
      endDate: '2026-08-31',
      holidyInfo: [
        { name: '中秋节', startDate: '2026-09-24', endDate: '2026-09-27', activeFlag: false, published: true },
        { name: '国庆节', startDate: '2026-09-30', endDate: '2026-10-07', activeFlag: false, published: true },
      ],
    },
  ],
  weekDayIndex: '1111111',
  pageType: 'F',
  processType: 3,
  roomStatus: 'N',
  originalRoomProductIds: [1587157431],
} as const;

/**
 * 房态端点的真实成功响应（同一份踩点，开房/关房共用）。
 *
 * ⚠️ **`data` 是 `null`** —— 这个端点没有内层结果明细。对比改价老模块的
 * `REAL_SUCCESS_RESPONSE`（`data.roomPriceSetResults[]` 才是判据），两者形状不同，
 * 这正是 `isSuccessful` 必须收 `endpointId` 的原因。
 */
const ROOM_STATUS_SUCCESS_RESPONSE = JSON.stringify({
  code: 200,
  message: '房态设置成功。',
  totalCount: 0,
  returnCode: '200',
  data: null,
  otherData: '房态设置成功。',
  extendData: [],
});

/**
 * 「统一加减价」的真实请求体 —— 踩点 `docs/踩点/携程/房价维护菜单踩点.md` 第三例。
 * 与 `setRCRoomPrice` 同构，只多三个 `adjustmentPrice*` 字段；`relationRoomProducts`
 * 是联动房型（与 `excludedRelationRoomProductIds` 语义相反）。
 */
const UNIFORM_PRICE_REQUEST_BODY = {
  roomPriceInfos: [
    {
      roomProductId: '1569052067',
      startDate: '2026-08-26',
      endDate: '2026-08-28',
      salePrice: 365,
      costPrice: 310.25,
      commissionRate: 0.15,
      priceChangeMode: 'sale_commissionRate',
      mealNum: 0,
      weekDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
      currency: 'RMB',
      excludedRelationRoomProductIds: [],
      relationRoomProducts: [{ roomProductId: '1602330627', mealNum: 0 }],
    },
  ],
  adjustmentPriceType: 'salePrice',
  adjustmentPriceOperationsType: 'subtract',
  adjustmentPriceValue: 1,
  dateRanges: [{ startDate: '2026-08-26', endDate: '2026-08-28' }],
  weekDays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
  cipher: { '1569052067': 'AAEAAQAPMTU2OTA1MjA2Nyxo-tripsign' },
  head: { cid: '09031162210038262124', ctok: '', auth: '', extension: [] },
} satisfies JsonObject;

/** 房态房量菜单的页面 URL —— 踩点 `docs/踩点/携程/房态房量菜单.md` 的 referer。 */
const ROOM_STATUS_QUANTITY_PAGE_URL =
  'https://ebooking.ctrip.com/rateplan/batchSetRoomStatusAndQuantity?microJump=true';

/**
 * 房态房量菜单的真实**开房**请求体（`roomStatus: 1`）。
 * ⚠️ 与日历菜单房态端点零字段同名：房型在顶层 `roomProductIds`、日期在 `dates`、
 * 且**没有任何门店标识**。
 */
const ROOM_STATUS_QUANTITY_OPEN_BODY = {
  roomProductIds: ['1602330530', '1569052068'],
  dates: {
    dateRanges: [{ startDate: '2026-08-27', endDate: '2026-08-28' }],
    weekDays: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    applyAllDates: false,
  },
  roomStatus: 1,
  roomQuantityLimitType: -100,
  remainRoomQuantityType: -100,
  syncRoomQuantityWithSharedInventory: true,
  cipher: { '1569052068': 'AAEAAQAPMTU2OTA1MjA2OCxo-tripsign' },
  head: { cid: '09031162210038262124', ctok: '', auth: '', extension: [] },
} satisfies JsonObject;

/** 同一份踩点的**关房**请求体 —— 与开房逐字段相同，只有 `roomStatus` 变成 `2`。 */
const ROOM_STATUS_QUANTITY_CLOSE_BODY = {
  ...ROOM_STATUS_QUANTITY_OPEN_BODY,
  roomStatus: 2,
} satisfies JsonObject;

/** 房态房量端点的成功响应 —— 标准 SOA 信封，与改价新模块同构（**不是**老房态那套）。 */
const ROOM_STATUS_QUANTITY_SUCCESS_RESPONSE = JSON.stringify({
  taskId: '0b840204-ca59-4ee1-a6a3-b0d292ddc8e8_202608',
  resStatus: { rcode: 200, rmsg: '' },
  ResponseStatus: { Timestamp: '/Date(1787305409578+0800)/', Ack: 'Success', Errors: [] },
});

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function observed(overrides: Partial<AmountSaveObserved> = {}): AmountSaveObserved {
  return {
    endpointId: 'batchsetroomprice',
    endpointUrl: 'https://ebooking.ctrip.com/restapi/soa2/23783/setRCRoomPrice?_fxpcqlniredt=09031162210038262124',
    requestBody: REAL_REQUEST_BODY,
    responseBody: REAL_SUCCESS_RESPONSE,
    pageUrl: REAL_PAGE_URL,
    ...overrides,
  };
}

describe('ctrip amount change adapter', () => {
  describe('isWatchableUrl', () => {
    it('认得房价日历页', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl(REAL_PAGE_URL)).toBe(true);
    });

    /**
     * 2026-08-11 真机验证纠正：踩点 referer 停在日历页，但点「批量设价」后页面会再跳到
     * `/rateplan/batchPriceSetting`，保存请求是从**那里**发出的。漏认这条路由不只是漏一个
     * 请求 —— watcher 会因为「离开了可监听页面」直接 detach，此后整个 tab 都不再监听。
     */
    it('认得真正的改价页 /rateplan/batchPriceSetting', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(
        adapter.isWatchableUrl(
          'https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true',
        ),
      ).toBe(true);
    });

    it('不认 ebooking 下的其他模块', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl('https://ebooking.ctrip.com/ebkorder/order/list')).toBe(false);
    });

    it('不认冒充域名（含 http 与相似 host）', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(
        adapter.isWatchableUrl('http://ebooking.ctrip.com/ebkovsroom/inventory/calendar'),
      ).toBe(false);
      expect(
        adapter.isWatchableUrl('https://ebooking.ctrip.com.evil.com/ebkovsroom/inventory/calendar'),
      ).toBe(false);
    });
  });

  describe('isSuccessful', () => {
    it('外层 code 200 且每条 resultCode 为 0 判为成功', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful(REAL_SUCCESS_RESPONSE, 'batchsetroomprice')).toBe(true);
    });

    /**
     * 保守口径：外层说处理完了，但有一家门店没写进去 —— 整体判失败，不上报。
     * 宁可漏跟一次，也不让 RMS 按没生效的价格跟价。
     */
    it('外层 200 但有一条 resultCode 非 0 时判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const partial = JSON.stringify({
        code: 200,
        data: {
          roomPriceSetResults: [
            { resultCode: 0, statusDesc: '房价设置成功', hotelID: 115348672 },
            { resultCode: 1, resultMessage: '佣金比例不合法', hotelID: 115582769 },
          ],
        },
      });
      expect(adapter.isSuccessful(partial, 'batchsetroomprice')).toBe(false);
    });

    it('响应体不是合法 JSON 时判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful('<html>502 Bad Gateway</html>', 'batchsetroomprice')).toBe(false);
    });

    /** 新模块是完全不同的信封：resStatus.rcode + ResponseStatus.Ack。 */
    it('新模块 rcode 200 且 Ack Success 判为成功', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful(NEW_MODULE_SUCCESS_RESPONSE, 'setRCRoomPrice')).toBe(true);
    });

    it('新模块 rcode 非 200 判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const rejected = JSON.stringify({
        resStatus: { rcode: 500, rmsg: '价格低于限价' },
        ResponseStatus: { Ack: 'Failure', Errors: [{ Message: '价格低于限价' }] },
      });
      expect(adapter.isSuccessful(rejected, 'setRCRoomPrice')).toBe(false);
    });

    it('新模块 rcode 200 但框架层报错时判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const partial = JSON.stringify({
        resStatus: { rcode: 200, rmsg: '' },
        ResponseStatus: { Ack: 'Failure', Errors: [{ Message: 'internal error' }] },
      });
      expect(adapter.isSuccessful(partial, 'setRCRoomPrice')).toBe(false);
    });
  });

  describe('parse', () => {
    it('老模块：从请求体取门店，请求体与响应体原样透传', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.parse(observed(), null)).toEqual({
        kind: 'report',
        report: {
          source: 'ctrip',
          changeType: 'price',
          endpointId: 'batchsetroomprice',
          endpointUrl:
            'https://ebooking.ctrip.com/restapi/soa2/23783/setRCRoomPrice?_fxpcqlniredt=09031162210038262124',
          otaHotelId: '115348672',
          changeRaw: REAL_REQUEST_BODY,
        },
      });
    });

    /** 携程独有：一次保存跨多家门店，而契约的 otaHotelId 是单值 —— 取第一家并记 info。 */
    it('跨多家门店时 otaHotelId 取第一家并记 info', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const report = reportOf(
        adapter.parse(
          observed({
            requestBody: {
              roomPriceInfoList: [
                { roomTypeID: 1587157432, hotelID: 115348672, refRoomIDs: [] },
                { roomTypeID: 1600000001, hotelID: 115582769, refRoomIDs: [] },
              ],
            },
          }),
          null,
        ),
      );
      expect(report?.otaHotelId).toBe('115348672');
      expect(logger.info).toHaveBeenCalled();
    });

    it('请求体没有任何房型标识时返回 null —— 拦到的不是改价请求', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      expect(adapter.parse(observed({ requestBody: { pageType: 'T' } }), null)).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    /**
     * 新模块的请求体里**根本没有门店 ID**（踩点 `改价踩点02.md` 确认）。此前的实现
     * 「没有 hotelID 就返回 null」会把新模块的改价**全部丢弃** —— 而新模块正是真机
     * 走菜单「批量设价」的默认路径。
     */
    it('新模块（无门店 ID）仍然上报，otaHotelId 留空由 RMS 反查', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const result = adapter.parse(
        observed({
          endpointId: 'setRCRoomPrice',
          requestBody: NEW_MODULE_REQUEST_BODY,
          responseBody: NEW_MODULE_SUCCESS_RESPONSE,
          pageUrl: 'https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true',
        }),
        null,
      );
      const report = reportOf(result);
      expect(report).toBeDefined();
      expect(report?.otaHotelId).toBe('');
      // 房型 ID 留在原始 requestBody 里，RMS 据此反查门店。
      expect(report?.changeRaw).toEqual(NEW_MODULE_REQUEST_BODY);
    });

    /** 框架噪音字段要剔除（含凭证性质的 cipher / head.auth），但不做任何语义转换。 */
    it('剔除 reqHead/cipher/head 噪音，其余字段原样保留', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const result = adapter.parse(
        observed({
          endpointId: 'setRCRoomPrice',
          requestBody: {
            ...NEW_MODULE_REQUEST_BODY,
            reqHead: { client: { screenWidth: 1512 } },
            cipher: { '1587157522': 'AAEAAQ…-tripsign' },
            head: { cid: '090311622', auth: 'secret' },
          },
          responseBody: NEW_MODULE_SUCCESS_RESPONSE,
        }),
        null,
      );
      const report = reportOf(result);
      expect(report?.changeRaw).toEqual(NEW_MODULE_REQUEST_BODY);
      expect(report?.changeRaw).not.toHaveProperty('reqHead');
      expect(report?.changeRaw).not.toHaveProperty('cipher');
      expect(report?.changeRaw).not.toHaveProperty('head');
    });

    /**
     * `excludedRelationRoomProductIds` 是**排除**语义（这些联动房型不跟着改），与老模块
     * `refRoomIDs`（一并改了这些）相反。收进来会把明确排除的房型报成改过的。
     */
    /** 只有 roomProductId（新模块）也算合法改价请求，不该被当成噪音丢弃。 */
    it('只有新模块房型字段时照常上报', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const result = adapter.parse(
        observed({
          endpointId: 'setRCRoomPrice',
          requestBody: {
            roomPriceInfos: [
              {
                roomProductId: '1587157522',
                excludedRelationRoomProductIds: ['9999999991'],
              },
            ],
          },
          responseBody: NEW_MODULE_SUCCESS_RESPONSE,
        }),
        null,
      );
      expect(reportOf(result)?.otaHotelId).toBe('');
    });
  });

  describe('watchedEndpoints', () => {
    /**
     * 携程的价量态操作分散在**三个菜单、五个端点**上，任一漏认都会静默漏报：
     * 改价两套并存模块（2026-08-11 真机发现），房价维护页同页还有「统一加减价」变体，
     * 房态则有日历菜单与房态房量菜单两个完全不同的端点。
     */
    it('三个菜单的五个端点都要拦', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect([...adapter.watchedEndpoints.values()]).toEqual([
        '/ebkovsroom/api/inventory/batchsetroomprice',
        '/setRCRoomPrice',
        '/setUniformRCRoomPrice',
        '/ebkovsroom/api/inventory/setbatchroombookablestatus',
        '/batchUpdateRoomStatusAndQuantity',
      ]);
    });

    /**
     * 机制层 `matchEndpoint` 是 `url.includes(fragment)` **首个命中即返回**，所以片段之间
     * 不能有包含关系。`batchsetroomprice` 与 `setbatchroombookablestatus` 只是**看着像**
     * （都含 batch、room），真串了会把房态当改价解析 —— 而两者请求体没有一个字段同名，
     * 结果是每次房态都被当成「没有房型标识」丢弃，且失效方式是静默的。
     */
    it('五个端点两两互不为子串，分发不会串味', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const fragments = [...adapter.watchedEndpoints.values()];

      for (const a of fragments) {
        for (const b of fragments) {
          if (a === b) continue;
          expect(a.includes(b)).toBe(false);
        }
      }
    });

    it('五个端点各自只命中自己的 URL', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const match = (url: string) =>
        [...adapter.watchedEndpoints.entries()].filter(([, fragment]) => url.includes(fragment));

      expect(
        match('https://ebooking.ctrip.com/ebkovsroom/api/inventory/setbatchroombookablestatus'),
      ).toEqual([['setbatchroombookablestatus', '/ebkovsroom/api/inventory/setbatchroombookablestatus']]);
      expect(
        match('https://ebooking.ctrip.com/ebkovsroom/api/inventory/batchsetroomprice'),
      ).toEqual([['batchsetroomprice', '/ebkovsroom/api/inventory/batchsetroomprice']]);
      expect(match('https://ebooking.ctrip.com/restapi/soa2/23783/setRCRoomPrice')).toEqual([
        ['setRCRoomPrice', '/setRCRoomPrice'],
      ]);
      // ⚠️ 最易串的一对：`setUniformRCRoomPrice` 里不含 `setRCRoomPrice`（`Uniform` 插在
      // `set` 与 `RCRoomPrice` 之间），所以统一加减价的 URL 只命中它自己。
      expect(
        match('https://ebooking.ctrip.com/restapi/soa2/23783/setUniformRCRoomPrice'),
      ).toEqual([['setUniformRCRoomPrice', '/setUniformRCRoomPrice']]);
      expect(
        match('https://ebooking.ctrip.com/restapi/soa2/23783/batchUpdateRoomStatusAndQuantity'),
      ).toEqual([['batchUpdateRoomStatusAndQuantity', '/batchUpdateRoomStatusAndQuantity']]);
    });

    /**
     * 新端点**故意不含** `soa2/23783`：那是携程内部的 SOA 服务编号（部署产物），
     * 服务拆分/迁移时会变，而变了之后的失效是静默的 —— 改了价但不跟价，日志上与
     * 「用户没改价」完全一样。方法名是业务语义，稳定得多。
     */
    it('新端点不写死 soa2 服务编号', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const fragment = adapter.watchedEndpoints.get('setRCRoomPrice');
      expect(fragment).toBeDefined();
      expect(fragment).not.toContain('23783');
      expect(fragment).not.toContain('soa2');
      // 真实 URL 仍然能命中（含服务编号、含 query）。
      expect(
        'https://ebooking.ctrip.com/restapi/soa2/23783/setRCRoomPrice?_fxpcqlniredt=090311622100382&x-traceID=abc',
      ).toContain(fragment as string);
      // 携程哪天把服务编号改了，照样命中。
      expect('https://ebooking.ctrip.com/restapi/soa2/99999/setRCRoomPrice').toContain(
        fragment as string,
      );
    });
  });

  /**
   * 房态（开房/关房）—— 踩点 `docs/踩点/携程/房量01.md`。
   *
   * 与改价共用同一张日历页与同一套机制，差异全在适配器内部：端点不同、请求体没有一个
   * 字段同名、响应形状也不同。
   */
  describe('房态', () => {
    const roomStatusObserved = (requestBody: JsonObject, responseBody = ROOM_STATUS_SUCCESS_RESPONSE) =>
      observed({
        endpointId: 'setbatchroombookablestatus',
        endpointUrl:
          'https://ebooking.ctrip.com/ebkovsroom/api/inventory/setbatchroombookablestatus',
        requestBody,
        responseBody,
      });

    describe('isSuccessful', () => {
      /**
       * ⚠️ **回归护栏**：这个端点的响应 `data` 是 `null`，没有内层明细。若有人日后把房态
       * 并回改价老模块那条查 `data.roomPriceSetResults[].resultCode` 的路径，这条会立刻
       * 失败 —— 否则失效方式是**静默漏报**：改了房态但不上报，日志上与「用户没改」一样。
       */
      it('data 为 null 的真实成功响应判为成功', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        expect(adapter.isSuccessful(ROOM_STATUS_SUCCESS_RESPONSE, 'setbatchroombookablestatus')).toBe(
          true,
        );
      });

      /** 同一份响应若按改价老模块判，会因为取不到 roomPriceSetResults 而判失败。 */
      it('同一份响应按改价端点判时判为失败 —— 证明分支确实生效', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        expect(adapter.isSuccessful(ROOM_STATUS_SUCCESS_RESPONSE, 'batchsetroomprice')).toBe(false);
      });

      it('外层 code 非 200 判为失败', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        const rejected = JSON.stringify({ code: 500, message: '操作失败', returnCode: '500', data: null });
        expect(adapter.isSuccessful(rejected, 'setbatchroombookablestatus')).toBe(false);
      });

      /** returnCode 明确给出且不是 200 —— 否决。 */
      it('returnCode 明确不是 200 时判为失败', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        const odd = JSON.stringify({ code: 200, returnCode: '500', data: null });
        expect(adapter.isSuccessful(odd, 'setbatchroombookablestatus')).toBe(false);
      });

      /**
       * ⚠️ **回归护栏**：`returnCode` 的类型在携程各端点间**并不稳定** —— 改价老模块的
       * 成功响应里它是 `null`（见上方 `REAL_SUCCESS_RESPONSE`）。房态目前只有一个样本
       * 给的是字符串 `"200"`，若据此写死严格相等，携程哪天改成数字或某个变体不给这个
       * 字段，就会**每次成功都判失败**且静默漏报 —— 与 2026-08-13 美团关房全丢同类。
       *
       * 所以判据是：`code === 200` 为主，`returnCode` 只在明确不是 200 时否决。
       */
      it('returnCode 是数字 200 时同样判为成功', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        const numeric = JSON.stringify({ code: 200, returnCode: 200, data: null });
        expect(adapter.isSuccessful(numeric, 'setbatchroombookablestatus')).toBe(true);
      });

      it('returnCode 缺失或为 null 时不阻断（携程在别的端点上确实会给 null）', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        expect(
          adapter.isSuccessful(JSON.stringify({ code: 200, data: null }), 'setbatchroombookablestatus'),
        ).toBe(true);
        expect(
          adapter.isSuccessful(
            JSON.stringify({ code: 200, returnCode: null, data: null }),
            'setbatchroombookablestatus',
          ),
        ).toBe(true);
      });

      it('响应体不是合法 JSON 时判为失败', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        expect(adapter.isSuccessful('<html>502</html>', 'setbatchroombookablestatus')).toBe(false);
      });
    });

    describe('parse', () => {
      it('关房：取门店与房型，changeType 为 roomStatus，roomStatus 原样留在 changeRaw', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        const report = reportOf(adapter.parse(roomStatusObserved(REAL_CLOSE_ROOM_BODY), null));

        expect(report?.changeType).toBe('roomStatus');
        expect(report?.endpointId).toBe('setbatchroombookablestatus');
        expect(report?.otaHotelId).toBe('115348672');
        // 开关方向由 RMS 从 changeRaw 读 —— desktop 不解读渠道语义。
        expect(report?.changeRaw).toMatchObject({ roomStatus: 'N' });
      });

      it('开房：与关房同一个 endpointId，只有 roomStatus 不同', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        const report = reportOf(
          adapter.parse(roomStatusObserved({ ...REAL_CLOSE_ROOM_BODY, roomStatus: 'G' }), null),
        );

        expect(report?.changeType).toBe('roomStatus');
        expect(report?.endpointId).toBe('setbatchroombookablestatus');
        expect(report?.changeRaw).toMatchObject({ roomStatus: 'G' });
      });

      it('剔除 holidyInfo 节假日字典', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        const report = reportOf(adapter.parse(roomStatusObserved(REAL_CLOSE_ROOM_BODY), null));

        expect(report?.changeRaw.dateItemInfoDtoList).toEqual([
          { startDate: '2026-08-31', endDate: '2026-08-31' },
        ]);
      });

      it('请求体没有任何房型标识时返回 null 并记 warn', () => {
        const logger = createLogger();
        const adapter = createCtripAmountChangeAdapter(logger);

        expect(adapter.parse(roomStatusObserved({ pageType: 'F', roomStatus: 'N' }), null)).toBeNull();
        expect(logger.warn).toHaveBeenCalled();
      });

      /** 只有顶层 originalRoomProductIds 也算合法 —— 两处房型来源任一有值即可。 */
      it('只有 originalRoomProductIds 时照常上报', () => {
        const adapter = createCtripAmountChangeAdapter(createLogger());
        const report = reportOf(
          adapter.parse(
            roomStatusObserved({ roomStatus: 'N', originalRoomProductIds: [1587157431] }),
            null,
          ),
        );

        expect(report?.changeType).toBe('roomStatus');
      });

      /** 与改价老模块同样的单值契约代价：一次可能改多家门店，取第一家并记 info。 */
      it('跨多家门店时 otaHotelId 取第一家并记 info', () => {
        const logger = createLogger();
        const adapter = createCtripAmountChangeAdapter(logger);
        const report = reportOf(
          adapter.parse(
            roomStatusObserved({
              roomStatus: 'N',
              hotelRoomInfoDtoList: [
                { hotelID: 115348672, roomTypeID: 1587157431 },
                { hotelID: 115582769, roomTypeID: 1600000001 },
              ],
            }),
            null,
          ),
        );

        expect(report?.otaHotelId).toBe('115348672');
        expect(logger.info).toHaveBeenCalled();
      });
    });
  });
  /**
   * 「统一加减价」（A 块）—— 踩点 `docs/踩点/携程/房价维护菜单踩点.md`。
   *
   * 与逐项设价同页面、同响应形状，只是端点不同、请求体多三个 `adjustmentPrice*` 字段。
   * 只认逐项设价那个端点，用户走统一加减价改的价会**静默漏报**。
   */
  describe('改价·统一加减价', () => {
    const uniformObserved = (requestBody: JsonObject = UNIFORM_PRICE_REQUEST_BODY) =>
      observed({
        endpointId: 'setUniformRCRoomPrice',
        endpointUrl: 'https://ebooking.ctrip.com/restapi/soa2/23783/setUniformRCRoomPrice',
        requestBody,
        responseBody: NEW_MODULE_SUCCESS_RESPONSE,
        pageUrl: 'https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true',
      });

    it('上报为改价，endpointId 用自己的', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const report = reportOf(adapter.parse(uniformObserved(), null));

      expect(report?.changeType).toBe('price');
      expect(report?.endpointId).toBe('setUniformRCRoomPrice');
      expect(report?.source).toBe('ctrip');
    });

    /** 与逐项设价同样没有门店 ID，RMS 按 roomProductId 反查。 */
    it('请求体没有门店 ID 时 otaHotelId 为空串且不丢弃', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const report = reportOf(adapter.parse(uniformObserved(), null));

      expect(report).toBeDefined();
      expect(report?.otaHotelId).toBe('');
      expect(logger.info).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    /** 响应与逐项设价完全同构，复用改价新模块的判据即可。 */
    it('成功响应判为成功', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(
        adapter.isSuccessful(NEW_MODULE_SUCCESS_RESPONSE, 'setUniformRCRoomPrice'),
      ).toBe(true);
    });

    /** 三个加减价字段是本端点独有的业务信息，必须原样透传给 RMS。 */
    it('changeRaw 保留加减价三字段，剔除框架噪音', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const raw = reportOf(adapter.parse(uniformObserved(), null))?.changeRaw as
        | Record<string, unknown>
        | undefined;

      expect(raw?.adjustmentPriceType).toBe('salePrice');
      expect(raw?.adjustmentPriceOperationsType).toBe('subtract');
      expect(raw?.adjustmentPriceValue).toBe(1);
      expect(raw).not.toHaveProperty('cipher');
      expect(raw).not.toHaveProperty('head');
      expect(raw).not.toHaveProperty('reqHead');
    });
  });

  /**
   * 联动房型（B 块）—— 既有缺陷修复，2026-08-21。
   *
   * 改价新模块有**两个语义相反**的联动房型字段：`relationRoomProducts`（一并改了这些，
   * 对应老模块的 `refRoomIDs`）与 `excludedRelationRoomProductIds`（排除这些）。
   * 修复前只收 `roomProductId`，漏了前者。
   */
  describe('改价·联动房型', () => {
    const priceObserved = (requestBody: JsonObject) =>
      observed({
        endpointId: 'setRCRoomPrice',
        endpointUrl: 'https://ebooking.ctrip.com/restapi/soa2/23783/setRCRoomPrice',
        requestBody,
        responseBody: NEW_MODULE_SUCCESS_RESPONSE,
        pageUrl: 'https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true',
      });

    /**
     * 修复前的失效方式：只有联动房型时取不到任何房型标识，整次改价被当成「拦到的不是
     * 改价请求」而丢弃 —— 用户确实改了价，RMS 却收不到。
     */
    it('只有联动房型时不被丢弃', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const report = reportOf(
        adapter.parse(
          priceObserved({
            roomPriceInfos: [
              { relationRoomProducts: [{ roomProductId: '1602330627', mealNum: 0 }] },
            ],
          }),
          null,
        ),
      );

      expect(report).toBeDefined();
      expect(report?.changeType).toBe('price');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    /**
     * ⛔ 反向回归：排除列表是「这些房型**不**跟着改」，收进来会把用户明确排除掉的房型
     * 当成改过的报给 RMS —— 方向完全反了。
     */
    it('排除列表不能当作定位依据', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const result = adapter.parse(
        priceObserved({
          roomPriceInfos: [{ excludedRelationRoomProductIds: ['1602330627', '1602330629'] }],
        }),
        null,
      );

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    /** 真实报文里两者并存：`relationRoomProducts` 有值、排除列表为空。 */
    it('真实统一加减价报文里的联动房型被采纳', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const report = reportOf(
        adapter.parse(
          observed({
            endpointId: 'setUniformRCRoomPrice',
            endpointUrl: 'https://ebooking.ctrip.com/restapi/soa2/23783/setUniformRCRoomPrice',
            requestBody: UNIFORM_PRICE_REQUEST_BODY,
            responseBody: NEW_MODULE_SUCCESS_RESPONSE,
            pageUrl: 'https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true',
          }),
          null,
        ),
      );

      expect(report).toBeDefined();
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  /**
   * 房态房量菜单（C 块）—— 踩点 `docs/踩点/携程/房态房量菜单.md`。
   *
   * ⚠️ 与日历菜单房态端点是**两个完全不同的端点**：请求体零字段同名、开关房取值形式不同
   * （`1`/`2` 数字 vs `"G"`/`"N"` 字符串）、响应信封也不同。
   */
  describe('房态房量菜单', () => {
    const rsqObserved = (
      requestBody: JsonObject,
      responseBody = ROOM_STATUS_QUANTITY_SUCCESS_RESPONSE,
    ) =>
      observed({
        endpointId: 'batchUpdateRoomStatusAndQuantity',
        endpointUrl:
          'https://ebooking.ctrip.com/restapi/soa2/23783/batchUpdateRoomStatusAndQuantity',
        requestBody,
        responseBody,
        pageUrl: ROOM_STATUS_QUANTITY_PAGE_URL,
      });

    /**
     * ⚠️ 页面必须放开：`AmountChangeWatcher` 见到不可监听的 URL 会 stopWatching → detach，
     * 此后整个 tab 都拦不到 —— 与 2026-08-11 `batchPriceSetting` 是同一个坑。
     */
    it('页面可监听，且与房价维护页互不为前缀', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());

      expect(adapter.isWatchableUrl(ROOM_STATUS_QUANTITY_PAGE_URL)).toBe(true);
      expect(
        adapter.isWatchableUrl('https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true'),
      ).toBe(true);
      // 两条前缀第二段就分叉，不会互相覆盖。
      expect(
        'https://ebooking.ctrip.com/rateplan/batchSetRoomStatusAndQuantity'.startsWith(
          'https://ebooking.ctrip.com/rateplan/batchPriceSetting',
        ),
      ).toBe(false);
    });

    it('上报为量态改动，endpointId 用自己的', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const report = reportOf(adapter.parse(rsqObserved(ROOM_STATUS_QUANTITY_OPEN_BODY), null));

      expect(report?.changeType).toBe('roomStatus');
      expect(report?.endpointId).toBe('batchUpdateRoomStatusAndQuantity');
    });

    /** 该端点请求体里根本没有门店标识 —— 空串是正常情况，记 info 不记 warn。 */
    it('otaHotelId 恒为空串，且不判为错误', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const report = reportOf(adapter.parse(rsqObserved(ROOM_STATUS_QUANTITY_OPEN_BODY), null));

      expect(report?.otaHotelId).toBe('');
      expect(logger.info).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    /**
     * ⚠️ 开关房**同一个 endpointId**，方向靠 `changeRaw.roomStatus` 区分，且**不归一化**
     * 成日历菜单那套 `"G"`/`"N"` —— 归一化属于语义转换，RMS 按 endpointId 自己解读。
     * 把关房当开房处理会造成超售。
     */
    it('开房与关房共用 endpointId，roomStatus 原样保留 1 与 2', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const open = reportOf(adapter.parse(rsqObserved(ROOM_STATUS_QUANTITY_OPEN_BODY), null));
      const close = reportOf(adapter.parse(rsqObserved(ROOM_STATUS_QUANTITY_CLOSE_BODY), null));

      expect(open?.endpointId).toBe(close?.endpointId);
      expect((open?.changeRaw as Record<string, unknown>).roomStatus).toBe(1);
      expect((close?.changeRaw as Record<string, unknown>).roomStatus).toBe(2);
    });

    /** 房量三字段本次 RMS 不解析，但 desktop 照常透传（透传是既定语义）。 */
    it('changeRaw 保留房量三字段与 dates，剔除框架噪音', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const raw = reportOf(adapter.parse(rsqObserved(ROOM_STATUS_QUANTITY_OPEN_BODY), null))
        ?.changeRaw as Record<string, unknown>;

      expect(raw.roomQuantityLimitType).toBe(-100);
      expect(raw.remainRoomQuantityType).toBe(-100);
      expect(raw.syncRoomQuantityWithSharedInventory).toBe(true);
      expect(raw.dates).toEqual(ROOM_STATUS_QUANTITY_OPEN_BODY.dates);
      expect(raw.roomProductIds).toEqual(['1602330530', '1569052068']);
      expect(raw).not.toHaveProperty('cipher');
      expect(raw).not.toHaveProperty('head');
    });

    it('取不到房型时丢弃并告警', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);

      expect(adapter.parse(rsqObserved({ roomStatus: 1 }), null)).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    /**
     * ⚠️ 成功判据必须按 endpointId 钉死，不能靠响应形状自辨：该端点的信封与老房态端点
     * 完全不同，走错分支会卡在缺失的 `code` 上判成失败 —— 失效方式是静默漏报。
     */
    it('成功判定走 SOA 信封，而非老房态端点那套', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());

      expect(
        adapter.isSuccessful(
          ROOM_STATUS_QUANTITY_SUCCESS_RESPONSE,
          'batchUpdateRoomStatusAndQuantity',
        ),
      ).toBe(true);
      // 同一份响应喂给老房态端点的判据会失败（没有 code 字段），证明两套判据确实不同。
      expect(
        adapter.isSuccessful(ROOM_STATUS_QUANTITY_SUCCESS_RESPONSE, 'setbatchroombookablestatus'),
      ).toBe(false);
    });

    it('业务码非 200 判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const failed = JSON.stringify({
        resStatus: { rcode: 500, rmsg: '操作失败' },
        ResponseStatus: { Ack: 'Failed', Errors: [{ Message: 'x' }] },
      });

      expect(adapter.isSuccessful(failed, 'batchUpdateRoomStatusAndQuantity')).toBe(false);
    });
  });
});
