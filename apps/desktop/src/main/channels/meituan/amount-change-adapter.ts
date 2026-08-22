/**
 * 美团的价量态改动适配器 —— 当前管**五个端点**：改价（试算 + 提交）、开房、关房、房量。
 *
 * 踩点：`docs/踩点/美团/改价踩点.md`（改价）、`docs/踩点/美团/单房态房量01.md`（房态房量）
 *
 * 📄 **改价上报内容的规格见 `./amount-change-payload.ts`**；房态房量**没有 payload 模型
 * 文件** —— 它们原样透传请求体，没有需要说明的转换（理由见 `parseRoomStatusOrInventory`）。
 * 本文件只讲「怎么拦、怎么分流」。
 *
 * ## 两条路互不相干
 *
 * ```
 * 改价   calcPriceV2 ──素材──► updatePriceV2 ──► 上报（内容取自试算）  changeType: 'price'
 * 量态   inventory/status/switch ──► 上报（当场，原样）                changeType: 'roomStatus'
 *        inventory/update        ──► 上报（当场，原样）                changeType: 'roomStatus'
 * ```
 *
 * 改价那条要跨两个请求配对（下面详述）；量态这条**当场就能上报**，不需要素材，所以
 * `parse` 一进来就先把它们分流出去。两类请求体没有一个字段同名。
 *
 * ⚠️ `inventory/update` 一次请求里**房态与房量并存**（`invSwitch` + `count`），只发一条
 * 上报、不按维度拆 —— 这正是 `changeType` 把量态类统称为 `roomStatus`（意向标记而非精确
 * 分类）的原因。
 *
 * ## 为什么上报试算：提交体算不出绝对价
 *
 * 抖音/携程的保存请求体里价格就是绝对值，原样转发即可。美团的提交体只说「卖价 +1 元」，
 * **不说原来多少钱**，而 RMS 侧没有美团的数据 —— 既算不出结果也无从校验，是死信息。
 * 改前价与改后价只存在于用户填写时页面自己发的 `calcPriceV2` 响应里。
 *
 * ```
 * ① 用户填写   → calcPriceV2    响应含「改前 189.66 → 改后 190.66」  ← 上报的就是它
 * ② 第一次发起 → updatePriceV2  createFlag: false  预检，服务端要求弹窗确认
 * ③ 用户点确认 → updatePriceV2  createFlag: true   ← 只当**触发器**，内容一概不上报
 * ```
 *
 * 于是 `parse` 的分工与另两个渠道反过来：
 *
 * ```
 * unified/calcPriceV2                  → { kind: 'context' }  **空** context —— 清空累积，见下
 * separate/calcPriceV2                 → { kind: 'context' }  累积，此刻不发（用户可能不提交）
 * updatePriceV2 + createFlag !== true  → null                 预检，丢弃（累积原样保留）
 * updatePriceV2 + createFlag === true  → { kind: 'report' }   把**累积的全部格子**发出去
 * ```
 *
 * ## ⚠️ 日期范围变更 —— 用 `unified/calcPriceV2` 清空累积
 *
 * 累积是**只进不出**的：格子按 (房型 × 日期区间 × 周次档) 入键，用户**删掉一个日期段**时
 * 没有任何东西会去删对应的格子，它会一直躺在累积里被一起上报。
 *
 * 美团有两个试算端点，语义不同：
 *
 * ```
 * separate/calcPriceV2   改了某一格的价       响应只带**当次触碰的那一段**
 * unified/calcPriceV2    日期范围的全量快照   响应带**改动后的全部日期段**
 * ```
 *
 * 用户每次增删日期段，页面都会发一条 `unified` —— 它带的是改动**之后**的完整日期列表。
 * 所以见到它就把累积**整个清空**：旧范围下攒的格子全部作废，用户改完范围必然要重新改价，
 * 那些 `separate` 会重新到达、累积自然重建。
 *
 * 踩点实证（`批量改房价-高级改价-时间段改变.md`）：
 *
 * ```
 * #0 unified   两段：09-02~03, 09-08~09     ← 用户选了两个日期段
 * #1 separate  改 09-02~03 的价
 * #2 unified   ★ 只剩 09-02~03              ← 用户删掉了 09-08~09
 * #3 separate  又改 09-02~03 的价
 * ```
 *
 * ⚠️ **不能 `return null` 来表达「清空」** —— 机制层对 null 的处理是「什么都不做」
 * （`if (!parsed) return`，见 `../amount-save-capture.ts`），旧累积会原封不动留着。
 * 必须交出一份**空的 context** 覆盖过去。
 *
 * ⚠️ 曾经用「按提交体过滤过期日期区间」解决这个问题（读 `updatePriceV2` 的提交体，只保留
 * 出现过的日期段）。那个方案已废弃：它要求 desktop **解读提交体语义**，而提交体有两种
 * 形状（基础/日历模式与高级模式字段名不同），只认一种就会返回空集 —— 空集在过滤器里等于
 * 「一格都不保留」，**整条上报清零**。用渠道自己发的快照做判据，失效方式温和得多。
 *
 * 上报体的 `endpointId` / `endpointUrl` / `changeRaw` 全部指向**试算**那次 —— 内容出处
 * 要如实，不能一半来自试算一半来自提交。
 *
 * ## 两次请求靠什么配对：页面会话 + **逐格累积**
 *
 * `calcPriceV2` 与 `updatePriceV2` 的报文里**没有任何共同 ID**（`traceId` 每次请求都不同）
 * —— 美团自己不需要关联，服务端持有当前价，收到「+1」直接算。
 *
 * 我们靠「同一个页面会话里累积全部试算」配对。
 *
 * ⚠️ **早先这里写的是「取最新」，那是错的**（2026-08-22 踩点推翻）。当时基于单房型样本
 * 以为「每条 calc 都带着页面上全量的房型」，实测**不是** —— 美团只重算用户当次触碰的那
 * 一部分：
 *
 * ```
 * calc①  勾选 3 个房型      goodsList=[A, B, C]
 * calc②  开周末差异定价      goodsList=[A]        ← 只重算 A
 * calc③  改数值             goodsList=[A]
 * calc④  改第三个房型        goodsList=[C]        ← 取最新的话只剩 C
 * 提交    3 个房型 6 个价格档                      ← 用户改了 3 个，只报 1 个
 * ```
 *
 * 所以改成按 **(房型 × 日期区间 × 周次档)** 累积、同格后到覆盖先到（改前价保留首次），
 * 提交时把累积的格子重建成 `goodsDetails[]`。累积逻辑见 `./amount-change-payload.ts`
 * 的「累积」一节，状态的生命周期见 `../amount-save-capture.ts` 文件头。
 *
 * ## ⚠️ 累积不保证与提交完全一致 —— 这是**有意不处理**的
 *
 * 累积再完整也补不齐两种偏离：美团**没为某些档发过 calc**，以及用户改完数值**没再触发
 * calc** 就提交。desktop **不对账、不判断素材可不可信**：
 *
 * - 服务端明确不消费对账结果（`client-feedback.md` §1），改价解析照常读 `goodsDetails`
 * - 判断「这个价可不可信」需要卖价 + 底价 + 佣金率三元组，只比 `salePrice` 一项得不出
 *   可靠结论 —— 那是 RMS 的职责，不是探针的
 *
 * 唯一做的过滤是**按提交体裁掉过期日期区间**（见 `rebuildGoodsDetails` 的 `keep`），
 * 那是为了不上报用户已经放弃的中间状态，不是对账。
 *
 * ## ⚠️ 为什么必须看 `createFlag`
 *
 * ②③打的是**同一个端点**，60 个字段里只有 `createFlag` 不同，**响应也完全一样**
 * （仅 `traceId` 与流水号不同）—— 靠响应区分不了，只能看这个字段。
 *
 * 不看的后果：**重复上报**（两条 `operationId` 不同，RMS 幂等挡不住）、**假成功**
 * （②的 `success: true` 只代表「校验通过、请确认」，用户点取消价格根本没改）。
 * 与抖音「只收 `save_*` 不收 `check_*`」同一类问题、同一种解法。
 *
 * 不依赖「弹窗是否必现」：按字段值分流，走两段时只发③触发的那条，只发一次且为 true 时
 * 照常上报，两种都正确。见到 `false` 仍记 info —— 美团将来改行为时能第一时间看见。
 *
 * ## 房型 ID 取 `goodsId`，不取 `preGoodsId`
 *
 * 每条 `goodsList[].goodsBaseInfo` 里有两个 ID：`goodsId`（数字，美团当前的房型主键，
 * RMS 追价台账的 `ota_sale_room_type_id` 存的就是它）与 `preGoodsId`（ObjectId 形状的
 * 历史遗留 ID）。一并带出去只会让 RMS 多一次「哪个才是」的判断，所以只收前者。
 */import { toChannelId } from '../../ids';
