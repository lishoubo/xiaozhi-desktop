/**
 * 携程的价量态改动适配器。
 *
 * 踩点：`docs/踩点/携程/改价.md`
 *
 * ## 与抖音的三处结构性差异
 *
 * | 维度 | 抖音 | 携程 |
 * |---|---|---|
 * | 门店 ID 在哪 | 三处都没有，靠 `product_id` 让 RMS 反查 | **请求体里直接有**：`roomPriceInfoList[].hotelID` |
 * | 一次请求几家店 | 一家 | **可能多家**（踩点响应里同时回了 `115348672` 与 `115582769`） |
 * | 成功判定 | `BaseResp.StatusCode === 0` 一处 | 外层 `code === 200` **且**内层每条 `resultCode === 0` |
 *
 * 第二点是 `design.md` §9 风险 1 预言的「契约可能塞不下第二个渠道」的实际发生：
 * `OtaAmountChangeReport.otaHotelId` 是单值，而携程一次能改多家。**本次不改契约** ——
 * `otaHotelId` 取请求体里出现的第一家（多数场景就是唯一一家），完整清单放
 * `channelExtra.hotelIds`，与抖音把 `productIds` 显式带出来是同一套路。RMS 侧按
 * `source === 'ctrip'` 分支时读 `hotelIds` 即可，不必回 `requestBody` 里翻。
 *
 * ## 房型 ID 的两个来源都要收
 *
 * 请求体每条 `roomPriceInfoList` 项里有 `roomTypeID`（直接改的房型）和 `refRoomIDs`
 * （联动房型 —— 踩点响应的 `roomTypeList: [1587157432, 1582872853]` 证实携程确实一并改了
 * 联动房型的价）。只收 `roomTypeID` 会漏掉联动那部分，RMS 就不知道那些房型的价也变了。
 */
import { toChannelId } from '../../ids';
import type {
  AmountSaveObserved,
  OtaAmountChangeObserved,
} from '../../../shared/types/amount-change';
import type { JsonObject } from '../../../shared/types/json';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import type { AmountChangeAdapter } from '../types';
import type { AppLogger } from '../../../shared/logging';

const CTRIP_EBOOKING_HOSTNAME = 'ebooking.ctrip.com';

/**
 * 要监听的页面路径前缀 —— **两条都要认**（2026-08-11 真机验证纠正）。
 *
 * 最初只写了 `/ebkovsroom/inventory`，因为踩点那份 curl 的 referer 是
 * `/ebkovsroom/inventory/calendar?microJump=true`。真机跑下来发现那只是**日历页**：
 * 用户点「批量设价」后，页面会再跳一次到 `/rateplan/batchPriceSetting`，真正的改价操作
 * （以及保存请求）发生在**那个页面**上。
 *
 * ```
 * /ebkovsroom/inventory/calendar      房价日历页 —— 踩点 referer 停在这里
 *          │  点「批量设价」
 *          ▼
 * /rateplan/batchPriceSetting         真正的改价页 —— 保存请求从这里发出
 * ```
 *
 * 少认后者的后果不是「漏拦一个请求」，而是**监听被整个关掉**：`AmountChangeWatcher`
 * 见到不可监听的 URL 会 `stopWatching()` → `detach()`，此后这个 tab 上再改多少次价都
 * 拦不到。真机日志：
 * `[DIAG] 导航 { url: '.../rateplan/batchPriceSetting', 可监听: false, 当前在监听: true }`
 * 紧跟着就是 `监听已停止`。
 */
const WATCH_PATHS: readonly string[] = ['/ebkovsroom/inventory', '/rateplan/batchPriceSetting'];

