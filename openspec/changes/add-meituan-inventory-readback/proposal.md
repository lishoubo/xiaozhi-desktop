## Why

美团房量的「增加 / 减少」是**相对操作** —— `countType: 1620`(加) / `1720`(减) 配 `limitChangeValue` 只说「+1」「-3」，不说基数，RMS 收到后算不出改后的绝对房量。「设为不限」（`countType: 1920`）更是连数字都没有。

而写请求的响应**不回传改后状态**。所以「渠道现在到底是什么房量」这件事，不主动回读就无从得知。

现有 `changeType: 'roomStatus'` 上报（`MeituanInventoryUpdateTranslator` 消费）报的是「用户想改成什么」，且服务端**刻意只采房态不采房量** —— 类注释写明理由是踩点边界：当时 5 条样本里 `count`/`countType`/`limitChangeValue` 恒定不变，无法推断语义，而猜错会把「房态操作」变成「把房量改成 0」。本 change 补上「实际变成了什么」，让房量有一个**不依赖语义推断**的事实来源。

**与携程 `add-ctrip-inventory-readback` 的关系**：机制层（`InventoryReadback` 接口、`inventory-readback-dispatcher.ts`、`registry.ts` 投影、`changeType: 'inventoryReadback'`）已在那个 change 建成并真机验证，且已确认**无渠道硬编码**。本 change 只写美团实现 + `registry.ts` 加一行。

## 美团比携程简单的三处

| | 携程 | 美团 |
|---|---|---|
| 回读请求 | **两步**（`getRcProductList` 补六字段 → `getRoomInventoryInfo`） | **一步**（`queryRoomStatusInfo`，请求体五个字段） |
| 写入时序 | **异步**，`rcode:200` 只代表受理，需 `batch-task-gate` 拦任务轮询 | **同步**（用户确认），改完即可回读 |
| 「应用到所有日期」 | 有，需裁剪窗口 + `truncated` 标记 | **无此选项**，`truncated` 恒 `false` |

因此本 change **不需要** `batch-task-gate` 的对等物，也不需要 `windowDays` 配置项。

## What Changes

- 新增 `channels/meituan/inventory-readback.ts` + `inventory-readback-payload.ts` + `room-change-targets.ts`（美团实现，三份文件与携程同构）
- `registry.ts` 的美团条目加 `inventoryReadback` 一行
- `app-config` 加 `meituanInventoryReadback`（只有 `timeoutMs`，**不含** `delayMs` / `windowDays`）
- 产出「服务端需求」文档：给 rms-server 的 Translator 需求，**本 change 不改服务端代码**

## Capabilities

### New Capabilities
- `meituan-inventory-readback`: 美团房量改动后的定向回读 —— 从写请求还原 (房型 × 日期)、回读、按日历房过滤、结果上报

### Modified Capabilities
- `desktop-app-config`: 新增 `meituanInventoryReadback` 配置项

## Impact

| 区域 | 影响 |
|---|---|
| `main/channels/meituan/` | 新增三份文件 |
| `main/channels/registry.ts` | 美团条目加一行；`ChannelAdapter.inventoryReadback` 的注释「当前只有携程实装」需更新 |
| `main/channels/meituan/amount-change-adapter.ts` | **零改动**（端点常量 `INVENTORY_ENDPOINT_ID` 需导出，这是唯一改动，行为不变） |
| `main/app-config/` | `types.ts` / `defaults.ts` 各加一项 |
| 机制层（`types.ts` / dispatcher / watcher / composition） | **一行不动** —— 携程那次已验证无渠道硬编码 |
| 外部依赖 | 美团 `queryRoomStatusInfo` 读接口（同页面 XHR，纯 cookie） |
| rms-server | **本 change 不改**。⚠️ 见 Non-Goals 第 1 条 |

## Non-Goals

- **不改服务端代码**（只产出需求文档）。⚠️ 携程的回读上报目前仍被服务端返回 500（`rmsCode: 10000` = INTERNAL_ERROR），美团走同一端点会是同样结果 —— 这意味着本 change 完成后**端到端不通**，可验证的终点是「desktop 正确发出了上报」。这是已知且经用户确认的边界。
- **不在 desktop 侧解读房量语义**。`remainCount` / `limitRemain` / `usedCount` / `limitType` 的含义交由服务端确认，desktop **整行原样透传**，不写进任何判断分支（与携程口径一致）。
- **不回读钟点房**。`hourRoomIdList` 不处理，与服务端 `MeituanInventoryUpdateTranslator` 「只跟日历房」同口径。
- 不做定时轮询（本链路是改动事件驱动）。
- 不覆盖美团改价链路的回读（`updatePriceV2` 那条路有 `calcPriceV2` 提供改后价，不存在同类问题）。
