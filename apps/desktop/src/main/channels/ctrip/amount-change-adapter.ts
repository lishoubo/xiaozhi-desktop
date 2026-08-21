/**
 * 携程的价量态改动适配器 —— 当前管**五个端点**，分布在**三个菜单**上。
 *
 * 踩点：`docs/踩点/携程/` 下的 `改价.md`、`房量01.md`、`日历菜单-价量态修改踩点.md`、
 * `房价维护菜单踩点.md`、`房态房量菜单.md`。
 *
 * 📄 **上报内容的规格（`changeRaw` 里有什么、RMS 怎么解读）分成三份，按 `endpointId` 看：**
 * - 改价（三个端点）→ `./amount-change-payload.ts`（含新老两套模块怎么分辨）
 * - 房态·日历菜单 → `./room-status-payload.ts`（`roomStatus` 是 `G`/`N` **字符串**）
 * - 房态房量·新菜单 → `./room-status-quantity-payload.ts`（`roomStatus` 是 `1`/`2` **数字**）
 *
 * 本文件只讲「怎么拦、怎么判、怎么定位」。
 *
 * ## 三个菜单、五个端点，共用一套机制，只在适配器内分流
 *
 * ```
 * /ebkovsroom/inventory/calendar              日历菜单（改价与房态同页）
 *   ├── 改价 → batchsetroomprice              → changeType: 'price'
 *   └── 房态 → setbatchroombookablestatus     → changeType: 'roomStatus'   G/N 字符串
 *
 * /rateplan/batchPriceSetting                 房价维护菜单（同页两个改价变体）
 *   ├── 逐项设价   → setRCRoomPrice           → changeType: 'price'
 *   └── 统一加减价 → setUniformRCRoomPrice    → changeType: 'price'
 *
 * /rateplan/batchSetRoomStatusAndQuantity     房态房量菜单（只有批量入口）
 *   └── 房态+房量 → batchUpdateRoomStatusAndQuantity → changeType: 'roomStatus'  1/2 数字
 * ```
 *
 * 请求体形状**四类互不相同**（改价老 `roomPriceInfoList` / 改价新 `roomPriceInfos` /
 * 房态老 `hotelRoomInfoDtoList` / 房态房量 `roomProductIds`），⚠️ 连**两个房态端点之间都
 * 没有一个字段同名**。所以 `parse` 与 `isSuccessful` 都先按 `endpointId` 分流，各走各的
 * 取值逻辑，不共用、不靠形状自辨。
 *
 * 开房与关房在**两个房态端点内部**都**不拆两个 `endpointId`**：同端点、同形状，整个请求体
 * 只差 `roomStatus` 一个字段的取值。拆了等于让 desktop 解读渠道语义，与「忠实透传」的定位
 * 冲突。（美团相反：那边开关房是两个独立端点。）
 *
 * ⚠️ 两个房态端点表达开关房用的是**不同形式**（`"G"`/`"N"` vs `1`/`2`），desktop
 * **不归一化** —— 归一化属于语义转换。RMS 须按 `endpointId` 分别解读。
 *
 * ## 与抖音的三处结构性差异
 *
 * | 维度 | 抖音 | 携程 |
 * |---|---|---|
 * | 门店 ID 在哪 | 三处都没有，靠 `product_id` 让 RMS 反查 | 老模块 `roomPriceInfoList[].hotelID` 有；**新模块没有** |
 * | 一次请求几家店 | 一家 | **可能多家**（踩点响应里同时回了 `115348672` 与 `115582769`） |
 * | 成功判定 | `BaseResp.StatusCode === 0` 一处 | 老模块外层 `code` + 内层每条 `resultCode`；新模块 `resStatus.rcode` + `ResponseStatus.Ack` |
 *
 * 第二点是 `design.md` §9 风险 1 预言的「契约可能塞不下第二个渠道」的实际发生：
 * `OtaAmountChangeReport.otaHotelId` 是单值，而携程一次能改多家。**不改契约** ——
 * `otaHotelId` 取第一家（多数场景就是唯一一家），完整清单本来就在 `changeRaw` 里。
 * ⚠️ RMS 必须遍历 `changeRaw.roomPriceInfoList[].hotelID` 全量处理，只认 `otaHotelId`
 * 会漏掉同一次保存里的其他门店。
 *
 * ## 房型 ID 的两个来源都要收（用于「拦到的是不是改价请求」的判定）
 *
 * 老模块每条 `roomPriceInfoList` 项里有 `roomTypeID`（直接改的房型）和 `refRoomIDs`
 * （联动房型 —— 踩点响应的 `roomTypeList: [1587157432, 1582872853]` 证实携程确实一并改了
 * 联动房型的价）；新模块则是 `roomPriceInfos[].roomProductId`。三者任一有值就说明这是
 * 一次真实的改价，全空才丢弃。
 *
 * ⚠️ **不能收 `excludedRelationRoomProductIds`** —— 那是「排除这些联动房型」的相反语义。
 */import { toChannelId } from '../../ids';