import type { AppLogger } from '../../../shared/logging';
import type { AmountSaveObserved } from '../../../shared/types/amount-change';
import type { JsonObject } from '../../../shared/types/json';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import type { AmountChangeAdapter, AmountParseResult } from '../types';
import {
  extractMeituanCalcCells,
  mergeMeituanCalcCells,
  rebuildGoodsDetails,
  toMeituanAmountChangeRaw,
  type MeituanCalcCell,
} from './amount-change-payload';

const MEITUAN_HOTEL_HOSTNAME = 'me.meituan.com';

/**
 * 要监听的页面路径前缀 —— 取自踩点那份 curl 的 referer
 * `https://me.meituan.com/ebooking/merchant/product/batch-price`。
 *
 * 只写到 `/ebooking/merchant/product` 而不是完整的 `batch-price`：同一「商品」模块下的
 * 改价入口不止批量设价一处（单房型改价、日历改价都挂在这个前缀下），多认几个兄弟路由的
 * 成本是零，漏认的代价是**整条监听被关掉** —— `AmountChangeWatcher` 见到不可监听的 URL
 * 会 `stopWatching()` → `detach()`，此后这个 tab 再改多少次价都拦不到（携程真机踩过这个坑，
 * 见 `ctrip/amount-change-adapter.ts` 的 `WATCH_PATHS` 注释）。
 *
 * ## 加房态房量时**无需**改这里（2026-08-13 已核对，别再排查一遍）
 *
 * 当初「多认兄弟路由」的取舍在这里兑现了 —— 三种场景的页面级 URL 实为同一个：
 *
 * ```
 * /ebooking/merchant/product#/batch-price    改价（批量）
 * /ebooking/merchant/product#/index          改价（非批量）
 * /ebooking/merchant/product#/index          房态房量     ← 踩点 referer 实测
 * ```
 *
 * `#/index` 是 **hash 路由**，hash 不参与 `pathname` 匹配，所以前缀早已覆盖。
 *
 * 三渠道对照：**只有抖音房态需要放开页面路径**（在 `/hotel/status`，是另一条路由），
 * 携程（房态页即改价日历页）与美团都不用。
 */
