/**
 * 抖音的价量态改动适配器 —— 本期唯一实装的渠道。
 *
 * 踩点：`xiaozhi-rms-workspace/docs/抖音/踩点/修改价格.md`、`改价踩点02.md`
 * 反向参照（RMS 侧怎么写抖音）：`rms-rpa-worker/adapters/douyin/price_write.py`
 *
 * ## 门店 ID 靠 product_id，不靠 URL（2026-08-10 真机验证纠正）
 *
 * 抖音**不在任何地方直接告诉我们改的是哪家门店**：
 *
 * | 位置 | 有什么 | 有门店吗 |
 * |---|---|---|
 * | 请求体 | `life_account_ids`（账号）、`product_list[].product_id`（房型） | ❌ |
 * | 页面 URL（走菜单进入，`/hotel/price_amount_state`） | `groupid`、`showYesterday`、`enter_from_channel` | ❌ |
 * | 页面 URL（带参跳入，`/hotel/price`，即踩点那份） | 额外有 `poi_id`、`lifeAccountId` | ✅ 但不是常态 |
 *
 * 踩点文档里的 referer 恰好带 `poi_id`，那是从别处带参跳进来的单店页面；用户走左侧菜单
 * 「商品与货架 → 房价房态管理」进去时，URL 上只有 `groupid`。所以**不能把 `poi_id` 当必需项**。
 *
 * 真正的定位键是 `product_id`：一个房型唯一属于一家门店，RMS 侧的追价台账本来就把
 * `ota_sale_room_type_id`（= 抖音 `product_id`）与 `ota_hotel_id` 成对存着，反查是现成的。
 * 这与「desktop 只当探针、反查交给 RMS」的分工一致 —— desktop 不该为了凑一个 `otaHotelId`
 * 而去操作页面（那会变成主动探测，违背本链路「绝不碰页面」的前提）。
 *
 * 因此 `otaHotelId` 是**尽力而为**的字段：URL 上有就带（省 RMS 一次反查），没有就留空串，
 * **不阻断上报**。
 */
import { toChannelId } from '../../ids';
import type { AppLogger } from '../../../shared/logging';
import type {
  AmountSaveObserved,
  OtaAmountChangeObserved,
} from '../../../shared/types/amount-change';
import type { JsonObject } from '../../../shared/types/json';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import type { AmountChangeAdapter } from '../types';

const DOUYIN_HOTEL_HOSTNAME = 'life.douyin.com';
/**
 * 要监听的页面路径前缀。
 *
 * `/p/travel-ari/hotel/price` 同时覆盖两条真实路由（前缀匹配）：
 * - `/hotel/price_amount_state` —— 走左侧菜单「房价房态管理」进入（真机实测的常态）
 * - `/hotel/price`              —— 带参跳入的单店页面（踩点文档那份）
 *
 * 二期做房态房量时还要放开 `/p/travel-ari/hotel/status`（踩点 `修改房态房量.md` 的 referer
 * 是这个路径）—— 光加端点常量不够，页面匹配不上就根本不会 attach。
 */
const WATCH_PATH = '/p/travel-ari/hotel/price';

const POI_ID_PARAM = 'poi_id';
const GROUP_ID_PARAM = 'groupid';
const LIFE_ACCOUNT_ID_PARAM = 'lifeAccountId';

/**
 * 要拦的保存端点。
 *
 * 只收 `save_*`，**不收 `check_*`**：抖音前端每次保存会先打 check 再打 save，两者请求体
 * 完全一样（见踩点 `修改价格.md`）。同时拦会把一次改价上报两遍，而且 check 通过并不代表
 * 用户真的提交了。
 *
 * 二期加房态房量时在这里加一行即可，机制层不用动：
 *   ['batch_save_stock_state_calendar', '/life/trip/hotel/batch_save_stock_state_calendar'],
 */
const SAVE_ENDPOINTS: ReadonlyMap<string, string> = new Map([
  ['save_amount_calendar', '/life/trip/hotel/save_amount_calendar'],
]);

const DOUYIN_CHANNEL = toChannelId('douyin');

function searchParamOf(url: string, param: string): string {
  try {
    return new URL(url).searchParams.get(param)?.trim() ?? '';
  } catch {
    return '';
  }
}

/** 诊断用：这条 URL 上都有哪些查询参数（只要名字，不要值）。 */
function searchParamNamesOf(url: string): readonly string[] {
  try {
    return [...new URL(url).searchParams.keys()];
  } catch {
    return [];
  }
}

/** 诊断用：路径部分，用来确认真实改价页的路由是否与踩点一致。 */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/**
 * 账号 ID：URL 上的 `lifeAccountId` 优先，没有就取请求体里的 `life_account_ids`。
 *
 * 真机实测（走菜单进入）URL 上没有这个参数，但请求体的 `permission_common_param` 里一直有值
 * —— 只读 URL 会让 `channelExtra.lifeAccountId` 白白留空。
 */
