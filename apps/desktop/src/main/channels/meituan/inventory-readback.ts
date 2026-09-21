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
 * ✅ 2026-09-18 真机实证：写请求是 `countType:1620, limitChangeValue:1`（纯相对操作，
 * 报文里没有任何地方出现 19），回读拿到 `limitRemain: 19`，全程 109ms。同步成立。
 *
 * ⚠️ 将来若发现读到旧值，那是这个前提被推翻，应回到 design 重新设计门控，
 * **不是**加一个固定延迟绕过去（任务耗时不是常数，携程实测约 1.2 秒但不稳定）。
 *
 * ## 为什么在页面里发而不是主进程
 *
 * 见 `./inventory-readback-fetcher.ts`。
 */
import type { WebContents } from 'electron';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import type { OtaAmountChangeObserved } from '../../../shared/types/amount-change';
import type { InventoryReadback, ReadbackOutcome } from '../types';
import {
  extractMeituanReadbackTargets,
  type MeituanReadbackTargets,
} from './room-change-targets';
import type { MeituanReadbackFetcher } from './inventory-readback-fetcher';
import { parseMeituanResponse } from './session-expiry';
import {
  buildRoomStatusRequest,
  flattenRoomStatusRows,
  MEITUAN_ROOM_STATUS_URL,
} from './room-status-endpoint';
import {
  buildMeituanReadbackReport,
  MEITUAN_READBACK_ENDPOINT_ID,
} from './inventory-readback-payload';

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
    // 接口只认区间。目标日期不连续时按 min~max 发，回来再按集合筛（见下）。
    const raw = await deps.fetcher(
      webContents,
      MEITUAN_ROOM_STATUS_URL,
      buildRoomStatusRequest({
        roomIds: targets.roomIds,
        startDate: targets.dates[0] as string,
        endDate: targets.dates[targets.dates.length - 1] as string,
        poiId: targets.poiId,
        partnerId: targets.partnerId,
      }),
      timeoutMs,
    );

    const parsed = parseMeituanResponse(raw);
    if (parsed.kind === 'failed') return parsed;

    // ⚠️ 回读**要收窄**：它的产出直接就是上报体，多报一天等于替用户宣告了他没做的
    // 改动（服务端拿 cells 去追价）。扫描不传这个参数 —— 见 room-status-endpoint 文件头。
    const { rows: cells, hourlySkipped } = flattenRoomStatusRows(parsed.data, {
      roomIds: new Set(targets.roomIds),
      dates: new Set(targets.dates),
    });
    if (hourlySkipped > 0) {
      deps.logger.info('Meituan inventory readback: skipped non-daily rooms', { hourlySkipped });
    }

    // cells 为空是**合法结果**（这些天确实没数据），不是失败 —— 照常上报。
    // ⚠️ poiId 必须传：service 层只给携程补 otaHotelId，见 payload 文件头。
    return { kind: 'ok', report: buildMeituanReadbackReport(report, cells, targets.poiId) };
  }
}

export { MEITUAN_READBACK_ENDPOINT_ID };