import type { AmountSaveObserved } from '../../../shared/types/amount-change';
import type { JsonObject } from '../../../shared/types/json';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import type { AmountChangeAdapter, AmountParseResult } from '../types';
import { toCtripAmountChangeRaw } from './amount-change-payload';
import { toCtripRoomStatusRaw } from './room-status-payload';
import { toCtripRoomStatusQuantityRaw } from './room-status-quantity-payload';
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
 *
 * ## 日历菜单的房态**无需**改这里，房态房量菜单**必须**改（别混为一谈）
 *
 * 日历菜单房态踩点的 referer 是 `/ebkovsroom/inventory/calendar?microJump=true` —— 就是
 * 改价老模块那张**日历页**，已被第一条前缀覆盖。房态与改价在那个菜单里是同一页面上的两个操作。
 *
 * 但**房态房量菜单是另一条路由** `/rateplan/batchSetRoomStatusAndQuantity`，光加端点常量
 * 不够，必须同时放开这里 —— 否则页面匹配不上，`AmountChangeWatcher` 会按上面描述的路径
 * 把整个 tab 的监听 detach 掉。这一点与抖音房态（另起 `/hotel/status` 路由）同理。
 *
 * ## ⚠️ 三条前缀两两互不为前缀，且**不要图省事写成 `/rateplan`**
 *
 * ```
 * /ebkovsroom/inventory                      日历菜单（改价老 + 房态老）
 * /rateplan/batchPriceSetting                房价维护菜单（改价新 ×2）
 * /rateplan/batchSetRoomStatusAndQuantity    房态房量菜单   ← 与上一条第二段就分叉
 * ```
 *
 * 写成 `/rateplan` 会把该前缀下**所有**子页面都纳入监听，无谓扩大 CDP attach 面（attach
 * 本身要与酒店探测抢调试通道）。按页面精确声明。
 */
const WATCH_PATHS: readonly string[] = [
  '/ebkovsroom/inventory',
  '/rateplan/batchPriceSetting',
  '/rateplan/batchSetRoomStatusAndQuantity',
];