/**
 * 要拦的保存端点 —— **携程有两套并存的改价模块**（2026-08-11 真机验证发现）。
 *
 * | 模块 | 页面 | 保存端点 | 来源 |
 * |---|---|---|---|
 * | `ebkovsroom`（老） | `/ebkovsroom/inventory/calendar` | `/api/inventory/batchsetroomprice` | 踩点那份 curl |
 * | `rateplan`（新） | `/rateplan/batchPriceSetting` | `/restapi/soa2/23783/setRCRoomPrice` | 真机实测走的这条 |
 *
 * 踩点文档只覆盖了老模块。真机走左侧菜单「批量设价」进的是 `rateplan` 新模块，
 * 用的是完全不同的 `soa2/23783` 接口 —— 只认踩点那个端点会**一次都拦不到**。
 *
 * 两个都留：不确定哪些账号/入口会走哪一套，多认一个端点的成本只是一行常量。
 * 二期做房态房量时同理在这里加行，但要同步放开 `WATCH_PATHS`。
 *
 * ## 为什么新端点不写死 `soa2/23783`
 *
 * 完整路径是 `/restapi/soa2/<服务ID>/<方法名>`，`23783` 是携程内部的 **SOA 服务编号**
 * （同一会话里 `getRCRoomPriceSetting`、`getRoomPriceReqOrder`、`queryMasterHotelInfo`
 * 都挂在它下面，而房型数据在 `30535`）。这个编号是**部署产物**，携程服务拆分/迁移时会变；
 * 方法名 `setRCRoomPrice` 是业务语义，稳定得多。
 *
 * 写死服务编号的失效方式很糟糕：改了价但不跟价，**且没有任何报错**——日志上与「用户没改价」
 * 完全一样（design.md §9 风险 5）。所以只匹配 `/restapi` 前缀 + 方法名，跳过中间的编号。
 */
const SAVE_ENDPOINTS: ReadonlyMap<string, string> = new Map([
  ['batchsetroomprice', '/ebkovsroom/api/inventory/batchsetroomprice'],
  // 故意不含 `soa2/23783`：见上方说明。机制层是 `url.includes(fragment)`，无法表达
  // 「前缀 + 跳过中间编号 + 方法名」，所以片段只取方法名。误匹配风险由 `isWatchableUrl`
  // 兜底：只有停在携程改价页时才会 attach，那种上下文里不会有别的服务叫这个名字。
  ['setRCRoomPrice', '/setRCRoomPrice'],
]);

const CTRIP_CHANNEL = toChannelId('ctrip');

/**
 * 请求体里要剔除的**框架噪音字段** —— 与「这次改了什么价」毫无关系，纯粹是携程前端
 * 框架塞进去的。剔掉的理由不只是省体积：
 *
 * | 字段 | 是什么 | 为什么必须剔 |
 * |---|---|---|
 * | `reqHead` | 浏览器/设备/UBT 埋点信息 | 含屏幕分辨率、IP、UA 等设备指纹，没必要出本机 |
 * | `cipher` | 每个房型的 `tripsign` 签名串 | **凭证性质**，泄漏有风险，且对 RMS 无用 |
 * | `head` | SOA 框架头（cid/ctok/sid/auth） | 含 `auth` 字段 |
 *
 * **只做剔除，不做任何语义转换** —— 保留原始字段名与结构，RMS 复盘时看到的就是渠道原文。
 */
const NOISE_KEYS: readonly string[] = ['reqHead', 'cipher', 'head'];

/** 剔除框架噪音字段。浅层剔除即可 —— 这三个都在顶层。 */
function stripNoise(requestBody: JsonObject): JsonObject {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(requestBody)) {
    if (NOISE_KEYS.includes(key)) continue;
    kept[key] = value;
  }
  return kept as JsonObject;
}

/** 携程的 ID 字段在 JSON 里是数字，统一转成字符串（契约里 ID 一律是 string）。 */
function idToString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

