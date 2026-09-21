/**
 * 美团**定时扫描差异**的 `changeRaw` 模型 —— **RMS 侧对接这个端点时读这一份**。
 *
 * | | |
 * |---|---|
 * | `source` | `meituan` |
 * | `changeType` | `inventoryDiff`（与携程同值，不新增） |
 * | `endpointId` | `inventoryScan` ⚠️ **服务端要为 `(meituan, inventoryScan)` 写 Translator** |
 * | 触发 | 定时器，与用户操作无关 |
 *
 * ============================================================================
 * ⚠️ 一句话摘要：这条上报的是「**我们发现渠道悄悄变了**」
 * ============================================================================
 *
 * 美团现在有四类上报，前三类都跟在用户操作后面：
 *
 * ```
 * price               用户改了价              ← 试算结果（不是提交体）
 * roomStatus          用户改了房量/房态        ← 写请求报文
 * inventoryReadback   用户改完后渠道实际是什么  ← 主动读回（用户那个标签页里）
 * inventoryDiff       **没人操作，渠道自己变了** ← 本上报
 * ```
 *
 * 立论场景有两个，共同点是**本应用收不到任何信号**：
 *
 * 1. 用户在其他浏览器 / 手机 / 美团商家版 App 上改了价
 * 2. 无人操作，渠道自行变更（订满自动关房、活动到期、渠道侧批量调整）
 *
 * ============================================================================
 * ⭐ 与携程最大的差异：cells 里有**两个房型 ID 空间**
 * ============================================================================
 *
 * ```
 * 携程   房态房量 roomTypeID     价格 roomTypeID    同一空间
 * 美团   房态房量 roomId(物理)   价格 goodsId(售卖)  ⚠️ 不同空间，1:多
 * ```
 *
 * ```
 * realRoomId (物理房型)                  ← 房态、房量挂这一层
 *    └── goodsId A (不含早/预付)  ┐
 *    └── goodsId B (含早/到付)    ├─ 价格各自独立
 *    └── goodsId C (专享)         ┘
 * ```
 *
 * 所以**服务端判断一个 cell 说的是哪个房型，要先看它是哪一类**：
 *
 * | cell 里有 | 是什么 | 房型标识 |
 * |---|---|---|
 * | `roomStatus` / `limitRemain` / `invSwitch` | 房态房量 | `roomId`（物理房型） |
 * | `salePrice` / `basePrice` | 价格 | `goodsId`（售卖商品，= RMS 台账的 `ota_sale_room_type_id`） |
 *
 * ⚠️ 一条上报的 `cells` 里**两类混在一起**，是本轮发现的全部差异。
 *
 * ============================================================================
 * changeRaw 结构
 * ============================================================================
 *
 * ```json
 * {
 *   "probedAt": "2026-09-21T10:00:03.000Z",
 *   "cells": [
 *     { "roomId": 354223342, "roomName": "大床房", "roomCategory": 1,
 *       "date": "2026-09-21", "roomStatus": 1, "limitType": 1,
 *       "remainCount": 1, "limitRemain": 5, "usedCount": 0, "invSwitch": 1 },
 *     { "goodsId": 847226645, "goodsName": "大床房-不含早", "date": "2026-09-21",
 *       "salePrice": "20700", "basePrice": "18009", "subRatio": 1300 }
 *   ]
 * }
 * ```
 *
 * ============================================================================
 * ⚠️ 四条反直觉约定
 * ============================================================================
 *
 * **1. 金额是「分」的字符串，不是数字、不是元**
 *
 * `"20700"` = 207.00 元。desktop **原样透传不转换** —— 转换等于在客户端复刻渠道语义，
 * 美团改字段类型时会静默错报。
 *
 * **2. `limitRemain` = 配额 − 已售，不是用户设的配额本身**
 *
 * 同房型连续几天的实测：
 *
 * | date | limitRemain | usedCount |
 * |---|---|---|
 * | 09-19 | 20 | 0 |
 * | 09-21 | 19 | **1** |
 *
 * 服务端直接拿它当「用户设了多少房」，在有已售的日期上会偏小。要还原配额得加 `usedCount`。
 *
 * **3. 只含日历房，不含钟点房**
 *
 * 钟点房与日历房共用同一个 `roomId`，但房量完全独立。desktop 在取数源头就筛掉了
 * （`roomBaseInfo.roomCategory === 2`）—— 实测 9 个逻辑房型里 3 个是钟点房。
 *
 * **4. 只含在售商品的价格**
 *
 * 草稿、审核中、已下线的售卖商品不进入取数范围（`auditStatus`/`goodsStatus`/`switchStatus`）
 * —— 它们当前不对客售卖，价格变化不构成需要跟进的渠道事实。
 *
 * ============================================================================
 * ⚠️ 服务端未就绪时 desktop 看不出异常
 * ============================================================================
 *
 * 上报是**单向通知**：服务端没写对应 Translator 时会回 `PARSE_FAILED` / `SKIPPED`，
 * 而那是 `code=0` 的**正常响应**，失败沉淀成台账，desktop 这侧完全无感。
 *
 * 所以：确认服务端就绪前，先摘掉 report 回调只写基线。
 */