/**
 * 要拦的端点 —— 携程当前认**五个**，分布在**三个菜单**上：改价三个 + 房态两个。
 *
 * | 菜单 | 用途 | 页面 | 端点方法名 | 来源 |
 * |---|---|---|---|---|
 * | 日历 | 改价 | `/ebkovsroom/inventory/calendar` | `batchsetroomprice` | 踩点 `改价.md` |
 * | 日历 | 房态 | `/ebkovsroom/inventory/calendar` | `setbatchroombookablestatus` | 踩点 `房量01.md` |
 * | 房价维护 | 改价·逐项 | `/rateplan/batchPriceSetting` | `setRCRoomPrice` | 2026-08-11 真机 |
 * | 房价维护 | 改价·统一加减 | `/rateplan/batchPriceSetting` | `setUniformRCRoomPrice` | 踩点 `房价维护菜单踩点.md` |
 * | 房态房量 | 房态+房量 | `/rateplan/batchSetRoomStatusAndQuantity` | `batchUpdateRoomStatusAndQuantity` | 踩点 `房态房量菜单.md` |
 *
 * ## ⚠️ 同一个菜单里可能有多个端点
 *
 * 携程的同类操作分散在多个菜单，**同一个页面上的不同操作变体还会走不同端点**：房价维护页
 * 的「逐项设价」与「统一加减价」就是两个端点。只认其中一个，另一个的改动**静默漏报** ——
 * 日志上与「用户根本没改」完全一样。这是本渠道反复踩到的同一类坑（2026-08-11 只认踩点里的
 * 老改价端点、真机一次都拦不到，是同一个成因）。
 *
 * 多认一个端点的成本只是一行常量，漏认一个的代价是查不出来的漏报 —— 取舍很明确。
 *
 * ## 五个片段两两互不为子串，分发不会串味
 *
 * `AmountSaveCapture.matchEndpoint` 是 `url.includes(fragment)` **首个命中即返回**，
 * 所以片段之间不能有包含关系：
 *
 * ```
 * /ebkovsroom/api/inventory/batchsetroomprice            改价老
 * /ebkovsroom/api/inventory/setbatchroombookablestatus   房态老   ← 与上一条前缀相同但
 * /setRCRoomPrice                                        改价新      末段不同，互不为子串
 * /setUniformRCRoomPrice                                 改价新·统一加减 ← `Uniform` 插在
 * /batchUpdateRoomStatusAndQuantity                      房态房量        中间，与上一条互不含
 * ```
 *
 * 两组**看着像**但实际互不包含的：`batchsetroomprice` 与 `setbatchroombookablestatus`
 * （都含 `batch`、`room`）、`setRCRoomPrice` 与 `setUniformRCRoomPrice`（后者不含前者，
 * 因为 `Uniform` 插在 `set` 与 `RCRoomPrice` 之间）。有单测钉住这一点。
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
const WATCHED_ENDPOINTS: ReadonlyMap<string, string> = new Map([
  ['batchsetroomprice', '/ebkovsroom/api/inventory/batchsetroomprice'],
  // 故意不含 `soa2/23783`：见上方说明。机制层是 `url.includes(fragment)`，无法表达
  // 「前缀 + 跳过中间编号 + 方法名」，所以片段只取方法名。误匹配风险由 `isWatchableUrl`
  // 兜底：只有停在携程改价页时才会 attach，那种上下文里不会有别的服务叫这个名字。
  ['setRCRoomPrice', '/setRCRoomPrice'],
  // 同页面的「统一加减价」变体 —— 与逐项设价是**两个端点**，只认一个会漏掉另一个。
  // 请求体与 `setRCRoomPrice` 同构，只多三个加减价字段（adjustmentPrice*），故解析与
  // 成功判定全部复用改价新模块的路径，无需额外分支。
  ['setUniformRCRoomPrice', '/setUniformRCRoomPrice'],
  // 房态（开房/关房共用此端点，靠请求体 `roomStatus` 的 G/N 区分，不拆两个 endpointId）。
  ['setbatchroombookablestatus', '/ebkovsroom/api/inventory/setbatchroombookablestatus'],
  // 房态房量菜单 —— 与上一条是**两个完全不同的房态端点**，零字段同名，见
  // `./room-status-quantity-payload.ts`。开房/关房同样共用此端点，靠 `roomStatus` 的
  // 数字码 1/2 区分（⚠️ 与上一条的 G/N 不同，desktop 两套都原样透传、不归一化）。
  ['batchUpdateRoomStatusAndQuantity', '/batchUpdateRoomStatusAndQuantity'],
]);

/** 日历菜单房态端点的 `endpointId`。判定与解析都要按它分支，抽成常量避免拼错。 */
const ROOM_STATUS_ENDPOINT_ID = 'setbatchroombookablestatus';

/**
 * 房态房量菜单端点的 `endpointId`。与上面那个是**两个不同的房态端点**，请求体零字段同名，
 * 成功判定的响应信封也不同 —— 判定与解析都必须按它单独分支。
 */
const ROOM_STATUS_QUANTITY_ENDPOINT_ID = 'batchUpdateRoomStatusAndQuantity';

