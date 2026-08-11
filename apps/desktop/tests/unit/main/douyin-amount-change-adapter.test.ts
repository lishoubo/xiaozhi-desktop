import { describe, expect, it, vi } from 'vitest';
import { createDouyinAmountChangeAdapter } from '../../../src/main/channels/douyin/amount-change-adapter';
import type { AmountSaveObserved } from '../../../src/shared/types/amount-change';

/**
 * 取自真实踩点 `xiaozhi-rms-workspace/docs/抖音/踩点/修改价格.md` 的 referer —— 改价页的
 * URL 形状（门店 ID 只在这里，不在请求体里）。
 */
const REAL_PAGE_URL =
  'https://life.douyin.com/p/travel-ari/hotel/price?enter_from_channel=&groupid=1813179858562059' +
  '&lifeAccountId=7426783989676935218&poi_id=7245504927202543672&roomType=2&showYesterday=false' +
  '&life_biz_view_id=22&life_account_biz_ids=';

/** 同一份踩点里的真实请求体。 */
const REAL_REQUEST_BODY = {
  permission_common_param: { life_account_ids: '7426783989676935218' },
  available_week_list: [1, 2, 3, 4, 5, 6, 7],
  date_period_list: [{ start: '2026-05-28', end: '2026-05-31' }],
  product_list: [{ product_id: '1788600508917772', room_type: 2, normal_price: 100 }],
  amount_change_type: 1,
  need_handle_weekend: false,
} as const;

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function observed(overrides: Partial<AmountSaveObserved> = {}): AmountSaveObserved {
  return {
    endpointId: 'save_amount_calendar',
    endpointUrl: 'https://life.douyin.com/life/trip/hotel/save_amount_calendar',
    requestBody: REAL_REQUEST_BODY,
    responseBody: '{"BaseResp":{"StatusCode":0}}',
    pageUrl: REAL_PAGE_URL,
    ...overrides,
  };
}

describe('douyin amount change adapter', () => {
  describe('isWatchableUrl', () => {
    it('认得改价页（带参跳入的 /hotel/price）', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl(REAL_PAGE_URL)).toBe(true);
    });

    /** 真机实测的常态路由：走左侧菜单「商品与货架 → 房价房态管理」落在这里。 */
    it('认得改价页（走菜单的 /hotel/price_amount_state）', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      expect(
        adapter.isWatchableUrl(
          'https://life.douyin.com/p/travel-ari/hotel/price_amount_state?groupid=1&showYesterday=false',
        ),
      ).toBe(true);
    });

    it('不认其他抖音页面', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl('https://life.douyin.com/p/home?groupid=1')).toBe(false);
    });

    it('不认冒充域名（含 http 与相似 host）', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      expect(adapter.isWatchableUrl('http://life.douyin.com/p/travel-ari/hotel/price')).toBe(false);
      expect(
        adapter.isWatchableUrl('https://life.douyin.com.evil.com/p/travel-ari/hotel/price'),
      ).toBe(false);
    });
  });

  describe('isSuccessful', () => {
    it('StatusCode 为 0 判为成功', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful('{"BaseResp":{"StatusCode":0},"status_code":0}')).toBe(true);
    });

    /** 真实失败样本：踩点 `修改价格.md` 里限价规则拒绝的那次。 */
    it('限价规则拒绝时判为失败', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      const rejected = JSON.stringify({
        BaseResp: {
          StatusCode: 103810209,
          StatusMessage: '限价规则：发布的【2026-05-28】商品的价格不能低于9元',
        },
        status_code: 103810209,
      });
      expect(adapter.isSuccessful(rejected)).toBe(false);
    });

    it('响应体不是合法 JSON 时判为失败', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      expect(adapter.isSuccessful('<html>502 Bad Gateway</html>')).toBe(false);
    });
  });

  describe('parse', () => {
    it('带参跳入的页面：门店与账号上下文都取到，请求体原样透传', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      expect(adapter.parse(observed())).toEqual({
        source: 'douyin',
        endpointId: 'save_amount_calendar',
        endpointUrl: 'https://life.douyin.com/life/trip/hotel/save_amount_calendar',
        otaHotelId: '7245504927202543672',
        requestBody: REAL_REQUEST_BODY,
        responseBody: '{"BaseResp":{"StatusCode":0}}',
      });
    });

    /**
     * 真机验证发现的常态（2026-08-10）：走左侧菜单进入 `/hotel/price_amount_state` 时，
     * URL 上只有 groupid，没有 poi_id 也没有 lifeAccountId。这时**必须照样上报** ——
     * RMS 靠 product_id 反查门店。此前这里返回 null，导致所有走菜单的改价全被丢弃。
     */
    it('走菜单进入（URL 无 poi_id）时仍然上报，靠 product_id 定位', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      const result = adapter.parse(
        observed({
          pageUrl:
            'https://life.douyin.com/p/travel-ari/hotel/price_amount_state?groupid=1813179858562059&showYesterday=false',
        }),
      );
      expect(result).not.toBeNull();
      expect(result?.otaHotelId).toBe('');
      // 房型 ID 留在原始 requestBody 里，RMS 靠它反查门店。
      expect(result?.requestBody).toEqual(REAL_REQUEST_BODY);
    });

    it('请求体没有任何 product_id 时返回 null —— 拦到的不是改价请求', () => {
      const logger = createLogger();
      const adapter = createDouyinAmountChangeAdapter(logger);
      const result = adapter.parse(
        observed({ requestBody: { amount_change_type: 1, product_list: [] } }),
      );
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    /** 房态房量端点把 product_list 嵌在 calendar_ari_list 里，且同一房型会出现多次。 */
    it('认得房态端点的嵌套 product_list 并去重', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      const result = adapter.parse(
        observed({
          endpointId: 'batch_save_stock_state_calendar',
          requestBody: {
            calendar_ari_list: [
              { room_state: 1, product_list: [{ product_id: '1788600508917804', room_type: 2 }] },
              { room_stock: 1, product_list: [{ product_id: '1788600508917804', room_type: 2 }] },
            ],
          },
        }),
      );
      expect(result).not.toBeNull();
      expect(result?.endpointId).toBe('batch_save_stock_state_calendar');
    });
  });

  describe('saveEndpoints', () => {
    it('只拦 save，不拦 check —— 否则一次改价会上报两遍', () => {
      const adapter = createDouyinAmountChangeAdapter(createLogger());
      const fragments = [...adapter.saveEndpoints.values()];
      expect(fragments).toEqual(['/life/trip/hotel/save_amount_calendar']);
      expect(fragments.some((f) => f.includes('check_'))).toBe(false);
    });
  });
});
