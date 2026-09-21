/**
 * 美团**定时扫描**取数 —— 主动读回某家门店当前的价量态。
 *
 * ## 与回读的关系
 *
 * ```
 *                回读                          扫描（本文件）
 * 触发    用户改完，跟在写操作后面        定时器
 * 发起    页面内 XHR（webContents）       账号会话（partitionName）
 * 范围    只读本次改动命中的房型×日期     该门店**全部日历房** × 整个窗口
 * 产出    上报体（直接发 RMS）            原始行（交给调度层比对基线）
 * 请求数  1（queryRoomStatusInfo）        3（见下）
 * ```
 *
 * ⚠️ **不依赖标签页**是本文件存在的全部理由。2026-09-21 真机验证：标签页开与不开，
 * 房型结构逐项相同（6 realRooms / 9 logicRooms / 24 goods），第二轮还换了 partition
 * （期间重新登录，全新 cookie jar）仍一致；且请求走主进程网络栈，**不被改价监听的
 * CDP 拦到**（探针窗口内基线库零写入）。
 *
 * ## 三步请求
 *
 * ⚠️ 门店清单**不在这里取** —— 它随登录探测写进 `credentialExtra.pois`
 * （见 `meituan/discovery.ts`），由调度层展开成逐门店的扫描目标传进来。
 * 早先这里还有一步 `poiInfos` 用于「校验门店属于本账号」，在门店清单改为随登录
 * 记录之后那层校验的前提就没了（换账号时 `pois` 会跟着更新），且它会让
 * **N 家门店重复发 N 次同样的账号级请求**，已删。
 *
 * ```
 * ① POST /product/goods/queryListAndTag           { poiId, partnerId, filterType,
 *                                                   needDraftGoods, offsetGoodsId }
 *        → realRoomRelations[]
 *            ├── realRoomId ─────────────────┐
 *            └── logicRoomRelations[]        │ 这层关系决定③的房态归到哪个 roomId
 *                  ├── roomBaseInfo.roomId   │
 *                  ├── roomBaseInfo.roomCategory  ⚠️ 钟点房在这里就筛掉
 *                  └── goodsList[].goodsId ──┘
 *        → goodsIds[] + roomIds[]
 *
 * ② POST /product/goods/queryPriceInventoryStatusInfo
 *        → data[].goodsPriceMap[date]   → price 行（goodsId）
 *        ⚠️ 同响应的 goodsStatusMap **刻意不读**，见下
 *
 * ③ POST /product/goods/queryRoomStatusInfo       与回读同一端点、同一响应形状
 *        → data[].roomStatusMap[date]   → roomStatus 行（roomId）
 * ```
 *
 * ## ⚠️ 为什么房态不读②的 `goodsStatusMap`，而要单独发③
 *
 * ③的响应里带房态，但**字段集比④少两个**：
 *
 * ```
 * ③ queryRoomStatusInfo  … roomStatus limitType remainCount limitRemain usedCount invSwitch
 * ② goodsStatusMap       … roomStatus limitType             limitRemain           invSwitch
 *                                      ↑ 缺 remainCount     ↑ 缺 usedCount
 * ```
 *
 * 扫描用②的子集、回读用③的全集，同一格的 `contentHash` 在两条路径上必然不同 ——
 * **每轮扫描都会把回读刚写的格子判成有差异**，误报不会停。多发一次请求换两条路径
 * 彻底同构，值。
 *
 * ⚠️ RMS RPA 侧读②的 `goodsStatusMap` 而不加请求，是因为它有全量同步打底且**不做
 * 逐格比对**。desktop 的基线要支撑 diff，口径一致比省一次请求重要。
 *
 * ## ⚠️ 钟点房在①就筛掉
 *
 * 与携程同构（它在 `getRcProductList` 那步筛 `hourRoom`/`advanceSale`）。2026-09-21
 * 实测：9 个逻辑房型里 **3 个是钟点房**，占三分之一。不筛的话这些房型的数据会混进
 * 基线，而钟点房与日历房**共用同一个 `roomId`** —— 格子键撞在一起，`contentHash`
 * 每轮翻覆，报出的差异是假的。
 *
 * ③的响应侧仍有一道 `roomCategory` 判据（在 `room-status-endpoint.ts` 里），防的是
 * 「只传日历房的 roomId，响应仍夹带该房型的钟点房那一行」—— 那是接口行为，不是设计选择。
 */