import type { JsonObject } from '../../../shared/types/json';
import type { ChannelId } from '../../ids';
import type { OtaAmountChangeObserved } from '../../../shared/types/amount-change';
import { MEITUAN_ROOM_STATUS_URL } from './room-status-endpoint';

/**
 * ⚠️ 与携程的扫描端点**同名**（都是 `inventoryScan`）。
 *
 * 这是对的：服务端按 `(source, endpointId)` 两元组分派 Translator，`source` 已经区分开
 * 了两个渠道。同名反而让「这是哪一类上报」在两个渠道间保持一致。
 *
 * ⚠️ 但**服务端仍需为 `(meituan, inventoryScan)` 单独写 Translator** —— cells 的形状
 * 与携程完全不同（两个 ID 空间、字段名全不一样）。
 */
export const MEITUAN_SCAN_ENDPOINT_ID = 'inventoryScan';

/**
 * 端点 URL —— 填**房态房量**那个。
 *
 * 一轮扫描打了四个端点（门店列表 / 房型清单 / 价格 / 房态房量），而 `endpointUrl` 只有
 * 一个位置。填房态房量那个的理由：它是**唯一一个两类数据都可能来自的端点**的对照物 ——
 * 价格端点是它的补充，而前两个是组参用的中间步骤，不产出任何 cell。
 *
 * ⚠️ 服务端**不要**靠这个 URL 判断 cell 是哪一类，要看 cell 自身的字段（见文件头的表）。
 */
export const MEITUAN_SCAN_ENDPOINT_URL = MEITUAN_ROOM_STATUS_URL;

export type MeituanInventoryScanRaw = JsonObject &
  Readonly<{
    /** 本轮扫描取回数据的时刻。 */
    probedAt: string;
    /** **只含有差异的格子**，渠道原始行。两个 ID 空间混在一起，见文件头。 */
    cells: readonly JsonObject[];
  }>;

/**
 * 组装扫描差异的上报体。
 *
 * `otaHotelId` **在这里填**（美团取已绑定门店的 `poiId`，由调度层传入）——
 * ⚠️ service 层的 `masterHotelId` 归一**只对携程生效**（`resolveOtaHotelId` 第一行就
 * `if (observed.source !== 'ctrip') return observed.otaHotelId`），不会替这条补。
 * 美团回读那次就是照抄携程的「留空等 service 覆盖」而实际发出了空串，别再犯。
 *
 * `operationId` / `submitAt` 不在这里填，由 service 层补。
 */
export function buildMeituanScanReport(
  source: ChannelId,
  otaHotelId: string,
  cells: readonly JsonObject[],
  probedAt: string = new Date().toISOString(),
): OtaAmountChangeObserved {
  return {
    source,
    // ⚠️ 与携程同值：报的是**比对出的差异**，一条上报可能同时含价、量、态三类格子。
    changeType: 'inventoryDiff',
    endpointId: MEITUAN_SCAN_ENDPOINT_ID,
    endpointUrl: MEITUAN_SCAN_ENDPOINT_URL,
    otaHotelId,
    changeRaw: {
      probedAt,
      cells,
    } satisfies MeituanInventoryScanRaw,
  };
}
