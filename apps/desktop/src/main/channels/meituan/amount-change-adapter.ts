/**
 * 美团的价量态改动适配器 —— 三渠道里最特殊的一个：**上报的不是保存请求，而是试算结果**。
 *
 * 踩点：`docs/踩点/美团/改价踩点.md`
 * 📄 **上报内容的规格（`changeRaw` 里有什么、RMS 怎么解读）见
 * `./amount-change-payload.ts`** —— 本文件只讲「怎么拦、怎么分流」。
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
 * calcPriceV2                          → { kind: 'context' }  存着，此刻不发（用户可能不提交）
 * updatePriceV2 + createFlag !== true  → null                 预检，丢弃
 * updatePriceV2 + createFlag === true  → { kind: 'report' }   把**存着的那条试算**发出去
 * ```
 *
 * 上报体的 `endpointId` / `endpointUrl` / `changeRaw` 全部指向**试算**那次 —— 内容出处
 * 要如实，不能一半来自试算一半来自提交。
 *
 * ## 两次请求靠什么配对：页面会话 + 取最新
 *
 * `calcPriceV2` 与 `updatePriceV2` 的报文里**没有任何共同 ID**（`traceId` 每次请求都不同）
 * —— 美团自己不需要关联，服务端持有当前价，收到「+1」直接算。
 *
 * 我们靠「同一个页面会话里取最新那条试算」配对。**取最新是安全的**：页面上任何影响价格的
 * 条件变更（改数值、勾选房型、改日期区间、开关周末差异定价）都会触发重算，所以最新那条
 * 天然与提交同条件；且每条 calc 本来就带着当前页面上全量的房型，不存在「算 A 算 B 提交 A」。
 * 状态的生命周期见 `../amount-save-capture.ts` 文件头。
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
import { toMeituanAmountChangeRaw, type MeituanAmountChangeRaw } from './amount-change-payload';

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
 */
const WATCH_PATH = '/ebooking/merchant/product';

/** 保存端点 —— 只有它构成一次真实的改价。 */
const UPDATE_ENDPOINT_ID = 'updatePriceV2';
/** 试算端点 —— 不是改价，拦它只为拿价格素材，见文件头「相对操作」。 */
const CALC_ENDPOINT_ID = 'calcPriceV2';

/**
 * 要拦的端点 —— **两个里只有一个是保存**。
 *
 * `updatePriceV2` 的 `V2` 是美团的接口版本后缀，属于**部署产物**（将来出 V3 就会变），
 * 但与携程那个 `soa2/23783` 服务编号不同：版本号是接口契约的一部分，请求体形状随之改，
 * 届时本适配器的 `parse` 本来就得跟着改，所以这里照实写全，不做模糊匹配。
 *
 * `calcPriceV2` 是用户在页面上填写时前端自己发的试算请求，**永远不会作为独立上报出现**
 * —— `parse` 见到它一律返回 `{ kind: 'context' }`，内容附在下一条 `updatePriceV2` 的上报里。
 *
 * 二期做房态房量时在这里加一行即可，机制层不动 —— 但要先确认房态页的路由是否仍在
 * `WATCH_PATH` 前缀下，不在就得同步放开。
 */
const WATCHED_ENDPOINTS: ReadonlyMap<string, string> = new Map([
  [UPDATE_ENDPOINT_ID, '/api/gw/v1/product/price/updatePriceV2'],
  [CALC_ENDPOINT_ID, '/api/gw/v1/product/price/separate/calcPriceV2'],
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
 * 试算素材，连同只在试算请求里才有的两样一起存：门店 ID 与那次试算的 URL。
 * 上报体的每一个字段都要指向**试算**那次，不能一半来自试算一半来自提交。
 */
type CalcContext = Readonly<{
  otaHotelId: string;
  endpointUrl: string;
  changeRaw: MeituanAmountChangeRaw;
}>;

function isCalcContext(value: JsonObject | null): value is JsonObject & CalcContext {
  if (value === null) return false;
  const raw = value.changeRaw;
  return (
    typeof value.otaHotelId === 'string' &&
    typeof value.endpointUrl === 'string' &&
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw)
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
      // 试算：**上报的素材就是它**，但此刻还不能发 —— 用户可能算完不提交。先存着。
      if (observed.endpointId === CALC_ENDPOINT_ID) {
        const changeRaw = toMeituanAmountChangeRaw(observed.responseBody);
        if (!changeRaw) {
          logger.warn('Meituan amount change: unrecognised calcPriceV2 response, keeping previous', {
            bodySnippet: observed.responseBody.slice(0, 200),
          });
          return null;
        }
        // 门店 ID 只在请求体里、URL 也只有此刻拿得到，一并存下。
        return {
          kind: 'context',
          context: {
            otaHotelId: idToString(observed.requestBody.poiId),
            endpointUrl: observed.endpointUrl,
            changeRaw,
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

      return {
        kind: 'report',
        report: {
          source: MEITUAN_CHANNEL,
          // ⚠️ 上报的是**试算**那条，不是提交那条 —— 这两个字段要如实说明内容的出处。
          endpointId: CALC_ENDPOINT_ID,
          endpointUrl: context.endpointUrl,
          otaHotelId,
          // 发的是试算结果，不是提交体 —— 后者只有相对操作，对 RMS 是死信息（见文件头）。
          changeRaw: context.changeRaw,
        },
      };
    },
  };
}