import type { AppLogger } from '../../../shared/logging';
import { safeLogErrorDetails } from '../../../shared/logging';
import type { JsonObject } from '../../../shared/types/json';
import type { InventoryScan, InventoryScanOutcome, ScanFetcher } from '../types';
import { parseMeituanResponse } from './session-expiry';
import {
  buildRoomStatusRequest,
  flattenRoomStatusRows,
  MEITUAN_ROOM_STATUS_URL,
} from './room-status-endpoint';
import { ME_API_APPKEY, ME_API_LOGIN_TYPE } from './poi-infos';
import { flattenPriceRows, MEITUAN_PRICE_INVENTORY_URL } from './price-inventory-endpoint';

export { MEITUAN_PRICE_INVENTORY_URL };

const QUERY_LIST_AND_TAG_URL =
  'https://me.meituan.com/api/gw/v1/product/goods/queryListAndTag';

/**
 * 页面地址 —— 只用来填 `Referer`。
 *
 * ⚠️ 连通性验证确认美团只需要这五个头，**无签名头、无 `mtgsig`**。它们由本文件给而不是
 * 注入的 fetcher 写死：哪个页面发的请求、网关认什么头，都是**渠道知识**。
 */
const MEITUAN_PRODUCT_PAGE_URL = 'https://me.meituan.com/ebooking/merchant/product';

/**
 * 钟点房。⚠️ 这一层的判据是**「明确是钟点房才排除」**，与 `room-status-endpoint.ts`
 * 那层（`!== 1` 就丢，缺失也丢）**方向相反**，见 `pickMeituanRoomCatalog` 里的说明。
 */
const ROOM_CATEGORY_HOURLY = 2;

/**
 * 在售且审核通过的售卖商品判据。草稿 / 审核中 / 已下线的商品**不对账** ——
 * 它们当前不对客售卖，价格变化不构成需要跟进的渠道事实。
 *
 * 取值来自 RMS RPA 侧的踩点结论（`docs/美团/RPA-房型信息.md`）：
 * `auditStatus == 4`（审核通过）、`goodsStatus == 2`（在售）、
 * `switchStatus == 0` 或未设置（非 0 视为下线）。
 */
const GOODS_AUDIT_PASSED = 4;
const GOODS_STATUS_ON_SALE = 2;

/**
 * 分流标记：告诉下游这一行是房态还是价格。
 *
 * ⚠️ **与 `inventory-snapshot/meituan-cells.ts` 的同名常量必须逐字符相同**，但不能
 * import 它 —— eslint 禁止 `channels/` 依赖 `inventory-snapshot/`（那条禁令是对的：
 * 渠道层交出原始行，翻译成格子是快照侧的事）。
 *
 * 所以这里是**有意的重复**，由一条跨模块断言的测试钉住：两边不一致时，映射侧会把
 * 所有行都当成房态，**价格格子静默消失**，而日志上看不出任何异常。
 */