const WATCH_PATH = '/ebooking/merchant/product';

/** 保存端点 —— 只有它构成一次真实的改价。 */
const UPDATE_ENDPOINT_ID = 'updatePriceV2';
/** 试算端点 —— 不是改价，拦它只为拿价格素材，见文件头「相对操作」。 */
const CALC_ENDPOINT_ID = 'calcPriceV2';
/**
 * **日期范围快照** —— 用户每次改动日期范围（增删日期段）时页面会发它，
 * 带的是**改动后的全量日期列表**。拦它只为一件事：**清空累积**，见文件头。
 */
const RANGE_ENDPOINT_ID = 'unifiedCalcPriceV2';
/**
 * 单独**开房**（把某房型某日期的可售状态打开）。
 *
 * ⚠️ 只管开房 —— 关房走的是另一个端点（`ROOM_CLOSE_ENDPOINT_ID`，要走审核）。
 * 2026-08-13 真机联调踩到的坑，详见 `./room-close-payload.ts` 文件头。
 */
const ROOM_STATUS_ENDPOINT_ID = 'inventory-status-switch';
/** **关房** —— 独立端点、独立形状、要走审核。规格见 `./room-close-payload.ts`。 */
const ROOM_CLOSE_ENDPOINT_ID = 'inventory-roomstatus-submitaudit';
/** 改房量 —— ⚠️ 同一请求里**顺带带房态**（`invSwitch`），见文件头。 */
const INVENTORY_ENDPOINT_ID = 'inventory-update';

