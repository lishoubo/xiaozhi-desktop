/**
 * 美团房量回读 —— 用户改完房量后，在**他刚操作的那个标签页里**读回渠道的真实状态。
 *
 * 契约与字段语义见 `./inventory-readback-payload.ts`（**RMS 对接读那一份**）。
 * 本文件只讲「怎么读、怎么判失败」。
 *
 * ## 一步请求（比携程简单）
 *
 * ```
 * POST /api/gw/v1/product/goods/queryRoomStatusInfo
 *   body { roomIds, startDate, endDate, poiId, partnerId }
 *   → data[] 每项 { roomBaseInfo, roomStatusMap: { "YYYY-MM-DD": {…} } }
 * ```
 *
 * 携程要两步（先 `getRcProductList` 补齐六字段），美团的写报文里已经有全部所需入参
 * （`poiId` / `partnerId` / `dayRoomIdList`），一步即可。
 *
 * ## ⚠️ 不做延迟、不做门控 —— 美团写入是**同步**的
 *
 * 携程批量页的写接口是异步的（`rcode:200` 只代表受理，真机实证立刻回读拿到改前值），
 * 所以那边有 `batch-task-gate` 拦页面对 `queryMainTaskInfoForDisplay` 的轮询。
 *
 * 美团是同步的，且页面保存后**不发任何任务轮询请求**（踩点实录：「批量修改之后，没有
 * 触发主动读取」）—— 即使想做门控也无对象可拦。
 *
 * ⚠️ 真机若发现读到旧值，那是这个前提被推翻，应回到 design 重新设计门控，
 * **不是**加一个固定延迟绕过去（任务耗时不是常数，携程实测约 1.2 秒但不稳定）。
 *
 * ## 为什么在页面里发而不是主进程
 *
 * 见 `./inventory-readback-fetcher.ts`。
 */
import type { WebContents } from 'electron';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import type { JsonObject } from '../../../shared/types/json';
import type { OtaAmountChangeObserved } from '../../../shared/types/amount-change';
import type { InventoryReadback, ReadbackFailureReason, ReadbackOutcome } from '../types';
import {
  extractMeituanReadbackTargets,
  type MeituanReadbackTargets,
} from './room-change-targets';
import type { MeituanReadbackFetcher } from './inventory-readback-fetcher';
import {
  buildMeituanReadbackReport,
  MEITUAN_READBACK_ENDPOINT_ID,
  MEITUAN_READBACK_URL,
} from './inventory-readback-payload';

/**
 * 美团认「成功」的业务码。
 *
 * ⚠️ **是 10000，不是 200 也不是 0** —— 与携程（`code: 200`）、抖音
 * （`BaseResp.StatusCode === 0`）都不同。判据按端点钉死，不做形状自辨。
 */
const SUCCESS_CODE = 10000;

/** 日历房。⚠️ 同一 roomId 会返回日租(1) + 钟点(2) 两行，见 payload 文件头。 */
const ROOM_CATEGORY_DAILY = 1;

type ParsedResponse =
  | Readonly<{ kind: 'ok'; data: readonly unknown[] }>
  | Readonly<{ kind: 'failed'; reason: ReadbackFailureReason }>;

/**
 * 把一次响应判成成功或某种失败。
 *
 * ## ⚠️ 失效判据**不猜**
 *
 * 携程的四形态（200+HTML 登录页、`invalid_grant`、`code ∈ {401,300,-1}`）是**携程的**，
 * 不可套用。美团失效响应**当前无真实样本**，所以这里只判有确定语义的：
 *
 * - HTTP 401 → `COOKIE_EXPIRED`
 * - HTTP 403 → `FORBIDDEN`（**403 ≠ 401**：身份认了但没权限，重登解决不了，
 *   归成 `COOKIE_EXPIRED` 会掩盖真因并触发一轮无意义的重新登录）
 * - `code !== 10000` → `PARSE_ERROR`（**不猜**哪个 code 代表失效）
 *
 * 拿到真实失效样本后再补判据并存脱敏 fixture。猜的特征会让修复形同虚设且单测全绿。
 */
function parseResponse(raw: unknown): ParsedResponse {
  if (raw === null || raw === undefined) return { kind: 'failed', reason: 'NETWORK_ERROR' };
  // 非 JSON（可能是 HTML）。当前不认任何 HTML 特征 —— 等真实样本。
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'failed', reason: 'PARSE_ERROR' };
  }

  const body = raw as JsonObject;
  if (body.__httpStatus === 403) return { kind: 'failed', reason: 'FORBIDDEN' };
  if (body.__httpStatus === 401) return { kind: 'failed', reason: 'COOKIE_EXPIRED' };

  if (body.code !== SUCCESS_CODE) return { kind: 'failed', reason: 'PARSE_ERROR' };

  const data = body.data;
  // `data` 必须是数组。空数组是**合法结果**（这些天确实没数据），由调用方处理。
  if (!Array.isArray(data)) return { kind: 'failed', reason: 'PARSE_ERROR' };
  return { kind: 'ok', data };
}

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

type PickResult = Readonly<{ cells: JsonObject[]; hourlySkipped: number }>;