function roomPriceInfoListOf(requestBody: JsonObject): readonly Record<string, unknown>[] {
  const list = requestBody.roomPriceInfoList;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

/** 这次改动涉及的门店 —— 携程一次可以改多家，保持出现顺序并去重。 */
function hotelIdsOf(requestBody: JsonObject): readonly string[] {
  const found = new Set<string>();
  for (const item of roomPriceInfoListOf(requestBody)) {
    const hotelId = idToString(item.hotelID);
    if (hotelId) found.add(hotelId);
  }
  return [...found];
}

/**
 * 这次改动涉及的房型 —— `roomTypeID`（直接改的）与 `refRoomIDs`（联动改的）都要收。
 * 踩点响应的 `roomTypeList` 同时回了这两类，说明携程确实一并改了联动房型的价。
 */
function roomTypeIdsOf(requestBody: JsonObject): readonly string[] {
  const found = new Set<string>();
  for (const item of roomPriceInfoListOf(requestBody)) {
    const roomTypeId = idToString(item.roomTypeID);
    if (roomTypeId) found.add(roomTypeId);
    if (Array.isArray(item.refRoomIDs)) {
      for (const ref of item.refRoomIDs) {
        const refId = idToString(ref);
        if (refId) found.add(refId);
      }
    }
  }
  return [...found];
}

/**
 * 新模块（`setRCRoomPrice`）的房型列表 —— 字段名与老模块完全不同。
 *
 * ```
 * 老 batchsetroomprice   { roomPriceInfoList: [{ roomTypeID, hotelID, refRoomIDs }] }
 * 新 setRCRoomPrice      { roomPriceInfos:    [{ roomProductId, startDate, endDate }] }
 * ```
 *
 * ⚠️ `excludedRelationRoomProductIds` 是**排除**语义（哪些联动房型不跟着改），与老模块
 * `refRoomIDs` 的「一并改了这些」正好相反 —— **不能收进来**，否则会把明确排除掉的房型
 * 当成改过的报给 RMS。
 */
function roomProductIdsOf(requestBody: JsonObject): readonly string[] {
  const list = requestBody.roomPriceInfos;
  if (!Array.isArray(list)) return [];
  const found = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const productId = idToString((item as Record<string, unknown>).roomProductId);
    if (productId) found.add(productId);
  }
  return [...found];
}

/**
 * 携程的成功判定：**外层 HTTP 语义 + 内层每家门店的结果都要看**。
 *
 * 踩点成功样本：`{code: 200, data: {roomPriceSetResults: [{resultCode: 0, statusDesc: "房价设置成功"}, ...]}}`
 *
 * 只看外层 `code === 200` 不够 —— 携程这类接口的惯例是外层表示「请求处理完了」，
 * 单条业务失败（限价、佣金校验 `checkIllegalCommission` 不过等）体现在
 * `roomPriceSetResults[].resultCode`。抖音那边有 `103810209 限价规则` 的真实失败样本，
 * 携程的 `checkIllegalCommission: "T"` 说明同样存在服务端拒绝的路径。
 *
 * 判定取**保守**口径：任何一条 `resultCode !== 0` 就整体判失败，不上报。宁可漏报一次
 * 部分成功的改价，也不让 RMS 按一个没生效的价格去跟价（跟价错了是脏数据，漏报只是少跟一次）。
 */
function isCtripSaveSuccessful(responseBody: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;

  const envelope = parsed as Record<string, unknown>;

  // 新模块 `setRCRoomPrice`：`{ taskId, resStatus: {rcode}, ResponseStatus: {Ack, Errors} }`
  // 两个都要看：`rcode` 是业务码，`Ack`/`Errors` 是携程 SOA 框架层的结果。
  if (envelope.resStatus !== undefined || envelope.ResponseStatus !== undefined) {
    return isNewModuleSuccessful(envelope);
  }

  // 老模块 `batchsetroomprice`：外层 code + 每家门店的 resultCode。
  if (envelope.code !== 200) return false;

  const data = envelope.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;

  const results = (data as Record<string, unknown>).roomPriceSetResults;
  // 没有结果明细就无从确认真的写进去了，判失败。
  if (!Array.isArray(results) || results.length === 0) return false;

  return results.every((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
    return (item as Record<string, unknown>).resultCode === 0;
  });
}

