import { describe, expect, it, vi } from 'vitest';
import { createCtripAmountChangeAdapter } from '../../../src/main/channels/ctrip/amount-change-adapter';
import type { AmountSaveObserved } from '../../../src/shared/types/amount-change';

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
      expect(adapter.isSuccessful(REAL_SUCCESS_RESPONSE)).toBe(true);
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
      expect(adapter.isSuccessful(partial)).toBe(false);
    });

    it('响应体不是合法 JSON 时判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful('<html>502 Bad Gateway</html>')).toBe(false);
    });

    /** 新模块是完全不同的信封：resStatus.rcode + ResponseStatus.Ack。 */
    it('新模块 rcode 200 且 Ack Success 判为成功', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful(NEW_MODULE_SUCCESS_RESPONSE)).toBe(true);
    });

    it('新模块 rcode 非 200 判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const rejected = JSON.stringify({
        resStatus: { rcode: 500, rmsg: '价格低于限价' },
        ResponseStatus: { Ack: 'Failure', Errors: [{ Message: '价格低于限价' }] },
      });
      expect(adapter.isSuccessful(rejected)).toBe(false);
    });

    it('新模块 rcode 200 但框架层报错时判为失败', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const partial = JSON.stringify({
        resStatus: { rcode: 200, rmsg: '' },
        ResponseStatus: { Ack: 'Failure', Errors: [{ Message: 'internal error' }] },
      });
      expect(adapter.isSuccessful(partial)).toBe(false);
    });
  });

  describe('parse', () => {
    it('老模块：从请求体取门店，请求体与响应体原样透传', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect(adapter.parse(observed())).toEqual({
        source: 'ctrip',
        endpointId: 'batchsetroomprice',
        endpointUrl:
          'https://ebooking.ctrip.com/restapi/soa2/23783/setRCRoomPrice?_fxpcqlniredt=09031162210038262124',
        otaHotelId: '115348672',
        requestBody: REAL_REQUEST_BODY,
        responseBody: REAL_SUCCESS_RESPONSE,
      });
    });

    /** 携程独有：一次保存跨多家门店，而契约的 otaHotelId 是单值 —— 取第一家并记 info。 */
    it('跨多家门店时 otaHotelId 取第一家并记 info', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      const result = adapter.parse(
        observed({
          requestBody: {
            roomPriceInfoList: [
              { roomTypeID: 1587157432, hotelID: 115348672, refRoomIDs: [] },
              { roomTypeID: 1600000001, hotelID: 115582769, refRoomIDs: [] },
            ],
          },
        }),
      );
      expect(result?.otaHotelId).toBe('115348672');
      expect(logger.info).toHaveBeenCalled();
    });

    it('请求体没有任何房型标识时返回 null —— 拦到的不是改价请求', () => {
      const logger = createLogger();
      const adapter = createCtripAmountChangeAdapter(logger);
      expect(adapter.parse(observed({ requestBody: { pageType: 'T' } }))).toBeNull();
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
      );
      expect(result).not.toBeNull();
      expect(result?.otaHotelId).toBe('');
      // 房型 ID 留在原始 requestBody 里，RMS 据此反查门店。
      expect(result?.requestBody).toEqual(NEW_MODULE_REQUEST_BODY);
      expect(result?.responseBody).toBe(NEW_MODULE_SUCCESS_RESPONSE);
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
      );
      expect(result?.requestBody).toEqual(NEW_MODULE_REQUEST_BODY);
      expect(result?.requestBody).not.toHaveProperty('reqHead');
      expect(result?.requestBody).not.toHaveProperty('cipher');
      expect(result?.requestBody).not.toHaveProperty('head');
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
      );
      expect(result).not.toBeNull();
      expect(result?.otaHotelId).toBe('');
    });
  });

  describe('saveEndpoints', () => {
    /**
     * 携程有两套并存的改价模块，端点完全不同（2026-08-11 真机验证发现）：
     * 踩点覆盖的是老的 `ebkovsroom`，而走菜单「批量设价」进的是新的 `rateplan`。
     * 只认踩点那个端点会一次都拦不到。
     */
    it('两套改价模块的端点都要拦', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      expect([...adapter.saveEndpoints.values()]).toEqual([
        '/ebkovsroom/api/inventory/batchsetroomprice',
        '/setRCRoomPrice',
      ]);
    });

    /**
     * 新端点**故意不含** `soa2/23783`：那是携程内部的 SOA 服务编号（部署产物），
     * 服务拆分/迁移时会变，而变了之后的失效是静默的 —— 改了价但不跟价，日志上与
     * 「用户没改价」完全一样。方法名是业务语义，稳定得多。
     */
    it('新端点不写死 soa2 服务编号', () => {
      const adapter = createCtripAmountChangeAdapter(createLogger());
      const fragment = adapter.saveEndpoints.get('setRCRoomPrice');
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
});
