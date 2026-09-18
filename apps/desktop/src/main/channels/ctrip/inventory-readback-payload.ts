/**
 * 携程**房量回读**的 `changeRaw` 模型 —— **RMS 侧对接这个端点时读这一份**。
 *
 * | | |
 * |---|---|
 * | `source` | `ctrip` |
 * | `changeType` | `inventoryReadback` |
 * | `endpointId` | `getRoomInventoryInfo` ⚠️ **回读端点，不是触发它的写端点** |
 * | 触发 | 用户在日历页 / 批量页改完房态房量，且渠道判定成功 |
 *
 * ============================================================================
 * ⚠️ 一句话摘要：这条上报报的是「**实际变成了什么**」，不是「用户想改成什么」
 * ============================================================================
 *
 * 既有的 `changeType: 'roomStatus'` 上报报的是**写请求报文**（用户的意向）。但携程房量的
 * 「增加 / 减少」是相对操作（`remainRoomQuantityType: 11`(加) / `12`(减) 只说「+2」不说
 * 基数），且写接口**不回传改后状态** —— 所以 RMS 算不出改后的绝对房量。
 *
 * 本上报补的就是这块：改完之后主动读回渠道的真实状态。
 *
 * ```
 * 上报 A  changeType=roomStatus        changeRaw = 写请求报文        ← 想改成什么
 * 上报 B  changeType=inventoryReadback changeRaw = { trigger, cells } ← 实际是什么
 * ```
 *
 * ⚠️ 两条上报的 `operationId` **独立，不可互相去重** —— 是两个不同的事实。
 *
 * ============================================================================
 * changeRaw 结构
 * ============================================================================
 *
 * ```json
 * {
 *   "trigger": {
 *     "endpointId": "batchUpdateRoomStatusAndQuantity",
 *     "observedAt": "2026-09-18T10:00:00.000Z",
 *     "rawRequest": { "roomProductIds": ["1569052069"], "dates": { … }, "remainRoomQuantityType": 11, … }
 *   },
 *   "probedAt": "2026-09-18T10:00:03.000Z",
 *   "truncated": false,
 *   "cells": [
 *     { "hotelID": 122247738, "roomTypeID": 1569052069, "effectDate": "2026-10-20",
 *       "payType": "PP", "roomStatus": "G", "limitSale": "T", "freeSale": "F",
 *       "totalQuantity": 6, "canUsedQuantity": 6, "hasInventory": true, … }
 *   ]
 * }
 * ```
 *
 * | 字段 | 含义 |
 * |---|---|
 * | `trigger.endpointId` | 触发本次回读的**写端点**（`setbatchroombookablestatus` 或 `batchUpdateRoomStatusAndQuantity`） |
 * | `trigger.rawRequest` | 那次写请求的报文，**与上报 A 的 `changeRaw` 是同一份**（见下） |
 * | `probedAt` | 回读完成时刻 |
 * | `truncated` | `true` = 因 `applyAllDates` 被裁剪，**数据不是完整快照**（见下） |
 * | `cells` | 携程 `roomStatusResult` 的行，**原样透传** |
 *
 * ## `rawRequest` 复用上报 A 的 `changeRaw`，不另行裁剪
 *
 * 既有 `parse` 已经把 `reqHead` / `cipher` / `head` / `holidyInfo` 剔掉了，这里直接复用
 * 同一份对象。**刻意不重写一套裁剪** —— 两套逻辑各自演化后会让同一次操作在两条上报里
 * 长得不一样，排查时无从判断哪份为准。
 *
 * `rawRequest` 的逐字段语义见各自的规格文件，本文件不重复：
 * - 日历页 → `./room-status-payload.ts`
 * - 批量页 → `./room-status-quantity-payload.ts`
 *
 * ============================================================================
 * ⚠️ 四条反直觉约定
 * ============================================================================
 *
 * ## 1. `limitSale: "F"` 时房量 0 **不代表没房**
 *
 * 不限量 / FreeSale 时房量字段本就是 0，`hasInventory` 也可能是 `false`，但**实际有房**。
 *
 * | 页面显示 | limitSale | freeSale | totalQuantity | 说明 |
 * |---|---|---|---|---|
 * | 限量 剩7 | `"T"` | — | 9 | 正常限量 |
 * | FS | `"F"` | `"T"` | 0 | `hasInventory:false` 但**有房** |
 * | 不限 | `"F"` | — | 0 | 同上 |
 *
 * **判读顺序**：先看 `freeSale === "T"` → 不限量；否则看 `limitSale`，`"T"` 才读房量数字。
 * ⛔ 仅凭 `totalQuantity` / `hasInventory` 判无房，会把不限量的房型判成满房。
 *
 * ## 2. `cells[].hotelID` **不可用于匹配门店**
 *
 * 它是携程内部「**门店 × 售卖模式**」层的标识（同店预付/现付各一个），与账号粒度的门店
 * 标识不同源。匹配门店请用**顶层 `otaHotelId`**（已用凭证的 `masterHotelId` 归一过）。
 *
 * ⚠️ 后果具体：`ota_hotel_id` 是 `uk_ota_sale` 第 4 列，值不对 → upsert 撞不上唯一键 →
 * INSERT 新行 → 同一房型两行。
 *
 * ## 3. `truncated: true` 时数据**不是完整快照**
 *
 * 用户勾选「应用到所有日期」时携程会修改**从今日起约两年**的日期，并改变未显式设置过的
 * 日期的默认值。这个范围客户端算不出来（要知道哪些日期被设置过，本身就得先有全量快照），
 * 所以只回读配置窗口内的天数。
 *
 * ⚠️ 此时 **不可**认为「`cells` 里没出现的日期就是没变」—— 窗口之外的状态未知。
 *
 * ## 4. `cells` 的日期范围**已经是精确范围**
 *
 * desktop 侧已把日期区间与星期筛选取过交集，`cells` 里的日期**恰好**是用户本次改动实际
 * 影响的那些天。
 *
 * ⚠️ **不要再拿 `rawRequest` 里的日期区间去展开** —— 用户只勾了周末时那是 7 天，会比实际
 * 多跟 5 天。要跟价直接用 `cells[].effectDate`。
 *
 * ============================================================================
 * 其他须知
 * ============================================================================
 *
 * - **不区分房态与房量**：回读行本就同时含两者，desktop 整行照报。与上报 A 重复的部分由
 *   RMS 自行裁剪 —— 让客户端判断「房态已报过所以这次只报房量」会引入易错的语义判断，
 *   而它的失效方式是**静默丢数据**。
 * - **房态取值形式两条上报不同**：上报 A 是写报文的 `1`/`2`/`-100`（批量页）或 `"G"`/`"N"`
 *   （日历页），本上报是读接口的 `"G"`/`"N"`/`"Y"`（多一个「手动关房」）。不可混用解析。
 * - **`cells` 可能为空**：该房型这些天确实没数据，这是**合法结果**，与失败不同。
 * - **偶发漏报是已知取舍**：回读失败不重试、不落盘。「有 A 无 B」是正常情况，不该告警。
 */
