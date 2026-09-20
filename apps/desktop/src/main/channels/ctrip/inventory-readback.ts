/**
 * 携程房量回读 —— 用户改完房态房量后，在**他刚操作的那个标签页里**读回渠道的真实状态。
 *
 * 契约与字段语义见 `./inventory-readback-payload.ts`（**RMS 对接读那一份**）。
 * 本文件只讲「怎么读、怎么判失败」。
 *
 * ## 两步请求
 *
 * ```
 * ① POST /ebkovsroom/api/inventory/getRcProductList     body {}
 *      data[].roomInfos[] 每项自带 hotelID/payType/roomClass/rateCodeID
 *      → 按 roomTypeID 建索引，挑出本次改动涉及的那几个房型，补齐六字段
 *
 * ② POST /ebkovsroom/api/inventory/getRoomInventoryInfo
 *      body { hotelRoomInfoDtoList: [六字段…], startDate, endDate, showRoomInventory, showRoomPrice }
 *      → data.roomStatusResult[] 扁平行（房型数 × 天数）
 * ```
 *
 * ⚠️ 第二步只认 `startDate`/`endDate` 区间，**不支持星期过滤**。所以目标日期不连续时
 * （用户只改了周末），请求要按 min~max 发，拿回来再按目标集合筛 —— 少了这步就等于「多读」，
 * 服务端会照着多跟价。
 *
 * ## 为什么在页面里发而不是主进程
 *
 * 用户刚在这个标签页操作过，页面必然开着。`withCredentials` 让浏览器自己带 cookie ——
 * 不读 cookie、不拼 `Cookie:` 头，2026-08-09 那次「结构化 JSON 整串塞进 Cookie 头 →
 * 携程返回 200 + 登录页 HTML → JSON 解析炸」的整类事故在这条路上不可能发生。
 *
 * 这两个读接口**不需要任何签名头**（写接口的 `phantom-token` / `spidertoken` 每次都变、
 * 本地无法构造，但读接口不带）—— `rms-rpa-worker` 侧已用纯 cookie 在生产跑通。
 */
import type { WebContents } from 'electron';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import type { JsonObject } from '../../../shared/types/json';
import { parseCtripResponse } from './session-expiry';
import type { OtaAmountChangeObserved } from '../../../shared/types/amount-change';
import type { InventoryReadback, ReadbackOutcome } from '../types';
import { ctripBatchTaskGate } from './batch-task-gate';
import {
  CTRIP_ROOM_STATUS_ENDPOINT_ID,
  CTRIP_ROOM_STATUS_QUANTITY_ENDPOINT_ID,
  extractCtripReadbackTargets,
  type ReadbackTargets,
} from './room-change-targets';
import { buildCtripReadbackReport, READBACK_ENDPOINT_ID, READBACK_URL } from './inventory-readback-payload';

const PRODUCT_LIST_URL = 'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRcProductList';

/** 页面里执行的取数函数。走 XHR + `withCredentials`，照 `meituan/poi-infos.ts` 的模板。 */
export type CtripReadbackFetcher = (
  webContents: WebContents,
  url: string,
  body: JsonObject,
  timeoutMs: number,
) => Promise<unknown>;

/**
 * `getRoomInventoryInfo` 需要的六字段。`hotelID` 是「门店 × 售卖模式」层，不是账号粒度。
 *
 * 交叉 `JsonObject` 是因为它要直接进请求体 —— 光有具名字段的对象类型不满足 `JsonValue`
 * 的索引签名。
 */
type CtripRoomRef = JsonObject &
  Readonly<{
    hotelID: number;
    roomTypeID: number;
    roomName: string;
    payType: string;
    roomClass: number;
  }>;

/**
 * 从 `getRcProductList` 的响应里挑出目标房型，补齐六字段。
 *
 * ⚠️ 只读 `roomInfos`：`roomPPInfos`/`roomFGInfos` 是同批数据按支付方式的切片，读了会重复。
 *
 * ⚠️ 源头过滤钟点房与预售，**在去重之前** —— 判据是携程的权威布尔字段，「明确为 true 才
 * 排除」，缺失或非 true 一律保留（宁可多读也不误杀）。
 */