/**
 * 要拦的端点 —— **五个里只有四个构成上报**。
 *
 * | endpointId | 用途 | 上报吗 |
 * |---|---|---|
 * | `updatePriceV2` | 改价提交 | ✅ `changeType: 'price'` |
 * | `calcPriceV2` | 改价试算 | ❌ 只作素材（`{ kind: 'context' }`） |
 * | `inventory-status-switch` | **开**房 | ✅ `changeType: 'roomStatus'` |
 * | `inventory-roomstatus-submitaudit` | **关**房（走审核） | ✅ `changeType: 'roomStatus'` |
 * | `inventory-update` | 改房量（顺带房态） | ✅ `changeType: 'roomStatus'` |
 *
 * ⚠️ **开房与关房不是同一个端点**（2026-08-13 真机联调发现，踩点 `单房态房量01.md` 里
 * 看不出来）。最初只认了 `status/switch`，结果关房**一次都拦不到** —— 用户连点四次关房，
 * 日志里全是之前开房留下的 `status: 1`。关房详见 `./room-close-payload.ts`。
 *
 * `updatePriceV2` 的 `V2` 是美团的接口版本后缀，属于**部署产物**（将来出 V3 就会变），
 * 但与携程那个 `soa2/23783` 服务编号不同：版本号是接口契约的一部分，请求体形状随之改，
 * 届时本适配器的 `parse` 本来就得跟着改，所以这里照实写全，不做模糊匹配。
 *
 * `calcPriceV2` 是用户在页面上填写时前端自己发的试算请求，**永远不会作为独立上报出现**
 * —— `parse` 见到它一律返回 `{ kind: 'context' }`，内容附在下一条 `updatePriceV2` 的上报里。
 *
 * ## ⚠️ `/inventory/check` **故意不拦**
 *
 * 改房量时美团会先打 `check` 再打 `update`，两者请求体**逐字节相同**（踩点
 * `单房态房量01.md` 两份 curl 的 `--data-raw` 完全一致）。两个都拦 = 一次改动上报两遍，
 * 而两条上报的 `operationId` 不同，**RMS 的幂等挡不住**，会被当成用户改了两次。
 *
 * 这是本链路第三次遇到同一类问题：
 *
 * ```
 * 抖音改价    只收 save_*，不收 check_*      端点层面区分
 * 美团改价    看 createFlag 是否为 true       同端点，靠字段区分
 * 美团房量    只收 update，不收 check         端点层面区分（与抖音同解）
 * ```
 *
 * ## 四个路径互不为子串
 *
 * `matchEndpoint` 是 `url.includes(fragment)` 首个命中即返回，片段之间不能有包含关系。
 * 有单测钉住这一点。
 */
const WATCHED_ENDPOINTS: ReadonlyMap<string, string> = new Map([
  [UPDATE_ENDPOINT_ID, '/api/gw/v1/product/price/updatePriceV2'],
  [CALC_ENDPOINT_ID, '/api/gw/v1/product/price/separate/calcPriceV2'],
  // 日期范围变了 —— 只用来清空累积，不产生上报也不进累积，见文件头。
  [RANGE_ENDPOINT_ID, '/api/gw/v1/product/price/unified/calcPriceV2'],
  [ROOM_STATUS_ENDPOINT_ID, '/api/gw/v1/product/goods/inventory/status/switch'],
  [ROOM_CLOSE_ENDPOINT_ID, '/api/gw/v1/product/goods/inventory/roomstatus/submitaudit'],
  // ⚠️ 只认 `/inventory/update`，**不认** `/inventory/check`（见上方说明）。
  [INVENTORY_ENDPOINT_ID, '/api/gw/v1/product/goods/inventory/update'],
]);

const MEITUAN_CHANNEL = toChannelId('meituan');

/** 美团的 ID 字段在 JSON 里是数字，统一转成字符串（契约里 ID 一律是 string）。 */
function idToString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

/** 这次改动涉及的房型 —— `goodsList[].goodsBaseInfo.goodsId`，保持出现顺序并去重。 */
function goodsIdsOf(requestBody: JsonObject): readonly string[] {
  const list = requestBody.goodsList;
  if (!Array.isArray(list)) return [];
  const found = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const baseInfo = (item as Record<string, unknown>).goodsBaseInfo;
    if (typeof baseInfo !== 'object' || baseInfo === null || Array.isArray(baseInfo)) continue;
    const goodsId = idToString((baseInfo as Record<string, unknown>).goodsId);
    if (goodsId) found.add(goodsId);
  }
  return [...found];
}

