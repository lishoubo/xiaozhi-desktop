/**
 * 携程**定时扫描**取数 —— 主动读回该账号当前门店的价量态。
 *
 * ## 与回读的关系：同样两步请求，但发起方式不同
 *
 * ```
 *                回读                          扫描（本文件）
 * 触发    用户改完，跟在写操作后面        定时器
 * 发起    页面内 XHR（webContents）       账号会话（partitionName）
 * 范围    只读本次改动命中的房型×日期     该门店**全部**房型 × 整个窗口
 * 产出    上报体（直接发 RMS）            原始行（交给调度层比对基线）
 * ```
 *
 * ⚠️ **不依赖标签页**是本文件存在的全部理由。2026-09-20 真机验证：两个携程账号，
 * 标签页开与不开，取数结果逐字节相同（31 / 13 个房型）；且请求走主进程网络栈，
 * **不会被改价监听的 CDP 拦到**，所以不像走页面的方案那样触发重复写入。
 *
 * ## 两步请求
 *
 * ```
 * ① POST /ebkovsroom/api/inventory/getRcProductList    body: {}
 *      ⚠️ 门店上下文**完全由 cookie 决定**，无入参 —— 所以一个凭证天然对应它当前
 *         所在的那家店，不需要传酒店 ID，也不需要遍历绑定关系
 *      data[] → .roomInfos[]  只读这层（售卖房型）
 *         ⚠️ roomPPInfos / roomFGInfos 是同批数据按支付方式的切片，读了会重复
 *         过滤 hourRoom（预售 advanceSale 已不滤，见 pickAllRoomRefs），按 roomTypeID 去重
 * ② POST /ebkovsroom/api/inventory/getRoomInventoryInfo
 *      body: { hotelRoomInfoDtoList: [六字段…], startDate, endDate, … }
 *      data.roomStatusResult[]              房态房量
 *      data.roomPriceResult.roomPriceInfo[] 价格（可能不覆盖全部格子：关房日无价）
 * ```
 *
 * ⚠️ `rateCodeID` **不可省**：缺它 `roomPriceResult` 为空（`rms-rpa-worker` 已记载）。
 */
import type { AppLogger } from '../../../shared/logging';
import { safeLogErrorDetails } from '../../../shared/logging';
import type { JsonObject } from '../../../shared/types/json';
import type { InventoryScan, InventoryScanOutcome, ScanFetcher } from '../types';
import { parseCtripResponse } from './session-expiry';

const PRODUCT_LIST_URL = 'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRcProductList';
export const CTRIP_SCAN_URL =
  'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRoomInventoryInfo';

/**
 * 页面地址 —— 只用来填 `Referer`。
 *
 * ⚠️ 连通性验证确认携程**只需要 `Referer` + `Origin`** 这两个头，无签名头。
 * 这两个由本文件给而不是注入的 fetcher 写死：哪个页面发的请求是**渠道知识**。
 */
const CTRIP_PAGE_URL = 'https://ebooking.ctrip.com/ebkovsroom/inventory/calendar';
const CTRIP_ORIGIN = 'https://ebooking.ctrip.com';

/**
 * @deprecated 用 `channels/types.ts` 的 `ScanFetcher` —— 这个形状本来就渠道无关
 * （头由各渠道实现自己填），名字带 Ctrip 只是因为当时只有携程一家。保留别名是为了
 * 不动既有引用。
 */
export type CtripScanFetcher = ScanFetcher;

/**
 * 分流标记：告诉下游这一行是房态还是价格。
 *
 * ⚠️ **与 `inventory-snapshot/ctrip-cells.ts` 的 `CTRIP_SNAPSHOT_KIND_MARKER` 必须
 * 逐字符相同**，但不能 import 它 —— eslint 禁止 `channels/` 依赖 `inventory-snapshot/`
 * （那条禁令是对的：渠道层交出原始行，翻译成格子是快照侧的事）。
 *
 * 所以这里是**有意的重复**，由一条跨模块断言的测试钉住：两边不一致时，映射侧会把
 * 所有行都当成房态，**价格格子静默消失**，而日志上看不出任何异常。
 */
export const CTRIP_SCAN_KIND_MARKER = '__snapshotKind';
const KIND_MARKER = CTRIP_SCAN_KIND_MARKER;

/**
 * 随行带出的房型名 —— **我们自己贴的**，不是 `getRoomInventoryInfo` 的字段。
 *
 * 携程的房型名只出现在①的房型清单里，②的房态/价格行里只有 `roomTypeID`。
 * 映射侧读它填进 `SnapshotCell.roomName`，并从 `item_data` 里剥掉
 * （与 `__snapshotKind` 同样处置，见 `inventory-snapshot/ctrip-cells.ts`）。
 *
 * ⚠️ 与映射侧的 `CTRIP_SNAPSHOT_ROOM_NAME_FIELD` 必须逐字符相同 ——
 * eslint 禁止 `channels/` 依赖 `inventory-snapshot/`，所以两处各写一份，
 * 由跨模块断言测试钉住。
 */