function pickRoomRefs(
  data: unknown,
  wanted: ReadonlySet<number>,
): { refs: CtripRoomRef[]; hourlySkipped: number; presaleSkipped: number } {
  const refs: CtripRoomRef[] = [];
  const seen = new Set<number>();
  let hourlySkipped = 0;
  let presaleSkipped = 0;

  const groups = Array.isArray(data) ? data : [];
  for (const group of groups) {
    if (typeof group !== 'object' || group === null) continue;
    const roomInfos = (group as JsonObject).roomInfos;
    if (!Array.isArray(roomInfos)) continue;

    for (const info of roomInfos) {
      if (typeof info !== 'object' || info === null || Array.isArray(info)) continue;
      const room = info as JsonObject;
      const roomTypeID = room.roomTypeID;
      if (typeof roomTypeID !== 'number' || !wanted.has(roomTypeID) || seen.has(roomTypeID)) {
        continue;
      }
      if (room.hourRoom === true) {
        hourlySkipped += 1;
        continue;
      }
      if (room.advanceSale === true) {
        presaleSkipped += 1;
        continue;
      }
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
        // ⚠️ 不可省：缺 rateCodeID 时 `roomPriceResult` 为空（rms-rpa-worker 已记载）。
        // 原样带走，包括它缺失的情况 —— 不替携程猜默认值。
        rateCodeID: (room.rateCodeID ?? null) as JsonObject[string],
      });
    }
  }
  return { refs, hourlySkipped, presaleSkipped };
}

/**
 * 从 `getRoomInventoryInfo` 的 `data` 取房态行，并**按目标日期集合过滤**。
 *
 * ⚠️ 过滤这步不能省：请求按 min~max 区间发，返回的是区间内**每一天**。用户只改了周末时
 * 直接上报等于多报 5 天，服务端会照着多跟价。
 *
 * 行**原样透传**，不做任何枚举映射或类型转换（`"G"/"N"` 不转 `OPEN/CLOSED`、`"T"/"F"`
 * 不转布尔）—— desktop 不解读渠道语义。
 */
function pickCells(data: JsonObject, dates: ReadonlySet<string>): JsonObject[] {
  const rows = data.roomStatusResult;
  if (!Array.isArray(rows)) return [];

  const cells: JsonObject[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const effectDate = (row as JsonObject).effectDate;
    if (typeof effectDate !== 'string' || !dates.has(effectDate)) continue;
    cells.push(row as JsonObject);
  }
  return cells;
}

const WATCHED_ENDPOINTS: ReadonlySet<string> = new Set([
  CTRIP_ROOM_STATUS_ENDPOINT_ID,
  CTRIP_ROOM_STATUS_QUANTITY_ENDPOINT_ID,
]);

export type CtripInventoryReadbackDependencies = Readonly<{
  logger: AppLogger;
  fetcher: CtripReadbackFetcher;
  /** 窄回调，从 appConfig 取；不在这里读全局配置，否则不可测。 */
  config: () => Readonly<{ windowDays: number; timeoutMs: number }>;
  /** `applyAllDates` 裁剪的基准日，**入参**以便测试。 */
  now?: () => Date;
}>;