/**
 * 房量请求体里这次改动涉及的房型 —— **三个列表都收**。
 *
 * ```
 * modifyInventoryModelList[]
 *   └── modifyInventorySubjectsModel
 *         ├── dayRoomIdList[]    日房      踩点样本里唯一有值的
 *         ├── hourRoomIdList[]   钟点房    无样本，但字段名摆明了是房型
 *         └── goodsIdList[]      商品      踩点里是空数组
 * ```
 *
 * 只收 `dayRoomIdList` 会在钟点房场景把整次操作误判成「没有房型标识」而丢弃 —— 宁可多认。
 * 仅用于「拦到的是不是一次真实操作」的判定，不进上报体（`changeRaw` 里有全量）。
 */
function inventoryRoomIdsOf(requestBody: JsonObject): readonly string[] {
  const models = requestBody.modifyInventoryModelList;
  if (!Array.isArray(models)) return [];
  const found = new Set<string>();
  for (const model of models) {
    if (typeof model !== 'object' || model === null || Array.isArray(model)) continue;
    const subjects = (model as Record<string, unknown>).modifyInventorySubjectsModel;
    if (typeof subjects !== 'object' || subjects === null || Array.isArray(subjects)) continue;
    for (const key of ['dayRoomIdList', 'hourRoomIdList', 'goodsIdList']) {
      const list = (subjects as Record<string, unknown>)[key];
      if (!Array.isArray(list)) continue;
      for (const id of list) {
        const roomId = idToString(id);
        if (roomId) found.add(roomId);
      }
    }
  }
  return [...found];
}

/**
 * 开房与关房的房型标识 —— 两者都在**顶层**，但关房多一个 `goodsIds`。
 *
 * ```
 * status/switch            { roomId }                物理房型
 * roomstatus/submitaudit   { roomId, goodsIds:[…] }  物理房型 + 其下全部售卖商品
 * ```
 *
 * `goodsIds` 与改价那条路的 `goodsBaseInfo.goodsId` 同源（RMS 台账的
 * `ota_sale_room_type_id`），所以一并收 —— 仅用于「拦到的是不是一次真实操作」的判定，
 * 不进上报体（`changeRaw` 里有全量）。
 */
function topLevelRoomIdsOf(requestBody: JsonObject): readonly string[] {
  const found = new Set<string>();
  const roomId = idToString(requestBody.roomId);
  if (roomId) found.add(roomId);
  if (Array.isArray(requestBody.goodsIds)) {
    for (const goodsId of requestBody.goodsIds) {
      const id = idToString(goodsId);
      if (id) found.add(id);
    }
  }
  return [...found];
}

/**
 * 累积中的试算素材 —— **进程内暂存，永不外发**。
 *
 * ⚠️ 别把它当契约的一部分：它只活在 `amount-save-capture.ts` 的页面会话里（`detach()`
 * 即销毁），RMS 看不到它。发出去的是 `parse` 在提交时用它**重建**出来的 `changeRaw`。
 *
 * ## 为什么存的是「一格一格」而不是「一份成品 changeRaw」
 *
 * 美团的 `calcPriceV2` **只重算用户当次触碰的那部分**，不是每次都带全量。整条覆盖会让
 * 先算的房型被后算的挤掉 —— 用户改 3 个房型只报 1 个。所以按 (房型 × 日期区间 × 周次档)
 * 累积，见 `amount-change-payload.ts` 的「累积」一节。
 *
 * 门店 ID 与试算 URL 也一并存：上报体的每一个字段都要指向**试算**那次，不能一半来自试算
 * 一半来自提交。
 */
type CalcContext = Readonly<{
  otaHotelId: string;
  endpointUrl: string;
  /** 键 = `${goodsId}|${startDate}|${endDate}|${inWeek}`，见 `meituanCalcCellKey`。 */
  cells: Readonly<Record<string, MeituanCalcCell>>;
  /** 最后一次试算的，重建时沿用。 */
  globalPricePrompt: JsonObject | null;
}>;

/**
 * ⚠️ 必须认 `cells` 而不是旧的 `changeRaw` —— 否则旧形状的 context 会被当成合法值放行，
 * 重建时拿不到任何格子，静默退化成「一条都不报」。
 */
function isCalcContext(value: JsonObject | null): value is JsonObject & CalcContext {
  if (value === null) return false;
  const cells = value.cells;
  return (
    typeof value.otaHotelId === 'string' &&
    typeof value.endpointUrl === 'string' &&
    typeof cells === 'object' &&
    cells !== null &&
    !Array.isArray(cells)
  );
}