export const CTRIP_SCAN_ROOM_NAME_FIELD = '__roomName';
const ROOM_NAME_FIELD = CTRIP_SCAN_ROOM_NAME_FIELD;

/** `getRoomInventoryInfo` 需要的六字段。`hotelID` 是「门店 × 售卖模式」层，非账号粒度。 */
type CtripRoomRef = JsonObject &
  Readonly<{
    hotelID: number;
    roomTypeID: number;
    roomName: string;
    payType: string;
    roomClass: number;
    /**
     * ⚠️ **不可省**：缺它 `roomPriceResult` 为空（见文件头）。显式声明在类型上而不是
     * 只靠 `JsonObject` 的索引签名混进去 —— 否则将来漏填不会有编译错误，而失效方式是
     * 价格格子静默消失、房态照常流动，日志上看不出任何异常。
     *
     * 取不到时是 `null`（原样带走，不省略该键）。
     */
    rateCodeID: JsonObject[string];
  }>;

/**
 * 从房型清单里挑出全部可扫房型。
 *
 * 与回读的同名逻辑有两处差别：**回读按本次改动的房型过滤，扫描要全部**；
 * 且**扫描不滤预售**（回读仍滤，见 `pickAllRoomRefs` 里的说明）。
 * 其余一致（源头过滤钟点房，按 `roomTypeID` 去重）。
 */
function pickAllRoomRefs(data: unknown): {
  refs: CtripRoomRef[];
  hourlySkipped: number;
  presaleSkipped: number;
} {
  const refs: CtripRoomRef[] = [];
  const seen = new Set<number>();
  let hourlySkipped = 0;
  // ⚠️ 预售过滤已去掉，这个计数器**恒为 0** —— 刻意保留，见下面 `seen.add` 前的说明。
  // 加回过滤时改回 `let`。
  const presaleSkipped = 0;

  const groups = Array.isArray(data) ? data : [];
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue;
    const roomInfos = (group as JsonObject).roomInfos;
    if (!Array.isArray(roomInfos)) continue;

    for (const info of roomInfos) {
      if (typeof info !== 'object' || info === null || Array.isArray(info)) continue;
      const room = info as JsonObject;
      const roomTypeID = room.roomTypeID;
      if (typeof roomTypeID !== 'number' || seen.has(roomTypeID)) continue;
      // ⚠️ 源头过滤必须在去重之前，判据是携程的权威布尔字段：
      // 「明确为 true 才排除」，缺失或非 true 一律保留（宁可多读也不误杀）。
      if (room.hourRoom === true) {
        hourlySkipped += 1;
        continue;
      }
      // ⚠️ **预售（`advanceSale`）过滤已去掉 —— 2026-09-21，扫描侧现在全收。**
      //
      // 去掉的理由：预售房型也是在售的渠道事实，滤掉等于这些房型的价量变化永远不对账。
      // 原先滤掉是沿用回读那边的规则（见 `inventory-readback.ts` 的同名逻辑），
      // 而回读的语境不同 —— 那边按「本次改动的房型」取数，预售本就不该混进来。
      //
      // 要加回来就在**这个位置**（去重 `seen.add` 之前），照 `hourRoom` 的样子写：
      //
      // ```ts
      // if (room.advanceSale === true) {
      //   presaleSkipped += 1;
      //   continue;
      // }
      // ```
      //
      // `presaleSkipped` 计数器与它的日志字段**刻意保留**（恒为 0），正是为了加回来时
      // 只动这一处。⚠️ 加回来前先想清楚回读那边要不要同步 —— 两边不一致会让预售房型
      // 被扫描建了基线、回读却永远不更新，下一轮扫描又比对出差异。
      seen.add(roomTypeID);
      refs.push({
        hotelID: typeof room.hotelID === 'number' ? room.hotelID : 0,
        roomTypeID,
        roomName:
          (typeof room.roomNameDesc === 'string' ? room.roomNameDesc : '') ||
          (typeof room.roomName === 'string' ? room.roomName : ''),
        payType: typeof room.payType === 'string' ? room.payType : '',
        // 缺省回落 roomTypeID —— 与 rms-rpa-worker 侧同口径。
        roomClass: typeof room.roomClass === 'number' ? room.roomClass : roomTypeID,
        // ⚠️ 不可省：缺它 roomPriceResult 为空。原样带走，包括缺失的情况。
        rateCodeID: room.rateCodeID ?? null,
      });
    }
  }
  return { refs, hourlySkipped, presaleSkipped };
}

/** `YYYY-MM-DD`，取本地日期 —— 渠道的「今天」是营业日，不是 UTC 日。 */
function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pickRows(data: JsonObject, field: string): JsonObject[] {
  const rows = data[field];
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is JsonObject => typeof row === 'object' && row !== null && !Array.isArray(row),
  );
}