/**
 * 把 `data[]` 的嵌套结构展平成扁平 cells，并施加两道过滤。
 *
 * ## 展平：`roomStatusMap` 是**以日期为 key 的对象**
 *
 * 携程 `roomStatusResult` 是扁平数组（房型数 × 天数），美团是嵌套 map。展平时把
 * `roomId` / `roomName` / `roomCategory` / `containerId` 并进每个 cell，
 * 让 `cells` 与携程同构 —— 服务端两边可以一套逻辑处理。
 *
 * ## 两道过滤，缺一不可
 *
 * 1. **`roomCategory === 1`** —— 同一 `roomId` 会返回日租 + 钟点两行，房量完全独立。
 *    不过滤会让同一房型同一天报出两行互相矛盾的数据（一行限量 1、一行不限 999）。
 *    ⚠️ `roomCategory` 缺失 → **丢弃该行**，不保留：宁可漏读也不能把钟点房数据混进
 *    日历房，后者会真实影响下发。
 * 2. **按目标日期集合筛** —— 请求只认区间，目标日期不连续时（用户只勾了周末）区间会
 *    比目标多。⚠️ 漏了这步等于「多读」，而服务端拿 cells 去**追价**，多报的日期会被
 *    跟到抖音，那是擅自扩大用户的改动范围。
 */
function pickCells(
  data: readonly unknown[],
  wantedRoomIds: ReadonlySet<number>,
  wantedDates: ReadonlySet<string>,
): PickResult {
  const cells: JsonObject[] = [];
  let hourlySkipped = 0;

  for (const rawItem of data) {
    const item = asObject(rawItem);
    if (!item) continue;

    const base = asObject(item.roomBaseInfo);
    if (!base) continue;

    const roomId = toFiniteNumber(base.roomId);
    if (roomId === null || !wantedRoomIds.has(roomId)) continue;

    // ⚠️ 日历房才要。缺失也丢 —— 见上。
    const roomCategory = toFiniteNumber(base.roomCategory);
    if (roomCategory !== ROOM_CATEGORY_DAILY) {
      if (roomCategory !== null) hourlySkipped += 1;
      continue;
    }

    const statusMap = asObject(item.roomStatusMap);
    if (!statusMap) continue;

    for (const [date, rawCell] of Object.entries(statusMap)) {
      // ⚠️ 按目标日期集合筛，不是「区间内就要」。
      if (!wantedDates.has(date)) continue;
      const cell = asObject(rawCell);
      if (!cell) continue;

      cells.push({
        roomId,
        roomName: base.roomName ?? null,
        roomCategory,
        // 整行透传，不解读房量语义（哪个字段是「用户设的房量」未经实证，交服务端）。
        ...cell,
        // `date` 放最后：map 的 key 是权威的，即使 cell 内没有这个字段也保证有。
        date,
      });
    }
  }

  return { cells, hourlySkipped };
}

export type MeituanInventoryReadbackDependencies = Readonly<{
  logger: AppLogger;
  fetcher: MeituanReadbackFetcher;
  /** 既有适配器的房量端点标识 —— 注入而非 import，避免与适配器互相依赖。 */
  inventoryEndpointId: string;
  /** 窄回调，从 appConfig 取；不在这里读全局配置，否则不可测。 */
  config: () => Readonly<{ timeoutMs: number }>;
}>;

export function createMeituanInventoryReadback(
  deps: MeituanInventoryReadbackDependencies,
): InventoryReadback {
  return {
    async readback(
      report: OtaAmountChangeObserved,
      webContents: WebContents,
    ): Promise<ReadbackOutcome> {
      // 不是房量端点 —— 房态开关 / 关房 / 改价一律不回读。这是渠道自己的判断，
      // 调度层不认识端点名。
      if (report.endpointId !== deps.inventoryEndpointId) {
        return { kind: 'skipped', reason: 'not-a-room-inventory-endpoint' };
      }

      const targets = extractMeituanReadbackTargets(
        report.endpointId,
        report.changeRaw,
        deps.inventoryEndpointId,
      );
      if (!targets) {
        // 房型或日期取不到，或整次只改了钟点房。既有 parse 已挡掉大部分，这里是兜底 ——
        // 空输入绝不能退化成「回读整店」，也不能发个空请求让它静默成功。
        deps.logger.info('Meituan inventory readback: nothing to read back', {
          triggerEndpointId: report.endpointId,
        });
        return { kind: 'skipped', reason: 'no-targets' };
      }

      const startedAt = Date.now();
      try {
        const outcome = await run(report, webContents, targets, deps.config().timeoutMs);
        deps.logger.info('Meituan inventory readback finished', {
          triggerEndpointId: report.endpointId,
          roomCount: targets.roomIds.length,
          dateCount: targets.dates.length,
          kind: outcome.kind,
          ...(outcome.kind === 'ok'
            ? { cellCount: (outcome.report.changeRaw.cells as unknown[]).length }
            : {}),
          ...(outcome.kind === 'failed' ? { reason: outcome.reason } : {}),
          durationMs: Date.now() - startedAt,
        });
        return outcome;
      } catch (error) {
        deps.logger.warn('Meituan inventory readback threw', {
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
    targets: MeituanReadbackTargets,
    timeoutMs: number,
  ): Promise<ReadbackOutcome> {
    // 接口只认区间。目标日期不连续时按 min~max 发，回来再按集合筛（见 pickCells）。
    const raw = await deps.fetcher(
      webContents,
      MEITUAN_READBACK_URL,
      {
        roomIds: [...targets.roomIds],
        startDate: targets.dates[0],
        endDate: targets.dates[targets.dates.length - 1],
        poiId: targets.poiId,
        partnerId: targets.partnerId,
      },
      timeoutMs,
    );

    const parsed = parseResponse(raw);
    if (parsed.kind === 'failed') return parsed;

    const { cells, hourlySkipped } = pickCells(
      parsed.data,
      new Set(targets.roomIds),
      new Set(targets.dates),
    );
    if (hourlySkipped > 0) {
      deps.logger.info('Meituan inventory readback: skipped non-daily rooms', { hourlySkipped });
    }

    // cells 为空是**合法结果**（这些天确实没数据），不是失败 —— 照常上报。
    return { kind: 'ok', report: buildMeituanReadbackReport(report, cells) };
  }
}

export { MEITUAN_READBACK_ENDPOINT_ID };