function lifeAccountIdOf(pageUrl: string, requestBody: JsonObject): string {
  const fromUrl = searchParamOf(pageUrl, LIFE_ACCOUNT_ID_PARAM);
  if (fromUrl) return fromUrl;
  const param = requestBody.permission_common_param;
  if (typeof param !== 'object' || param === null || Array.isArray(param)) return '';
  const ids = (param as Record<string, unknown>).life_account_ids;
  return typeof ids === 'string' ? ids.trim() : '';
}

function productIdsFromProductList(value: unknown, into: Set<string>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const productId = (item as Record<string, unknown>).product_id;
    if (typeof productId === 'string' && productId.trim().length > 0) into.add(productId.trim());
  }
}

/**
 * 抽出这次改动涉及的所有 `product_id` —— RMS 反查门店的依据。
 *
 * 两个端点的嵌套位置不同，都要认（二期做房态时不必再回来改这里）：
 *
 * ```
 * save_amount_calendar                 { product_list: [{product_id}] }
 * batch_save_stock_state_calendar      { calendar_ari_list: [{ product_list: [{product_id}] }] }
 * ```
 *
 * 用 Set 去重：房态那个端点同一个房型会在 `calendar_ari_list` 里出现多次（房态一条、库存一条）。
 */
function productIdsOf(requestBody: JsonObject): readonly string[] {
  const found = new Set<string>();
  productIdsFromProductList(requestBody.product_list, found);
  const calendarAriList = requestBody.calendar_ari_list;
  if (Array.isArray(calendarAriList)) {
    for (const entry of calendarAriList) {
      if (typeof entry !== 'object' || entry === null) continue;
      productIdsFromProductList((entry as Record<string, unknown>).product_list, found);
    }
  }
  return [...found];
}

/**
 * 抖音的成功判定：`BaseResp.StatusCode === 0`。
 *
 * 与 `price_write.py::_api_status_ok` 对齐。失败样本（踩点 `修改价格.md`）：
 * `103810209 限价规则：发布的【2026-05-28】商品的价格不能低于9元` —— 这种「用户点了保存
 * 但抖音拒绝了」的情况必须判为失败，否则会让 RMS 按一个不存在的价格去跟价。
 */
function isDouyinSaveSuccessful(responseBody: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const baseResp = (parsed as Record<string, unknown>).BaseResp;
  if (typeof baseResp !== 'object' || baseResp === null) return false;
  return (baseResp as Record<string, unknown>).StatusCode === 0;
}

export function createDouyinAmountChangeAdapter(logger: AppLogger): AmountChangeAdapter {
  return {
    saveEndpoints: SAVE_ENDPOINTS,

    isWatchableUrl(url: string): boolean {
      if (!isTrustedHotelUrl(url, DOUYIN_HOTEL_HOSTNAME)) return false;
      return url.includes(WATCH_PATH);
    },

    isSuccessful: isDouyinSaveSuccessful,

    parse(observed: AmountSaveObserved): OtaAmountChangeObserved | null {
      const otaHotelId = searchParamOf(observed.pageUrl, POI_ID_PARAM);
      const merchantGroupId = searchParamOf(observed.pageUrl, GROUP_ID_PARAM);
      const lifeAccountId = lifeAccountIdOf(observed.pageUrl, observed.requestBody);

      // 缺 poi_id 就定位不到门店，这条上报对 RMS 毫无意义。另两个字段是给 RMS 做账号侧
      // 校验/排查用的，缺了不阻断——但要留痕。
      // 真正的定位键是请求体里的 product_id（见文件头）。一个都没有才是硬错误 —— 那说明这次
      // 拦到的东西不是我们以为的改价请求，上报出去只会让 RMS 收到无法处理的数据。
      const productIds = productIdsOf(observed.requestBody);
      if (productIds.length === 0) {
        logger.warn('Douyin amount change: request body had no product_id', {
          endpointId: observed.endpointId,
          pagePath: pathOf(observed.pageUrl),
          requestBodyKeys: Object.keys(observed.requestBody),
        });
        return null;
      }

      // otaHotelId 缺失是常态（走菜单进入的页面 URL 上没有 poi_id），只记 info 备查，不阻断。
      if (!otaHotelId) {
        logger.info('Douyin amount change: no poi_id on page URL, RMS will resolve by product_id', {
          endpointId: observed.endpointId,
          pagePath: pathOf(observed.pageUrl),
          pageParamNames: searchParamNamesOf(observed.pageUrl),
          productIds,
        });
      }

      return {
        source: DOUYIN_CHANNEL,
        endpointId: observed.endpointId,
        otaHotelId,
        channelExtra: {
          merchantGroupId,
          lifeAccountId,
          // 显式带出来：这是 RMS 反查门店的实际依据，不该让它再去 requestBody 里翻。
          productIds,
        },
        requestBody: observed.requestBody,
      };
    },
  };
}
