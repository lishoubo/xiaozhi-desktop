/**
 * 美团**房量回读**的 `changeRaw` 模型 —— **RMS 侧对接这个端点时读这一份**。
 *
 * | | |
 * |---|---|
 * | `source` | `meituan` |
 * | `changeType` | `inventoryReadback` |
 * | `endpointId` | `queryRoomStatusInfo` ⚠️ **回读端点，不是触发它的写端点** |
 * | 触发 | 用户在房量页面改完房量，且渠道判定成功 |
 *
 * ============================================================================
 * ⚠️ 一句话摘要：这条上报报的是「**实际变成了什么**」，不是「用户想改成什么」
 * ============================================================================
 *
 * 既有的 `changeType: 'roomStatus'` 上报（`MeituanInventoryUpdateTranslator` 消费）报的是
 * **写请求报文**（用户的意向），而且服务端**刻意只采房态不采房量** —— 那个类注释写明理由是
 * 踩点边界：当时 5 条样本里 `count`/`countType`/`limitChangeValue` 恒定不变，无法推断语义，
 * 猜错会把「房态操作」变成「把房量改成 0」。
 *
 * 更根本的是美团房量的「增加 / 减少」是**相对操作**：
 *
 * ```
 * countType  1520  设为某值    limitChangeValue = 目标值
 *            1620  增加        limitChangeValue = 增量      ← 不说基数
 *            1720  减少        limitChangeValue = 减量      ← 不说基数
 *            1920  设为不限    limitChangeValue = 0
 *            1525  设值+预留   limitChangeValue = 房量, count = 预留房数
 *            1020  纯房态操作  三个字段恒 0（只改 invSwitch）
 * ```
 *
 * 而写接口**不回传改后状态**。所以 RMS 算不出改后的绝对房量。本上报补的就是这块。
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
 *     "endpointId": "inventory-update",
 *     "observedAt": "2026-09-18T10:00:00.000Z",
 *     "rawRequest": { "poiId": "1834077877", "modifyInventoryModelList": [ … ] }
 *   },
 *   "probedAt": "2026-09-18T10:00:01.000Z",
 *   "truncated": false,
 *   "cells": [
 *     { "roomId": 493882496, "roomName": "云享三人间", "roomCategory": 1,
 *       "containerId": 372062584, "date": "2026-09-19", "roomStatus": 1,
 *       "limitType": 1, "remainCount": 1, "limitRemain": 5, "usedCount": 0,
 *       "invSwitch": 1, "shareType": 1 }
 *   ]
 * }
 * ```
 *
 * | 字段 | 含义 |
 * |---|---|
 * | `trigger.endpointId` | 触发本次回读的**写端点**，恒为 `inventory-update` |
 * | `trigger.rawRequest` | 那次写请求的报文，**与上报 A 的 `changeRaw` 是同一份** |
 * | `probedAt` | 回读完成时刻 |
 * | `truncated` | **恒 `false`**，见下 |
 * | `cells` | 美团 `roomStatusMap` 展平后的行 |
 *
 * ## 与携程回读上报**同构**
 *
 * 外层四个字段与 `ctrip/inventory-readback-payload.ts` 完全一致，服务端可以一套逻辑
 * 处理两个渠道，差异只在 `cells` 的字段名。
 *
 * ## `truncated` 恒 `false`
 *
 * 携程有「应用到所有日期」选项（会改从今日起约两年，客户端算不出范围，只能裁剪窗口并
 * 标记 `truncated`）。**美团没有这个选项**，回读范围总是精确的。字段保留纯为与携程同构。
 *
 * ============================================================================
 * ⚠️ 四条反直觉约定
 * ============================================================================
 *
 * ## 1. `limitRemain` 是用户设置的房量（真机实证），但 desktop 仍不判读
 *
 * 2026-09-18 真机三组，覆盖相对与绝对两种写路径，都指向 `limitRemain`：
 *
 * | 用户操作 | 写请求 | 回读 `limitRemain` |
 * |---|---|---|
 * | 房量 +1（结果 19） | `countType:1620, limitChangeValue:1` | **19** |
 * | 周末 19 / 平时 17 | `countType:1520`，两档 | 周五 **19**、周四 **17** |
 * | 2 房型各设 18 | `countType:1520` | **18 / 18** |
 *
 * ⚠️ 第一组尤其关键：写报文里**只有「+1」，没有任何地方出现 19** —— 绝对值只能由回读
 * 得到。这正是本链路的立论。
 *
 * 同格 `remainCount` 为 1~2、`usedCount` 为 0，显然是不同语义（推测 `remainCount`=
 * 物理剩余、`usedCount`=已售，**未实证**）。
 *
 * ⚠️ 三组都是「无预留房、`usedCount:0`、`limitType:1`」的干净场景，**有已售或有预留房时
 * 三字段如何分配尚无样本**。
 *
 * ⚠️ `limitType: 2`（不限量）时 `limitRemain` 是 **998/999 这类哨兵值**，不是真实房量。
 * 仅凭数字判「还剩几间」会把不限量的房型判成快满房。**先看 `limitType`，再读数字。**
 *
 * **desktop 侧仍整行透传，不取任何一个字段当房量** —— 上述结论供服务端采用，但客户端
 * 一旦开始解读语义，美团改字段时就会静默错报。
 *
 * ## 2. ⚠️ `cells` 只含**日历房**，已按 `roomCategory === 1` 过滤
 *
 * 美团回读接口对**同一个 `roomId` 会返回两行**，靠 `roomCategory` 区分，`containerId`
 * 不同、房量完全独立：
 *
 * ```
 * roomId 493879575  roomCategory 1(日租)  containerId 372062583  limitType 1  limitRemain 1
 * roomId 493879575  roomCategory 2(钟点)  containerId 392353398  limitType 2  limitRemain 999
 * ```
 *
 * 实证：踩点的「钟点房设置房量」样本用 `hourRoomIdList:[493879575]`，与日租那条的
 * roomId **完全相同** —— 同一 id 兼具两副身份。
 *
 * desktop 只上报 `roomCategory === 1` 的行，与服务端
 * `MeituanInventoryUpdateTranslator`「只跟日历房」同口径。钟点房的改动**不触发回读**。
 *
 * ## 3. `cells` 的日期范围**已经是精确范围**
 *
 * desktop 侧已把日期区间与星期筛选取过交集，`cells` 里的日期**恰好**是用户本次改动实际
 * 影响的那些天。
 *
 * ⚠️ **不要再拿 `rawRequest` 里的 `modifyDates` 去展开** —— 用户只勾了周五六时那可能是
 * 30 天，会比实际多跟 20 多天。要跟价直接用 `cells[].date`。
 *
 * ⚠️ `rawRequest.modifyParamByEffectWeeks[].effectWeek` 是 **ISO 星期，1 = 周一**，
 * 与服务端 `RawBodyReader.weekdaysFromInts` + `toDayOfWeek`（`DayOfWeek.of(v)`）同口径。
 *
 * ## 4. `roomId` 是**物理房型** id，不是售卖房型
 *
 * 与既有 `inventory-update` 上报一致 —— 下游认的 `goodsId` 需查库展开，1:多。
 * 匹配门店请用**顶层 `otaHotelId`**（service 层已用凭证的 `masterHotelId` 归一）。
 *
 * ============================================================================
 * 其他须知
 * ============================================================================
 *
 * - **纯房态操作也会回读**（`countType: 1020`）：读回的房量正是「没变」这一事实，同样有效。
 *   不按 `countType` 猜「这次改的是不是房量」—— 那个判断的失效方式是静默漏报。
 * - **`cells` 可能为空**：该房型这些天确实没数据，这是**合法结果**，与失败不同。
 * - **偶发漏报是已知取舍**：回读失败不重试、不落盘。「有 A 无 B」是正常情况，不该告警。
 */