/**
 * 美团的成功判定：`code === 10000` **且** `success === true`。
 *
 * 踩点成功样本：`{"code":10000,"error":null,"traceId":"...","data":"hotel_sc_dealing__...","success":true}`
 *
 * 两个都看是有意的冗余：`success` 是布尔语义最明确的那个，`code === 10000` 是美团网关的
 * 成功码。只看其一都存在「网关成功但业务失败」或反之的解读空间，两个都要求为真是**保守**
 * 口径 —— 与携程一致，宁可漏报一次，也不让 RMS 按一个没生效的价格去跟价。
 *
 * ⚠️ `data` 是一个任务串（`hotel_sc_dealing__update_price_and_relation_<partnerId>_<poiId>_<seq>`），
 * 形状上像**异步任务句柄**：美团很可能只是受理了改价，真正写库在后台跑。因此「成功」只代表
 * 受理成功，不等于价格已生效 —— 与携程新模块 `taskId` 同一个性质，风险也一样。
 *
 * `calcPriceV2` 的成功响应同样是这个形状，直接共用 —— 试算失败时不该覆盖上下文
 * （宁可留着上一条也不要存个空结果），所以它也要过这一关。
 */
/*
 * 不收 `endpointId` 形参：美团**五个端点的成功响应信封同构**，无需按端点分支。
 *
 * ```
 * calcPriceV2 / updatePriceV2      {code:10000, success:true, data:"hotel_sc_dealing__…"}
 * inventory/status/switch          {code:10000, success:true, data:true}
 * inventory/roomstatus/submitaudit 同上
 * inventory/update                 同上
 * ```
 *
 * ⚠️ 这个"信封同构"是**当下五个端点的事实**，不是美团的普遍保证。再加端点时要回来核对
 * 它的响应形状，别默认沿用 —— 携程就是三个端点形状两两不同的反例。
 *
 * 只有 `data` 的形状不同（任务串 vs 布尔），而判定本来就不看 `data`，看的是
 * `code` + `success`。与携程那种「三个端点响应形状两两不同、光看响应体分不出自己在判哪个」
 * 的处境不一样，不必为对齐签名而强加一个用不上的分支。函数少一个形参与接口结构兼容。
 */
function isMeituanSaveSuccessful(responseBody: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const envelope = parsed as Record<string, unknown>;
  return envelope.code === 10000 && envelope.success === true;
}

/**
 * 房态（开/关）与房量的解读 —— 三个端点共用这一个函数：定位字段的取法不同（下面按
 * endpointId 分），但**上报体的构造完全一致**（都是 `roomStatus` + 原样透传）。
 *
 * 各自的 `changeRaw` 规格：关房见 `./room-close-payload.ts`；开房与房量没有单独的模型
 * 文件 —— 它们原样透传，没有需要说明的转换。
 *
 * ## `changeRaw` 完全原样，不裁剪
 *
 * 与改价那条路（发的是重塑过的试算结果）相反，这里一个字段都不动：
 *
 * - **没有该剔的噪音** —— 设备指纹与签名（`mtgsig` 等）在 URL 与请求头里，本来就不进
 *   `requestBody`；也没有携程 `holidyInfo` 那种静态字典。
 * - **含义未知的字段更要留** —— `countType`（踩点里 1526/1020/1620/1720 四个值对应房量
 *   设值/清零/+1/-1）、`invSwitch`、`limitChangeValue`、`count` 目前都没踩清语义。
 *   裁剪的判据是「与本次改动无关」，**不是「我们看不看得懂」**：剔了永久丢失，留着 RMS
 *   日后踩清就能直接用。
 *
 * ## 房态房量并存时只发一条
 *
 * `inventory/update` 一次请求里 `invSwitch`（房态）与 `count`/`countType`（房量）都有。
 * **按请求上报一条，不按维度拆**：一次 update 就是用户的一次操作，拆开需要 desktop 先读懂
 * 那些没踩清的字段（违背只当探针的定位），且会生成两个 `operationId` 让 RMS 以为改了两次。
 *
 * 所以两个端点的 `changeType` 都是 `roomStatus` —— 它是**量态类的意向标记**，实际改了
 * 什么由 RMS 从 `changeRaw` 读。见 `OtaChangeType` 的说明。
 */