export const MEITUAN_SCAN_KIND_MARKER = '__snapshotKind';
const KIND_MARKER = MEITUAN_SCAN_KIND_MARKER;

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `YYYY-MM-DD`，取本地日期 —— 渠道的「今天」是营业日，不是 UTC 日。 */
function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 该商品是否在售且审核通过。⚠️ 判据见 `GOODS_AUDIT_PASSED` 那段注释。 */
function isSellableGoods(goods: JsonObject): boolean {
  if (toFiniteNumber(goods.auditStatus) !== GOODS_AUDIT_PASSED) return false;
  if (toFiniteNumber(goods.goodsStatus) !== GOODS_STATUS_ON_SALE) return false;
  const switchStatus = goods.switchStatus;
  // 未设置视为在售；非 0 视为下线。
  if (switchStatus === undefined || switchStatus === null) return true;
  return toFiniteNumber(switchStatus) === 0;
}

export type MeituanRoomCatalog = Readonly<{
  /** 日历房的物理房型 ID，去重后。④的入参。 */
  roomIds: readonly number[];
  /** 日历房下挂的在售售卖商品 ID，去重后。③的入参。 */
  goodsIds: readonly number[];
  hourlySkipped: number;
  unsellableSkipped: number;
}>;

/**
 * 从②的响应里挑出可扫的房型与商品。
 *
 * ⚠️ **两道过滤在同一次遍历里**，`roomIds` 与 `goodsIds` 同步被筛 —— 所以③不需要再
 * 过滤一遍（`goodsId` 是商品粒度，传什么回什么）。
 */
export function pickMeituanRoomCatalog(data: unknown): MeituanRoomCatalog {
  const roomIds: number[] = [];
  const goodsIds: number[] = [];
  const seenRooms = new Set<number>();
  const seenGoods = new Set<number>();
  let hourlySkipped = 0;
  let unsellableSkipped = 0;

  const body = asObject(data);
  const relations = body === null ? null : body.realRoomRelations;
  if (!Array.isArray(relations)) {
    return { roomIds, goodsIds, hourlySkipped, unsellableSkipped };
  }

  for (const rawRelation of relations) {
    const relation = asObject(rawRelation);
    if (!relation) continue;
    const logics = relation.logicRoomRelations;
    if (!Array.isArray(logics)) continue;

    for (const rawLogic of logics) {
      const logic = asObject(rawLogic);
      if (!logic) continue;
      const base = asObject(logic.roomBaseInfo);
      if (!base) continue;

      const roomId = toFiniteNumber(base.roomId);
      if (roomId === null) continue;

      // ⚠️ 钟点房在源头筛掉 —— 与携程同构（它筛 `hourRoom === true`）。
      //
      // **判据是「明确是钟点房才排除」，缺失保留** —— 与携程的
      // 「明确为 true 才排除」同口径，也是 design 决策 3.1 定的：
      // 房型清单里一个房型只有一条记录，判不出类别时多读一个无害
      // （④的展平层还会再挡一道，那层才是「缺失也丢」）。
      //
      // ⛔ 写成 `!== ROOM_CATEGORY_DAILY` 会让**字段缺失时筛掉全部房型**：
      // 美团哪天改了字段名，`catalog.roomIds` 直接为空、整轮落
      // `skipped: no-scannable-room-types`，与「这个账号真的没有日历房」
      // 在日志上分不开 —— 静默的全量覆盖丢失。
      if (toFiniteNumber(base.roomCategory) === ROOM_CATEGORY_HOURLY) {
        hourlySkipped += 1;
        continue;
      }

      if (!seenRooms.has(roomId)) {
        seenRooms.add(roomId);
        roomIds.push(roomId);
      }

      const goodsList = logic.goodsList;
      if (!Array.isArray(goodsList)) continue;
      for (const rawGoods of goodsList) {
        const goods = asObject(rawGoods);
        if (!goods) continue;
        const goodsId = toFiniteNumber(goods.goodsId);
        if (goodsId === null || seenGoods.has(goodsId)) continue;
        if (!isSellableGoods(goods)) {
          unsellableSkipped += 1;
          continue;
        }
        seenGoods.add(goodsId);
        goodsIds.push(goodsId);
      }
    }
  }

  return { roomIds, goodsIds, hourlySkipped, unsellableSkipped };
}