import type { JsonObject } from '../../../shared/types/json';
import type { OtaAmountChangeObserved } from '../../../shared/types/amount-change';

/** 回读端点。⚠️ 用它而非触发它的写端点 —— `inventory-update` 已被既有 Translator 认领。 */
export const MEITUAN_READBACK_ENDPOINT_ID = 'queryRoomStatusInfo';

export const MEITUAN_READBACK_URL =
  'https://me.meituan.com/api/gw/v1/product/goods/queryRoomStatusInfo';

/**
 * 美团房量回读的 `changeRaw`。
 *
 * 用 `JsonObject` 的宽松形状而非逐字段严格类型，与携程同一理由：desktop **忠实透传、
 * 不解读语义**，逐字段建模等于在这里复刻美团的房量语义，而美团随时可能加字段
 * （加了就会被静默丢弃）。
 */
export type MeituanInventoryReadbackRaw = JsonObject &
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
 * ## ⚠️ `otaHotelId` 必须在这里填，service 层**不会**替美团补
 *
 * `AmountChangeReportService.resolveOtaHotelId()` 第一行就是
 * `if (observed.source !== 'ctrip' || …) return observed.otaHotelId` —— 那段归一
 * **只对携程生效**（携程有「门店 × 售卖模式」与账号粒度两个 ID 要对齐，美团没有这种形状，
 * 它的 javadoc 明写「覆盖只会引入偏差」）。
 *
 * 所以这里留空串的话，发出去就**真的是空串**（2026-09-18 真机日志实证：
 * 改动上报 A 是 `'1834077877'`，回读上报 B 是 `''`）。服务端
 * `AppOtaChangeLocator.locate()` 的 `if (otaHotelId != null && !otaHotelId.isBlank())`
 * 会跳过按门店反查，退化成靠售卖房型 id 反查 —— 而回读的 cells 里只有**物理**房型 id。
 *
 * 取 `poiId`（= 写请求顶层那个），与既有改动上报 `parseRoomStatusOrInventory` 同口径、同值。
 *
 * `operationId` / `submitAt` 不在这里填，由 service 层补 —— 于是两条上报天然拿到各自
 * 独立的 `operationId`。
 */
export function buildMeituanReadbackReport(
  trigger: OtaAmountChangeObserved,
  cells: readonly JsonObject[],
  poiId: string,
  probedAt: string = new Date().toISOString(),
): OtaAmountChangeObserved {
  return {
    source: trigger.source,
    changeType: 'inventoryReadback',
    endpointId: MEITUAN_READBACK_ENDPOINT_ID,
    endpointUrl: MEITUAN_READBACK_URL,
    otaHotelId: poiId,
    changeRaw: {
      trigger: {
        endpointId: trigger.endpointId,
        // `OtaAmountChangeObserved` 没有时间字段（`submitAt` 由 service 层补），这里取
        // 组装时刻 —— 与真实观测时刻差几毫秒，对用途没有影响。
        observedAt: new Date().toISOString(),
        rawRequest: trigger.changeRaw,
      },
      probedAt,
      // 美团没有「应用到所有日期」选项，回读范围总是精确的。见文件头。
      truncated: false,
      cells,
    } satisfies MeituanInventoryReadbackRaw,
  };
}