export function createCtripInventoryReadback(
  deps: CtripInventoryReadbackDependencies,
): InventoryReadback {
  const now = deps.now ?? (() => new Date());

  return {
    async readback(
      report: OtaAmountChangeObserved,
      webContents: WebContents,
    ): Promise<ReadbackOutcome> {
      // 不是房量端点 —— 改价等一律不回读。这是渠道自己的判断，调度层不认识端点名。
      if (!WATCHED_ENDPOINTS.has(report.endpointId)) {
        return { kind: 'skipped', reason: 'not-a-room-inventory-endpoint' };
      }

      const { windowDays, timeoutMs } = deps.config();
      const targets = extractCtripReadbackTargets(
        report.endpointId,
        report.changeRaw,
        windowDays,
        now(),
      );
      if (!targets) {
        // 房型或日期取不到。既有 parse 已挡掉大部分，这里是兜底 —— 空输入绝不能退化成
        // 「回读整店」，也不能发个空请求让它静默成功。
        deps.logger.info('Ctrip inventory readback: nothing to read back', {
          triggerEndpointId: report.endpointId,
        });
        return { kind: 'skipped', reason: 'no-targets' };
      }

      // 批量页的写接口是**异步**的：`rcode:200` 只代表受理。不等任务真正完成就回读，
      // 读到的是改前的值（2026-09-18 真机实证：设 19 读到 21/2/2）。
      // 日历页是同步写入，没有 taskId，`takeTask` 返回 null 直接往下走。
      const taskId = ctripBatchTaskGate.takeTask(report.endpointId);
      if (taskId !== null) {
        const completed = await ctripBatchTaskGate.waitFor(taskId);
        if (!completed) {
          // 等不到完成 = 不知道渠道写完没有，此时回读的值同样无法判断新旧。
          // 宁可不报，也不报一份可能是旧值的数据（服务端会照着跟错价）。
          return { kind: 'skipped', reason: 'batch-task-did-not-complete' };
        }
      }

      const startedAt = Date.now();
      try {
        const outcome = await run(report, webContents, targets, timeoutMs);
        deps.logger.info('Ctrip inventory readback finished', {
          triggerEndpointId: report.endpointId,
          roomTypeCount: targets.roomTypeIds.length,
          dateCount: targets.dates.length,
          truncated: targets.truncated,
          kind: outcome.kind,
          ...(outcome.kind === 'ok'
            ? { cellCount: (outcome.report.changeRaw.cells as unknown[]).length }
            : {}),
          ...(outcome.kind === 'failed' ? { reason: outcome.reason } : {}),
          durationMs: Date.now() - startedAt,
        });
        return outcome;
      } catch (error) {
        deps.logger.warn('Ctrip inventory readback threw', {
          triggerEndpointId: report.endpointId,
          durationMs: Date.now() - startedAt,
          error: safeLogErrorDetails(error),
        });
        return { kind: 'failed', reason: 'UNEXPECTED' };
      }
    },
  };

  async function run(
    report: OtaAmountChangeObserved,
    webContents: WebContents,
    targets: ReadbackTargets,
    timeoutMs: number,
  ): Promise<ReadbackOutcome> {
    // ① 房型清单 —— body 是 {}，门店上下文完全由 cookie 决定，无入参。
    const listRaw = await deps.fetcher(webContents, PRODUCT_LIST_URL, {}, timeoutMs);
    const listParsed = parseCtripResponse(listRaw);
    if (listParsed.kind === 'failed') return listParsed;

    const wanted = new Set(targets.roomTypeIds);
    const { refs, hourlySkipped, presaleSkipped } = pickRoomRefs(listParsed.data, wanted);
    if (hourlySkipped > 0 || presaleSkipped > 0) {
      deps.logger.info('Ctrip inventory readback: filtered rooms at source', {
        hourlySkipped,
        presaleSkipped,
      });
    }
    if (refs.length === 0) {
      // 目标房型一个都没在清单里 —— 可能全被源头过滤掉，也可能房型已下架。
      // 这不是失败（请求成功了），但也没有可读的东西。
      return { kind: 'skipped', reason: 'no-matching-room-types' };
    }

    // ② 房态房量。接口只认区间，目标日期不连续时按 min~max 发，回来再筛（见文件头）。
    const inventoryRaw = await deps.fetcher(
      webContents,
      READBACK_URL,
      {
        hotelRoomInfoDtoList: refs,
        startDate: targets.dates[0],
        endDate: targets.dates[targets.dates.length - 1],
        showRoomInventory: true,
        showRoomPrice: true,
      },
      timeoutMs,
    );
    const inventoryParsed = parseCtripResponse(inventoryRaw);
    if (inventoryParsed.kind === 'failed') return inventoryParsed;

    const cells = pickCells(inventoryParsed.data, new Set(targets.dates));
    // cells 为空是**合法结果**（这些天确实没数据），不是失败 —— 照常上报。
    // `truncated` 必须传下去：它是服务端判断「这份数据不完整」的唯一依据。
    return { kind: 'ok', report: buildCtripReadbackReport(report, cells, targets.truncated) };
  }
}

export { READBACK_ENDPOINT_ID };