export type MeituanInventoryScanDependencies = Readonly<{
  logger: AppLogger;
  fetcher: ScanFetcher;
  /** 窄回调，从 appConfig 取；不在这里读全局配置，否则不可测。 */
  config: () => Readonly<{ timeoutMs: number }>;
  /** 窗口基准日，**入参**以便测试。 */
  now?: () => Date;
}>;

/** 从 `channelExtra` 里取门店级商户号。⚠️ 形状由渠道自己校验，调度层不认识入参。 */
function partnerIdOf(channelExtra: JsonObject): number | null {
  return toFiniteNumber(channelExtra.otaPartnerId);
}

export function createMeituanInventoryScan(
  deps: MeituanInventoryScanDependencies,
): InventoryScan {
  const now = deps.now ?? (() => new Date());

  const headers: Readonly<Record<string, string>> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'M-APPKEY': ME_API_APPKEY,
    logintype: ME_API_LOGIN_TYPE,
    locale: 'zh-CN',
    Referer: MEITUAN_PRODUCT_PAGE_URL,
  };

  return {
    async scan(
      partitionName: string,
      windowDays: number,
      channelExtra: JsonObject,
    ): Promise<InventoryScanOutcome> {
      const { timeoutMs } = deps.config();
      const startedAt = Date.now();
      // 调度层把门店 ID 放进 otaHotelId，商户号放进 channelExtra —— 前者是通用维度，
      // 后者是渠道专有入参。这里只认后者。
      const poiId = String(channelExtra.otaHotelId ?? '').trim();
      const partnerId = partnerIdOf(channelExtra);

      if (poiId === '' || partnerId === null) {
        // 装配层本该已经筛掉，这里是兜底：缺门店级参数绝不能退化成「扫整个账号」。
        return { kind: 'skipped', reason: 'missing-poi-or-partner-id' };
      }

      try {
        // ① 房型清单 —— 组参前提，两道过滤在这一步完成。
        const listRaw = await deps.fetcher(
          partitionName,
          QUERY_LIST_AND_TAG_URL,
          { poiId, partnerId, filterType: 1, needDraftGoods: true, offsetGoodsId: 0 },
          headers,
          timeoutMs,
        );
        const listParsed = parseMeituanResponse(listRaw);
        if (listParsed.kind === 'failed') return listParsed;
        const listBody = asObject(listRaw);
        const catalog = pickMeituanRoomCatalog(listBody?.data);

        if (catalog.roomIds.length === 0) {
          // 没有可扫的日历房 —— 请求成功了，只是没东西可读，不是失败。
          return { kind: 'skipped', reason: 'no-scannable-room-types' };
        }

        const today = now();
        const endDate = new Date(today);
        // windowDays 含今天，所以 -1。⚠️ 必须与 `scan-to-report.ts` 的 `scanWindow` 同口径，
        // 否则窗口尾部的格子每轮都被当成「首次见到」只写不报，差异永远报不出来。
        endDate.setDate(endDate.getDate() + Math.max(0, windowDays - 1));
        const startDate = toDateKey(today);
        const endDateKey = toDateKey(endDate);

        // ②③ 串行发。⚠️ 单边失败不放弃另一边：价格与房态是两类独立事实。
        const priceRows = await fetchPriceRows(
          partitionName,
          {
            poiId,
            partnerId,
            goodsIds: catalog.goodsIds,
            roomIds: catalog.roomIds,
            startDate,
            endDate: endDateKey,
          },
          timeoutMs,
        );
        const statusRows = await fetchStatusRows(
          partitionName,
          { poiId, partnerId, roomIds: catalog.roomIds, startDate, endDate: endDateKey },
          timeoutMs,
        );

        if (priceRows === null && statusRows === null) {
          // 两边都失败才算本门店失败。
          return { kind: 'failed', reason: 'NETWORK_ERROR' };
        }

        deps.logger.info('Meituan inventory scan finished', {
          poiId,
          roomCount: catalog.roomIds.length,
          goodsCount: catalog.goodsIds.length,
          hourlySkipped: catalog.hourlySkipped,
          unsellableSkipped: catalog.unsellableSkipped,
          windowDays,
          priceRows: priceRows?.length ?? 'failed',
          statusRows: statusRows?.length ?? 'failed',
          durationMs: Date.now() - startedAt,
        });

        // 空结果是**合法结果**（这些天确实没数据），不是失败。
        return { kind: 'ok', rows: [...(priceRows ?? []), ...(statusRows ?? [])] };
      } catch (error) {
        deps.logger.warn('Meituan inventory scan threw', {
          poiId,
          durationMs: Date.now() - startedAt,
          error: safeLogErrorDetails(error),
        });
        return { kind: 'failed', reason: 'UNEXPECTED' };
      }
    },
  };

  /** ② 价格。失败返回 `null` —— 调用方据此判断是否单边失败。 */
  async function fetchPriceRows(
    partitionName: string,
    args: Readonly<{
      poiId: string;
      partnerId: number;
      goodsIds: readonly number[];
      roomIds: readonly number[];
      startDate: string;
      endDate: string;
    }>,
    timeoutMs: number,
  ): Promise<JsonObject[] | null> {
    if (args.goodsIds.length === 0) return [];
    const raw = await deps.fetcher(
      partitionName,
      MEITUAN_PRICE_INVENTORY_URL,
      {
        startDate: args.startDate,
        endDate: args.endDate,
        poiId: args.poiId,
        partnerId: args.partnerId,
        goodsIds: [...args.goodsIds],
        // ⚠️ **必须传真实 roomIds**，不能给空数组 —— RPA 侧的踩点样本就是两者都传
        // （`docs/美团/RPA-房价信息.md` §4.1）。给空会让接口返回非 10000 的业务码。
        roomIds: [...args.roomIds],
      },
      headers,
      timeoutMs,
    );
    const parsed = parseMeituanResponse(raw);
    if (parsed.kind === 'failed') {
      deps.logger.warn('Meituan scan: price fetch failed', {
        poiId: args.poiId,
        reason: parsed.reason,
      });
      return null;
    }
    return flattenPriceRows(parsed.data).map((row) => ({ ...row, [KIND_MARKER]: 'price' }));
  }

  /** ③ 房态房量。与回读同一端点，共用展平逻辑（**不收窄**：扫描要整个窗口）。 */
  async function fetchStatusRows(
    partitionName: string,
    args: Readonly<{
      poiId: string;
      partnerId: number;
      roomIds: readonly number[];
      startDate: string;
      endDate: string;
    }>,
    timeoutMs: number,
  ): Promise<JsonObject[] | null> {
    const raw = await deps.fetcher(
      partitionName,
      MEITUAN_ROOM_STATUS_URL,
      buildRoomStatusRequest({
        roomIds: args.roomIds,
        startDate: args.startDate,
        endDate: args.endDate,
        poiId: args.poiId,
        partnerId: args.partnerId,
      }),
      headers,
      timeoutMs,
    );
    const parsed = parseMeituanResponse(raw);
    if (parsed.kind === 'failed') {
      deps.logger.warn('Meituan scan: room status fetch failed', {
        poiId: args.poiId,
        reason: parsed.reason,
      });
      return null;
    }
    const { rows, hourlySkipped } = flattenRoomStatusRows(parsed.data);
    if (hourlySkipped > 0) {
      // ②已在源头筛过钟点房，这里还挡下东西说明接口夹带了同 roomId 的钟点房那一行。
      deps.logger.info('Meituan scan: skipped non-daily rows from response', { hourlySkipped });
    }
    return rows.map((row) => ({ ...row, [KIND_MARKER]: 'roomStatus' }));
  }
}