const CTRIP_CHANNEL = toChannelId('ctrip');

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
 * 改价新模块（`setRCRoomPrice` / `setUniformRCRoomPrice`）的房型列表 —— 字段名与老模块
 * 完全不同，两个新端点之间则同构。
 *
 * ```
 * 老 batchsetroomprice   { roomPriceInfoList: [{ roomTypeID, hotelID, refRoomIDs }] }
 * 新 setRCRoomPrice      { roomPriceInfos:    [{ roomProductId, relationRoomProducts }] }
 * ```
 *
 * ## ⚠️ 联动房型有**两个语义相反**的字段，只能收其中一个
 *
 * | 字段 | 形状 | 语义 | 收不收 |
 * |---|---|---|---|
 * | `relationRoomProducts` | `[{ roomProductId, mealNum }]` 对象数组 | **一并改了这些** | ✅ 收 |
 * | `excludedRelationRoomProductIds` | `[id, …]` 裸 ID 数组 | **排除这些** | ⛔ **绝不能收** |
 *
 * `relationRoomProducts` 对应老模块的 `refRoomIDs`（也是「一并改了这些」），只是形状从裸
 * ID 数组变成了对象数组，取值要多一层 `.roomProductId`。
 *
 * 收 `excludedRelationRoomProductIds` 会把用户**明确排除**掉的房型当成改过的报给 RMS ——
 * 方向完全反了。两个字段名字长得像，改这段代码时务必看清楚。
 *
 * ⚠️ 漏收 `relationRoomProducts` 是本文件的**既有缺陷**（2026-08-21 修复）：只收
 * `roomProductId` 时，用户若只改联动房型，这次改价会被判成「拦到的不是改价请求」而**整个
 * 丢弃**。这个函数只用于该丢弃判定，不进上报体 —— `changeRaw` 本来就全量透传。
 */
function roomProductIdsOf(requestBody: JsonObject): readonly string[] {
  const list = requestBody.roomPriceInfos;
  if (!Array.isArray(list)) return [];
  const found = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;

    const productId = idToString(entry.roomProductId);
    if (productId) found.add(productId);

    // 联动房型：这些房型的价也一并被改了，与老模块 `refRoomIDs` 同义。
    // ⛔ 注意不是 `excludedRelationRoomProductIds` —— 那个是排除语义，见上表。
    if (Array.isArray(entry.relationRoomProducts)) {
      for (const relation of entry.relationRoomProducts) {
        if (typeof relation !== 'object' || relation === null || Array.isArray(relation)) continue;
        const relationId = idToString((relation as Record<string, unknown>).roomProductId);
        if (relationId) found.add(relationId);
      }
    }
  }
  return [...found];
}