function parseRoomStatusOrInventory(
  observed: AmountSaveObserved,
  logger: AppLogger,
): AmountParseResult | null {
  // 门店：两个端点都在顶层 `poiId`，是三渠道里最可靠的（美团一次只改一家）。
  const otaHotelId = idToString(observed.requestBody.poiId);

  // 房型定位：三个端点的形状差异极大。
  //
  // ```
  // status/switch              roomId                          顶层单值
  // roomstatus/submitaudit     roomId + goodsIds[]             顶层，goodsIds 是售卖商品
  // inventory/update           …dayRoomIdList[] 等三个列表      嵌在四层结构里
  // ```
  //
  // 关房的 `goodsIds` 一并收：它与改价那条路的 `goodsId` 同源（= RMS 台账的
  // `ota_sale_room_type_id`），**RMS 反查用它比用 roomId 更直接**。见 room-close-payload.ts。
  const roomIds =
    observed.endpointId === INVENTORY_ENDPOINT_ID
      ? inventoryRoomIdsOf(observed.requestBody)
      : topLevelRoomIdsOf(observed.requestBody);

  // 硬错误：一个房型都取不到，说明拦到的不是我们以为的操作。
  if (roomIds.length === 0) {
    logger.warn('Meituan room status: request body had no room identifiers', {
      endpointId: observed.endpointId,
      requestBodyKeys: Object.keys(observed.requestBody),
    });
    return null;
  }

  if (!otaHotelId) {
    logger.warn('Meituan room status: no poiId, RMS will resolve by room id', {
      endpointId: observed.endpointId,
      roomIds,
    });
  }

  return {
    kind: 'report',
    report: {
      source: MEITUAN_CHANNEL,
      changeType: 'roomStatus',
      endpointId: observed.endpointId,
      endpointUrl: observed.endpointUrl,
      otaHotelId,
      changeRaw: observed.requestBody,
    },
  };
}