import type { JsonObject } from '../../../shared/types/json';
import type { OtaAmountChangeObserved } from '../../../shared/types/amount-change';

/** 回读端点。⚠️ 用它而非触发它的写端点 —— 后者已被既有 Translator 认领，复用会撞键。 */
export const READBACK_ENDPOINT_ID = 'getRoomInventoryInfo';

export const READBACK_URL =
  'https://ebooking.ctrip.com/ebkovsroom/api/inventory/getRoomInventoryInfo';

/**
 * 携程房量回读的 `changeRaw`。
 *
 * 用 `JsonObject` 的宽松形状而非逐字段严格类型，与同目录另外三份规格同一理由：desktop
 * **忠实透传、不解读语义**，逐字段建模等于在这里复刻携程的房态语义，而携程随时可能加
 * 字段（加了就会被静默丢弃）。
 */
export type CtripInventoryReadbackRaw = JsonObject &
  Readonly<{
    trigger: Readonly<{
      endpointId: string;
      observedAt: string;
      rawRequest: JsonObject;
    }>;
    probedAt: string;
    truncated: boolean;
    cells: readonly JsonObject[];
  }>;

/**
 * 组装回读的上报体。
 *
 * `otaHotelId` **留空串**：service 层会用凭证的 `masterHotelId` 覆盖它（与既有改动上报同
 * 一段逻辑）。⛔ 绝不能拿回读响应里的 `hotelID` 填 —— 那是「门店 × 售卖模式」层。
 *
 * `operationId` / `submitAt` 也不在这里填，同样由 service 层补 —— 于是两条上报天然拿到
 * 各自独立的 `operationId`。
 */
export function buildCtripReadbackReport(
  trigger: OtaAmountChangeObserved,
  cells: readonly JsonObject[],
  truncated = false,
  probedAt: string = new Date().toISOString(),
): OtaAmountChangeObserved {
  return {
    source: trigger.source,
    changeType: 'inventoryReadback',
    endpointId: READBACK_ENDPOINT_ID,
    endpointUrl: READBACK_URL,
    otaHotelId: '',
    changeRaw: {
      trigger: {
        endpointId: trigger.endpointId,
        // `OtaAmountChangeObserved` 没有时间字段（`submitAt` 由 service 层补），这里取
        // 组装时刻 —— 与真实观测时刻差几毫秒，对用途没有影响。
        observedAt: new Date().toISOString(),
        rawRequest: trigger.changeRaw,
      },
      probedAt,
      truncated,
      cells,
    } satisfies CtripInventoryReadbackRaw,
  };
}