/** 房态请求体里的房型条目 —— 与改价的 `roomPriceInfoList` 是完全不同的字段名。 */
function hotelRoomInfoListOf(requestBody: JsonObject): readonly Record<string, unknown>[] {
  const list = requestBody.hotelRoomInfoDtoList;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

/** 房态涉及的门店 —— 与改价老模块同样可能多家，保持出现顺序并去重。 */
function roomStatusHotelIdsOf(requestBody: JsonObject): readonly string[] {
  const found = new Set<string>();
  for (const item of hotelRoomInfoListOf(requestBody)) {
    const hotelId = idToString(item.hotelID);
    if (hotelId) found.add(hotelId);
  }
  return [...found];
}

/**
 * 房态涉及的房型 —— 两处都收：`hotelRoomInfoDtoList[].roomTypeID` 与顶层
 * `originalRoomProductIds[]`。踩点里两者指向同一批房型，但**只是这一份样本如此**，
 * 不能断定永远相等；两处都收才不会因为携程在某个场景下只填其一而丢掉定位依据。
 *
 * 这里只用于「拦到的是不是一次真实房态操作」的判定，不进上报体（`changeRaw` 里有全量）。
 */
function roomStatusRoomIdsOf(requestBody: JsonObject): readonly string[] {
  const found = new Set<string>();
  for (const item of hotelRoomInfoListOf(requestBody)) {
    const roomTypeId = idToString(item.roomTypeID);
    if (roomTypeId) found.add(roomTypeId);
  }
  const productIds = requestBody.originalRoomProductIds;
  if (Array.isArray(productIds)) {
    for (const productId of productIds) {
      const id = idToString(productId);
      if (id) found.add(id);
    }
  }
  return [...found];
}

/**
 * 携程的成功判定 —— **必须按 `endpointId` 分支**，三个端点的响应形状两两不同：
 *
 * ```
 * batchsetroomprice            {code:200, data:{roomPriceSetResults:[{resultCode}]}}
 * setRCRoomPrice               {resStatus:{rcode}, ResponseStatus:{Ack}}
 * setbatchroombookablestatus   {code:200, returnCode:"200", data:null}   ← 无内层明细
 * ```
 *
 * ## ⚠️ 为什么不能只靠响应形状自辨
 *
 * 房态成功是「`code:200` + 用不了的 `data`」，而改价老模块**响应结构异常**时也是这个样子
 * —— 两者形状上无法区分。真按形状猜，房态的每一次成功都会走进改价老模块分支，然后卡在
 * `data === null` 上判成失败，而失效方式是**静默漏报**：日志上与「用户根本没改房态」
 * 一模一样（2026-08-11 携程改价那次就吃过「监听被悄悄停掉」查不出来的亏）。
 *
 * 改价两套模块之间仍沿用形状自辨（`resStatus` 在不在），因为那两个都是**改价**、
 * 判据本身也没有交叉；房态则必须靠 `endpointId` 明确切开。
 */
function isCtripSaveSuccessful(responseBody: string, endpointId: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;

  const envelope = parsed as Record<string, unknown>;

  if (endpointId === ROOM_STATUS_ENDPOINT_ID) return isRoomStatusSuccessful(envelope);

  // 房态房量菜单：响应是标准 SOA 信封，与改价新模块同构，复用同一判据。
  //
  // ⚠️ **必须显式列出这个分支，不能让它落到下面的形状自辨里**。虽然该端点确实有
  // `resStatus`、落到自辨分支也能判对，但那是**巧合而非契约**：一旦携程给这个端点换个
  // 信封，自辨会把它错判到老模块分支，卡在 `data` 上判成失败 —— 失效方式是静默漏报，
  // 与本文件头警告的、以及 2026-08-13 美团关房全丢的是同一类问题。判据按端点钉死。
  if (endpointId === ROOM_STATUS_QUANTITY_ENDPOINT_ID) return isNewModuleSuccessful(envelope);

  // 新模块 `setRCRoomPrice` / `setUniformRCRoomPrice`：
  // `{ taskId, resStatus: {rcode}, ResponseStatus: {Ack, Errors} }`
  // 两个都要看：`rcode` 是业务码，`Ack`/`Errors` 是携程 SOA 框架层的结果。
  if (envelope.resStatus !== undefined || envelope.ResponseStatus !== undefined) {
    return isNewModuleSuccessful(envelope);
  }

  // 老模块 `batchsetroomprice`：外层 code + 每家门店的 resultCode。
  //
  // 只看外层 `code === 200` 不够 —— 携程这类接口的惯例是外层表示「请求处理完了」，
  // 单条业务失败（限价、佣金校验 `checkIllegalCommission` 不过等）体现在
  // `roomPriceSetResults[].resultCode`。抖音那边有 `103810209 限价规则` 的真实失败样本，
  // 携程的 `checkIllegalCommission: "T"` 说明同样存在服务端拒绝的路径。
  //
  // 判定取**保守**口径：任何一条 `resultCode !== 0` 就整体判失败，不上报。宁可漏报一次
  // 部分成功的改价，也不让 RMS 按一个没生效的价格去跟价（跟价错了是脏数据，漏报只是少跟一次）。
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

/**
 * 房态端点的成功判定。踩点 `房量01.md` 的成功样本（开房/关房共用）：
 *
 * ```json
 * { "code": 200, "message": "房态设置成功。", "totalCount": 0,
 *   "returnCode": "200", "data": null,
 *   "otherData": "房态设置成功。", "extendData": [] }
 * ```
 *
 * ⚠️ **`data` 是 `null`** —— 这个端点没有内层结果明细，成功与否只能看外层。绝不能套用
 * 改价老模块查 `data.roomPriceSetResults[].resultCode` 的路径，那会把每次成功都判成失败。
 *
 * ## 判据：`code` 为主，`returnCode` 只做否决
 *
 * ⚠️ **不能要求 `returnCode` 严格等于字符串 `'200'`** —— 携程这个字段的类型在不同端点间
 * 并不稳定：改价老模块的成功响应里它是 `null`（见 `ctrip-amount-change-adapter.test.ts`
 * 的 `REAL_SUCCESS_RESPONSE`）。房态目前只有一个样本给的是 `"200"`，据此写死会让
 * 「携程哪天改成数字 `200`」或「某个房态变体不给这个字段」变成**每次成功都判失败**，
 * 而失效方式是静默漏报 —— 与本文件头警告的、以及 2026-08-13 美团关房全丢的是同一类问题。
 *
 * 所以：`code === 200` 是主判据；`returnCode` 只在**明确给出且明确不是 200** 时才否决，
 * 缺失或 `null` 都不阻断。数字与字符串都接受。
 *
 * 不认 `message` 的中文文案 —— 文案随时可能改，用它当判据太脆。
 *
 * ⚠️ **只有成功样本，没有失败样本**：携程拒绝房态操作时的响应形状未知，所以这个判定
 * 存在「过松」的风险（把某种失败当成功）。真机若能构造一次失败应抓样本回填踩点文档并收紧。
 */
function isRoomStatusSuccessful(envelope: Record<string, unknown>): boolean {
  if (envelope.code !== 200) return false;
  const returnCode = envelope.returnCode;
  // 缺失/ null 不阻断（携程在别的端点上确实会给 null）；给了值就必须是 200。
  if (returnCode === undefined || returnCode === null) return true;
  return String(returnCode) === '200';
}

/**
 * 房态（开房/关房）的解读。开关方向不在这里判 —— `roomStatus` 的 `G`/`N` 原样留在
 * `changeRaw` 里交给 RMS，desktop 不解读渠道语义。规格见 `./room-status-payload.ts`。
 */
function parseRoomStatus(observed: AmountSaveObserved, logger: AppLogger): AmountParseResult | null {
  const hotelIds = roomStatusHotelIdsOf(observed.requestBody);
  const roomIds = roomStatusRoomIdsOf(observed.requestBody);

  // 硬错误判定：一个房型都取不到，说明拦到的不是房态操作 —— 上报出去 RMS 也处理不了。
  if (roomIds.length === 0) {
    logger.warn('Ctrip room status: request body had no room identifiers', {
      endpointId: observed.endpointId,
      requestBodyKeys: Object.keys(observed.requestBody),
    });
    return null;
  }

  // 与改价老模块同样的单值契约代价：一次可能改多家门店，`otaHotelId` 只放得下第一家。
  // 记 info 备查 —— 真出现时要确认 RMS 侧是遍历 changeRaw 全量处理的。
  if (hotelIds.length > 1) {
    logger.info('Ctrip room status: one save spans multiple hotels', {
      endpointId: observed.endpointId,
      hotelIds,
    });
  }

  // 只有 `originalRoomProductIds` 而没有 `hotelRoomInfoDtoList` 时会走到这里：上报体的
  // `otaHotelId` 是空串，且 `changeRaw` 里也没有任何 `hotelID`，RMS 只能靠房型反查。
  // 与改价分支同一口径记 info —— 真出现时要能在日志里追溯到，而不是只看到一条门店为空的上报。
  if (hotelIds.length === 0) {
    logger.info('Ctrip room status: no hotelID in body, RMS will resolve by room product', {
      endpointId: observed.endpointId,
      roomIds,
    });
  }

  return {
    kind: 'report',
    report: {
      source: CTRIP_CHANNEL,
      changeType: 'roomStatus',
      endpointId: observed.endpointId,
      endpointUrl: observed.endpointUrl,
      // 房态请求体里 hotelID 是有的（不像改价新模块那样缺失）；真缺了也不阻断，留空串
      // 让 RMS 按房型反查。
      otaHotelId: hotelIds[0] ?? '',
      changeRaw: toCtripRoomStatusRaw(observed.requestBody),
    },
  };
}

/**
 * 房态房量菜单涉及的房型 —— **只有顶层 `roomProductIds` 一处**。
 *
 * ⚠️ **不要复用 `roomStatusRoomIdsOf`**：那个函数读的是日历菜单房态端点的
 * `hotelRoomInfoDtoList[].roomTypeID` 与 `originalRoomProductIds`，本端点这两个字段
 * 都不存在（两个房态端点零字段同名，见 `./room-status-quantity-payload.ts`）。
 *
 * 这里只用于「拦到的是不是一次真实房态房量操作」的判定，不进上报体（`changeRaw` 有全量）。
 */
function roomStatusQuantityRoomIdsOf(requestBody: JsonObject): readonly string[] {
  const list = requestBody.roomProductIds;
  if (!Array.isArray(list)) return [];
  const found = new Set<string>();
  for (const item of list) {
    const id = idToString(item);
    if (id) found.add(id);
  }
  return [...found];
}

/**
 * 房态房量菜单（`batchUpdateRoomStatusAndQuantity`）的解读。
 *
 * 开关方向不在这里判 —— `roomStatus` 的数字码（`1` 开 / `2` 关）原样留在 `changeRaw` 里
 * 交给 RMS，desktop 不解读渠道语义，也**不把它归一化成日历菜单那套 `G`/`N`**。
 * 房量三字段同样原样透传（本次 RMS 不解析）。规格见 `./room-status-quantity-payload.ts`。
 */
function parseRoomStatusQuantity(
  observed: AmountSaveObserved,
  logger: AppLogger,
): AmountParseResult | null {
  const roomIds = roomStatusQuantityRoomIdsOf(observed.requestBody);

  // 硬错误判定：一个房型都取不到，说明拦到的不是房态房量操作 —— 上报出去 RMS 也处理不了。
  if (roomIds.length === 0) {
    logger.warn('Ctrip room status/quantity: request body had no room identifiers', {
      endpointId: observed.endpointId,
      requestBodyKeys: Object.keys(observed.requestBody),
    });
    return null;
  }

  // 该端点请求体里**根本没有门店 ID**（踩点已确认），`otaHotelId` 恒为空串。这是**正常
  // 情况不是错误**，所以记 info 而非 warn —— 与改价新模块同一处境，RMS 按房型反查。
  // 一次操作还可能跨多家门店（踩点样本里两个房型就分属两家），RMS 须遍历全量反查。
  logger.info('Ctrip room status/quantity: no hotelID in body, RMS will resolve by room product', {
    endpointId: observed.endpointId,
    roomIds,
  });

  return {
    kind: 'report',
    report: {
      source: CTRIP_CHANNEL,
      changeType: 'roomStatus',
      endpointId: observed.endpointId,
      endpointUrl: observed.endpointUrl,
      // 恒为空串：该端点不暴露门店标识，不为凑这个值去查绑定或操作页面。
      otaHotelId: '',
      changeRaw: toCtripRoomStatusQuantityRaw(observed.requestBody),
    },
  };
}

export function createCtripAmountChangeAdapter(logger: AppLogger): AmountChangeAdapter {
  return {
    watchedEndpoints: WATCHED_ENDPOINTS,

    isWatchableUrl(url: string): boolean {
      if (!isTrustedHotelUrl(url, CTRIP_EBOOKING_HOSTNAME)) return false;
      const { pathname } = new URL(url);
      return WATCH_PATHS.some((watchPath) => pathname.startsWith(watchPath));
    },

    isSuccessful: isCtripSaveSuccessful,

    parse(observed: AmountSaveObserved): AmountParseResult | null {
      // 房态与改价的请求体没有一个字段同名，分流后各走各的，不共用取值逻辑。
      // 两个房态端点之间同样零字段同名，必须各走各的 parse。
      if (observed.endpointId === ROOM_STATUS_ENDPOINT_ID) {
        return parseRoomStatus(observed, logger);
      }
      if (observed.endpointId === ROOM_STATUS_QUANTITY_ENDPOINT_ID) {
        return parseRoomStatusQuantity(observed, logger);
      }

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
        kind: 'report',
        report: {
          source: CTRIP_CHANNEL,
          changeType: 'price',
          endpointId: observed.endpointId,
          endpointUrl: observed.endpointUrl,
          // 单值契约的代价：取第一家。新模块没有门店 ID 时是空串（尽力而为，不阻断）。
          otaHotelId: hotelIds[0] ?? '',
          changeRaw: toCtripAmountChangeRaw(observed.requestBody),
        },
      };
    },
  };
}