/**
 * 新模块的成功判定。踩点 `改价踩点02.md` 的成功样本：
 *
 * ```json
 * { "taskId": "c6e80580-…_202608",
 *   "resStatus":      { "rcode": 200, "rmsg": "" },
 *   "ResponseStatus": { "Ack": "Success", "Errors": [] } }
 * ```
 *
 * ⚠️ `taskId` 说明这是**异步任务**：携程收下了改价请求，真正写库在后台跑。所以「成功」
 * 只代表**受理成功**，不等于价格已生效 —— 见 design.md §12.5 的风险说明。
 */
function isNewModuleSuccessful(envelope: Record<string, unknown>): boolean {
  const resStatus = envelope.resStatus;
  if (typeof resStatus !== 'object' || resStatus === null || Array.isArray(resStatus)) return false;
  if ((resStatus as Record<string, unknown>).rcode !== 200) return false;

  const responseStatus = envelope.ResponseStatus;
  // 框架层状态缺失时只认业务码 —— 有 rcode 200 已是明确的受理成功信号。
  if (
    typeof responseStatus !== 'object' ||
    responseStatus === null ||
    Array.isArray(responseStatus)
  ) {
    return true;
  }

  const status = responseStatus as Record<string, unknown>;
  if (status.Ack !== undefined && status.Ack !== 'Success') return false;
  if (Array.isArray(status.Errors) && status.Errors.length > 0) return false;
  return true;
}

export function createCtripAmountChangeAdapter(logger: AppLogger): AmountChangeAdapter {
  return {
    saveEndpoints: SAVE_ENDPOINTS,

    isWatchableUrl(url: string): boolean {
      if (!isTrustedHotelUrl(url, CTRIP_EBOOKING_HOSTNAME)) return false;
      const { pathname } = new URL(url);
      return WATCH_PATHS.some((watchPath) => pathname.startsWith(watchPath));
    },

    isSuccessful: isCtripSaveSuccessful,

    parse(observed: AmountSaveObserved): OtaAmountChangeObserved | null {
      const hotelIds = hotelIdsOf(observed.requestBody);
      const roomTypeIds = roomTypeIdsOf(observed.requestBody);
      const roomProductIds = roomProductIdsOf(observed.requestBody);

      // 硬错误判定：两套模块的房型字段一个都取不到，说明拦到的不是改价请求
      // —— 上报出去只会让 RMS 收到无法处理的数据。
      //
      // 注意**不能**再用「没有 hotelID 就丢弃」：新模块 `setRCRoomPrice` 的请求体里
      // 根本没有门店 ID（踩点 `改价踩点02.md` 确认），那样会把新模块的改价全部丢掉。
      if (roomTypeIds.length === 0 && roomProductIds.length === 0) {
        logger.warn('Ctrip amount change: request body had no room identifiers', {
          endpointId: observed.endpointId,
          requestBodyKeys: Object.keys(observed.requestBody),
        });
        return null;
      }

      // 一次请求改多家门店是老模块的形状，而契约的 otaHotelId 是单值。记一条 info
      // 备查：真出现时 RMS 侧要确认是按 hotelIds 全量处理的，别只认了第一家。
      if (hotelIds.length > 1) {
        logger.info('Ctrip amount change: one save spans multiple hotels', {
          endpointId: observed.endpointId,
          hotelIds,
        });
      }

      // 新模块没有门店 ID，RMS 要靠 roomProductIds 反查 —— 与抖音靠 product_id 反查同理。
      if (hotelIds.length === 0) {
        logger.info('Ctrip amount change: no hotelID in body, RMS will resolve by room product', {
          endpointId: observed.endpointId,
          roomProductIds,
        });
      }

      return {
        source: CTRIP_CHANNEL,
        endpointId: observed.endpointId,
        endpointUrl: observed.endpointUrl,
        // 单值契约的代价：取第一家。新模块没有门店 ID 时是空串（尽力而为，不阻断）。
        otaHotelId: hotelIds[0] ?? '',
        requestBody: stripNoise(observed.requestBody),
        responseBody: observed.responseBody,
      };
    },
  };
}