export function createMeituanAmountChangeAdapter(logger: AppLogger): AmountChangeAdapter {
  return {
    watchedEndpoints: WATCHED_ENDPOINTS,

    isWatchableUrl(url: string): boolean {
      if (!isTrustedHotelUrl(url, MEITUAN_HOTEL_HOSTNAME)) return false;
      const { pathname } = new URL(url);
      return pathname.startsWith(WATCH_PATH);
    },

    isSuccessful: isMeituanSaveSuccessful,

    parse(observed: AmountSaveObserved, context: JsonObject | null): AmountParseResult | null {
      // 房态房量：与改价那条路完全独立（请求体没有一个字段同名），先分流出去。
      // 不参与下面的 calc/update 配对 —— 它们是**当场就能上报**的，不需要素材。
      if (
        observed.endpointId === ROOM_STATUS_ENDPOINT_ID ||
        observed.endpointId === ROOM_CLOSE_ENDPOINT_ID ||
        observed.endpointId === INVENTORY_ENDPOINT_ID
      ) {
        return parseRoomStatusOrInventory(observed, logger);
      }

      // 日期范围变了 —— 清空累积，从零开始重累。见文件头「日期范围变更」。
      //
      // ⚠️ **不能 `return null`**：机制层对 null 的处理是「什么都不做」（`if (!parsed) return`
      // ，见 `../amount-save-capture.ts`），旧累积会原封不动留着。要真清掉必须交出一份
      // **空的 context** 覆盖过去。
      if (observed.endpointId === RANGE_ENDPOINT_ID) {
        const otaHotelId = idToString(observed.requestBody.poiId);
        logger.info('Meituan amount change: date range changed, resetting accumulated cells', {
          endpointId: observed.endpointId,
          dropped: isCalcContext(context) ? Object.keys(context.cells).length : 0,
        });
        return {
          kind: 'context',
          context: {
            otaHotelId,
            endpointUrl: observed.endpointUrl,
            cells: {},
            globalPricePrompt: null,
          },
        };
      }

      // 试算：**上报的素材就是它**，但此刻还不能发 —— 用户可能算完不提交。先累积着。
      if (observed.endpointId === CALC_ENDPOINT_ID) {
        const changeRaw = toMeituanAmountChangeRaw(observed.responseBody);
        if (!changeRaw) {
          logger.warn('Meituan amount change: unrecognised calcPriceV2 response, keeping previous', {
            bodySnippet: observed.responseBody.slice(0, 200),
          });
          return null;
        }

        const otaHotelId = idToString(observed.requestBody.poiId);
        // 换门店了：上一家的素材与这次无关，从零开始累积。不清会让两家的格子混在一起，
        // 而键里没有 poiId（同一房型 ID 不会跨店重复，但门店切换时保留旧格子毫无意义）。
        const previous = isCalcContext(context) && context.otaHotelId === otaHotelId
          ? context.cells
          : {};
        if (isCalcContext(context) && context.otaHotelId !== otaHotelId) {
          logger.info('Meituan amount change: poiId changed, resetting accumulated calc cells', {
            previousOtaHotelId: context.otaHotelId,
            otaHotelId,
          });
        }

        const { cells, dropped } = mergeMeituanCalcCells(
          previous,
          extractMeituanCalcCells(changeRaw),
        );
        if (dropped > 0) {
          logger.warn('Meituan amount change: calc cell limit exceeded, dropped oldest', {
            dropped,
            kept: Object.keys(cells).length,
          });
        }

        // 门店 ID 只在请求体里、URL 也只有此刻拿得到，一并存下。
        return {
          kind: 'context',
          context: {
            otaHotelId,
            endpointUrl: observed.endpointUrl,
            cells,
            globalPricePrompt: changeRaw.globalPricePrompt ?? null,
          },
        };
      }

      // 以下是提交（`updatePriceV2`）—— 它只当**触发器**，内容一概不上报，见文件头。

      // 预检请求，用户还没在弹窗点确认。理由见文件头「一次改价会打两遍」。
      if (observed.requestBody.createFlag !== true) {
        logger.info('Meituan amount change: pre-check request (createFlag not true), not reporting', {
          endpointId: observed.endpointId,
          createFlag: observed.requestBody.createFlag,
        });
        return null;
      }

      // 硬错误判定：一个房型都取不到，说明拦到的不是改价请求。
      const goodsIds = goodsIdsOf(observed.requestBody);
      if (goodsIds.length === 0) {
        logger.warn('Meituan amount change: request body had no goodsId', {
          endpointId: observed.endpointId,
          requestBodyKeys: Object.keys(observed.requestBody),
        });
        return null;
      }

      // 没有试算结果就没有可上报的内容 —— 提交体里只有「+1 元」，RMS 既算不出绝对价也
      // 无从校验。理论上不该发生（不试算就没法提交），记 warn 让它一旦发生能被看见。
      if (!isCalcContext(context)) {
        logger.warn('Meituan amount change: no calcPriceV2 result to report, dropping', {
          endpointId: observed.endpointId,
          goodsIds,
          hasContext: context !== null,
        });
        return null;
      }

      // 门店 ID 取自试算那次；万一它缺了，退回提交体里的 `poiId`（两处都是顶层 `poiId`）。
      const otaHotelId = context.otaHotelId || idToString(observed.requestBody.poiId);
      if (!otaHotelId) {
        logger.warn('Meituan amount change: no poiId, RMS will resolve by goodsId', {
          endpointId: CALC_ENDPOINT_ID,
          goodsIds,
        });
      }

      // 重建上报体：把累积的格子拼回 calc 响应的形状（RMS 现有解析逻辑继续有效）。
      // **不做任何过滤** —— 累积到什么就发什么，废弃的日期段已在 `unified` 那一刻清掉了。
      const goodsDetails = rebuildGoodsDetails(context.cells);

      // 素材为空但用户确实提交了 —— 理论上进不来（提交前必然试算过），留一条日志兜底：
      // 失效方式是**静默上报空素材**，没有日志就查不出来。
      if (goodsDetails.length === 0) {
        logger.warn('Meituan amount change: rebuilt goodsDetails is empty, reporting anyway', {
          endpointId: observed.endpointId,
          accumulatedCells: Object.keys(context.cells).length,
        });
      }

      return {
        kind: 'report',
        report: {
          source: MEITUAN_CHANNEL,
          changeType: 'price',
          // ⚠️ 上报的是**试算**那条，不是提交那条 —— 这两个字段要如实说明内容的出处。
          endpointId: CALC_ENDPOINT_ID,
          endpointUrl: context.endpointUrl,
          otaHotelId,
          // 发的是试算结果，不是提交体 —— 后者只有相对操作，对 RMS 是死信息（见文件头）。
          changeRaw: {
            goodsDetails,
            globalPricePrompt: context.globalPricePrompt,
          },
        },
      };
    },
  };
}
