/**
 * 携程**定时扫描差异**的 `changeRaw` 模型 —— **RMS 侧对接这个端点时读这一份**。
 *
 * | | |
 * |---|---|
 * | `source` | `ctrip` |
 * | `changeType` | `inventoryReadback` ⚠️ 沿用，见下 |
 * | `endpointId` | `inventoryScan` ⚠️ **新端点，服务端要写对应 Translator** |
 * | 触发 | 定时器，与用户操作无关 |
 *
 * ============================================================================
 * ⚠️ 一句话摘要：这条上报的是「**我们发现渠道悄悄变了**」
 * ============================================================================
 *
 * 前两类上报都跟在用户操作后面：
 *
 * ```
 * price / roomStatus    用户在本应用里改了什么      ← 写请求报文
 * inventoryReadback     用户改完后渠道实际是什么    ← 主动读回
 * inventoryScan         **没人操作，渠道自己变了**  ← 本上报
 * ```
 *
 * 立论场景有两个，共同点是**本应用收不到任何信号**：
 *
 * 1. 用户在其他浏览器 / 手机 / 渠道 App 上改了价
 * 2. 无人操作，渠道自行变更（订满自动关房、活动到期、渠道侧批量调整）
 *
 * ============================================================================
 * changeRaw 结构
 * ============================================================================
 *
 * ```json
 * {
 *   "probedAt": "2026-09-20T10:00:03.000Z",
 *   "cells": [
 *     { "roomTypeID": 1569052074, "effectDate": "2026-10-20", "roomStatus": "G",
 *       "limitSale": "T", "totalQuantity": 7, "canUsedQuantity": 7, … },
 *     { "roomTypeID": 1569052074, "effectDate": "2026-10-20", "price": 434,
 *       "currency": "RMB", … }
 *   ]
 * }
 * ```
 *
 * ⚠️ **比回读上报少两个字段**，都是有意删的：
 *
 * | 字段 | 为何没有 |
 * |---|---|
 * | `trigger` | 回读的 trigger 指向触发它的那次写操作；扫描由定时器触发，没有对应的用户操作可指。留一个 `{kind:'scheduledScan'}` 只是同义反复 —— `endpointId` 已经说明了这是扫描 |
 * | `truncated` | 回读有「应用到所有日期」这种客户端算不出范围的情况；扫描窗口由配置决定且完全可知，这个字段恒为 `false`，留着会让人以为存在「可能不完整」的情况 |
 *
 * ============================================================================
 * ⚠️ 与回读上报的三条关键差异
 * ============================================================================
 *
 * ## 1. `cells` 只含**有差异的格子**，不是完整快照
 *
 * 回读的 `cells` 是「这次改动涉及的房型 × 日期」的**全量**读回结果；本上报的 `cells`
 * 是「与本地基线比对后**变了的**那些格子」。
 *
 * ⛔ **不可**据此认为「没出现在 cells 里的格子 = 没变」，理由见下一条。
 *
 * ## 2. ⚠️ 首次见到的格子**不会上报**
 *
 * 本地基线是逐步积累的（用户浏览页面时旁听、改动后回读）。扫描时若某格**从未见过**，
 * 它会被写入基线但**不上报** —— 因为「没有基线」不等于「渠道新增了」，多半只是我们
 * 从没读到过那一格。
 *
 * 不这么做的后果很具体：首次扫描会把整个窗口（15 天 × 全部房型）当成变更灌给服务端。
 *
 * **所以「没报」有两种可能**：确实没变，或那一格是第一次见。两者本上报区分不了。
 *
 * ## 3. ⚠️ 房态与房量在**同一条** cell，价格是**独立的另一条**
 *
 * ```
 * 一条 cell：roomStatus（房态）+ limitSale/totalQuantity/canUsedQuantity（房量）
 * 另一条  ：price / cost / commissionRate / currency
 * ```
 *
 * 房态房量合一，是因为携程读接口本就把它们返回在同一行（`roomStatusResult`）；
 * 价格分开，是因为它来自响应的另一个路径（`roomPriceResult.roomPriceInfo`）。
 *
 * ⚠️ **不可合并成一行**：携程的价格路径可能不覆盖全部格子（关房日无价），合并会让
 * 关房日因无价而丢掉整行房态 —— `rms-rpa-worker` 侧记载过这个失效。
 *
 * 所以**有房态没价格是正常的**，不是数据缺失。
 *
 * ============================================================================
 * 其他须知
 * ============================================================================
 *
 * - **不带旧值**：本上报只说「现在是什么」，不说「原来是什么」。需要对比请查
 *   服务端自己的历史。
 * - **枚举原样透传**：`"G"`/`"N"`/`"Y"` 不转开关，`"T"`/`"F"` 不转布尔。字段语义
 *   见 `inventory-readback-payload.ts` 的「四条反直觉约定」，此处不重复。
 * - **偶发漏报是已知取舍**：扫描失败不重试、不补扫，下一轮自然覆盖。
 */
import type { JsonObject } from '../../../shared/types/json';
import type { ChannelId } from '../../ids';
import type { OtaAmountChangeObserved } from '../../../shared/types/amount-change';

/**
 * ⚠️ 新端点。服务端按 `(source, endpointId)` 分派 Translator，必须为它写一个 ——
 * 否则 desktop 照发、服务端回 `PARSE_FAILED`/`SKIPPED`（那是 `code=0` 的正常响应），
 * **desktop 这侧看不出任何异常**。
 */
export const CTRIP_SCAN_ENDPOINT_ID = 'inventoryScan';

export const CTRIP_SCAN_ENDPOINT_URL =
  'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRoomInventoryInfo';

export type CtripInventoryScanRaw = JsonObject &
  Readonly<{
    /** 本轮扫描取回数据的时刻。 */
    probedAt: string;
    /** **只含有差异的格子**，渠道原始行。见文件头的三条差异。 */
    cells: readonly JsonObject[];
  }>;

/**
 * 组装扫描差异的上报体。
 *
 * `otaHotelId` **在这里填**（取自凭证的 `masterHotelId`，由调度层传入）——
 * service 层的归一只对携程的**改动**上报生效，不会替这条补。
 *
 * `operationId` / `submitAt` 不在这里填，由 service 层补。
 */
export function buildCtripScanReport(
  source: ChannelId,
  otaHotelId: string,
  cells: readonly JsonObject[],
  probedAt: string = new Date().toISOString(),
): OtaAmountChangeObserved {
  return {
    source,
    // ⚠️ 沿用 inventoryReadback：服务端按 (source, endpointId) 分派，changeType 只进
    // 日志、不参与分流；且语义对得上 —— 报的同样是「渠道实际是什么」。
    changeType: 'inventoryReadback',
    endpointId: CTRIP_SCAN_ENDPOINT_ID,
    endpointUrl: CTRIP_SCAN_ENDPOINT_URL,
    otaHotelId,
    changeRaw: {
      probedAt,
      cells,
    } satisfies CtripInventoryScanRaw,
  };
}