/** 价格行比房态多一层：`roomPriceResult.roomPriceInfo[]`。 */
function pickPriceRows(data: JsonObject): JsonObject[] {
  const result = data.roomPriceResult;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return [];
  return pickRows(result as JsonObject, 'roomPriceInfo');
}

export type CtripInventoryScanDependencies = Readonly<{
  logger: AppLogger;
  fetcher: ScanFetcher;
  /** 窄回调，从 appConfig 取；不在这里读全局配置，否则不可测。 */
  config: () => Readonly<{ timeoutMs: number }>;
  /** 窗口基准日，**入参**以便测试。 */
  now?: () => Date;
}>;

export function createCtripInventoryScan(deps: CtripInventoryScanDependencies): InventoryScan {
  const now = deps.now ?? (() => new Date());

  const headers: Readonly<Record<string, string>> = {
    'Content-Type': 'application/json;charset=UTF-8',
    Accept: 'application/json',
    Referer: CTRIP_PAGE_URL,
    Origin: CTRIP_ORIGIN,
  };

  return {
    // ⚠️ 不取第三参 `channelExtra`：携程的门店上下文完全由 cookie 决定（第一步请求体是
    // `{}`），没有需要外部传入的取数入参。
    async scan(partitionName: string, windowDays: number): Promise<InventoryScanOutcome> {
      const { timeoutMs } = deps.config();
      const startedAt = Date.now();

      try {
        // ① 房型清单。body 是 {}，门店上下文完全由 cookie 决定。
        const listRaw = await deps.fetcher(partitionName, PRODUCT_LIST_URL, {}, headers, timeoutMs);
        const listParsed = parseCtripResponse(listRaw);
        if (listParsed.kind === 'failed') return listParsed;

        const { refs, hourlySkipped, presaleSkipped } = pickAllRoomRefs(listParsed.data);
        if (refs.length === 0) {
          // 该账号当前门店没有可扫房型 —— 请求成功了，只是没东西可读，不是失败。
          return { kind: 'skipped', reason: 'no-scannable-room-types' };
        }

        // ② 房态房量 + 价格。窗口自今日起算，闭区间。
        const today = now();
        const endDate = new Date(today);
        // windowDays 含今天，所以 -1：7 天 = 今天 + 往后 6 天。
        endDate.setDate(endDate.getDate() + Math.max(0, windowDays - 1));

        const inventoryRaw = await deps.fetcher(
          partitionName,
          CTRIP_SCAN_URL,
          {
            hotelRoomInfoDtoList: refs,
            startDate: toDateKey(today),
            endDate: toDateKey(endDate),
            showRoomInventory: true,
            showRoomPrice: true,
          },
          headers,
          timeoutMs,
        );
        const inventoryParsed = parseCtripResponse(inventoryRaw);
        if (inventoryParsed.kind === 'failed') return inventoryParsed;

        // 房型名只有①的清单里有，②的响应行里没有 —— 按 roomTypeID 贴回去，
        // 映射侧据此填 `SnapshotCell.roomName`（纯标注，不参与比对）。
        const roomNameById = new Map(refs.map((ref) => [ref.roomTypeID, ref.roomName]));
        const withRoomName = (row: JsonObject): JsonObject => {
          const roomName = roomNameById.get(row.roomTypeID as number);
          // `JsonValue` 不含 undefined —— 取不到就不带这个键。
          return roomName === undefined ? row : { ...row, [ROOM_NAME_FIELD]: roomName };
        };

        // ⚠️ 两批数据分别打标记 —— 下游按 item_type 分成两格存。
        // ⛔ 不要合并成一行：关房日无价，合并会因无价丢掉整行房态。
        const statusRows = pickRows(inventoryParsed.data, 'roomStatusResult').map((row) => ({
          ...withRoomName(row),
          [KIND_MARKER]: 'roomStatus',
        }));
        const priceRows = pickPriceRows(inventoryParsed.data).map((row) => ({
          ...withRoomName(row),
          [KIND_MARKER]: 'price',
        }));

        deps.logger.info('Ctrip inventory scan finished', {
          roomTypeCount: refs.length,
          hourlySkipped,
          presaleSkipped,
          windowDays,
          statusRows: statusRows.length,
          priceRows: priceRows.length,
          durationMs: Date.now() - startedAt,
        });

        // 空结果是**合法结果**（这些天确实没数据），不是失败。
        return { kind: 'ok', rows: [...statusRows, ...priceRows] };
      } catch (error) {
        deps.logger.warn('Ctrip inventory scan threw', {
          durationMs: Date.now() - startedAt,
          error: safeLogErrorDetails(error),
        });
        return { kind: 'failed', reason: 'UNEXPECTED' };
      }
    },
  };
}
