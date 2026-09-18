## Why

携程房量的「增加 / 减少」是**相对操作** —— 批量页的 `remainRoomQuantityType: 11`(加) / `12`(减) 只说「+2」不说基数，RMS 收到后算不出改后的绝对房量。日历页虽然目前只见 `Set`（绝对赋值）样本，但它的「限量 / 不限量 / FreeSale」切换同样会改变房量语义（`limitSale:"F"` 时房量 0 不代表没房），光看写请求同样判不准。

更根本的问题是：**写请求的响应不回传改后状态**。日历页响应 `data: null`，批量页响应只有 `taskId` + 受理成功。所以「渠道现在到底是什么状态」这件事，不主动回读就无从得知。

现有 `ota-amount-change-report` 链路解决的是「用户想改成什么」，本 change 补上「实际变成了什么」。

**与 `add-ctrip-inventory-prob` 的关系**：那份 design 的接口契约与字段语义（两步读接口、房态枚举映射、登录失效四形态）全部继承，但**触发模型完全不同** —— 那份是定时轮询全量，本次是**改动事件驱动的定向回读**。定时轮询不解决本问题：用户改完到下一轮轮询之间的窗口里，RMS 拿到的仍是旧值。那份 change 未实施（只有文档），本 change 不修改它。

## What Changes

- 新增 `InventoryReadback` 渠道能力（port + 携程实现）：给定 (房型集合, 日期区间) 回读房态房量
- 复用既有 `AmountChangeWatcher` 的观测结果，在既有上报之外**并行**派生一条回读链路（既有上报行为不变）
- 新增 `channels/inventory-readback-dispatcher.ts`：**第五种触发模型**（改动事件驱动），与既有四种并列
- 回读在**用户当前标签页内**发起（`executeJavaScript`），不走主进程 HTTP
- 回读结果复用 `POST /api/v1/app/ota-changes` 上报，`changeType: 'inventoryReadback'`、`endpointId: 'getRoomInventoryInfo'`
- 新增 `main/app-config/`：运行期可调参数的统一落位（本期只做内置默认值层，预留服务端下发接口形状）
- 产出 `docs/服务端需求-携程房量回读上报.md`：给 rms-server 的 Translator 需求，**本 change 不改服务端代码**

## Capabilities

### New Capabilities
- `ctrip-inventory-readback`: 携程房量改动后的定向回读 —— 从写请求还原 (房型 × 日期)、延迟回读、结果上报
- `desktop-app-config`: 运行期可调参数的统一配置层（默认值 → 服务端下发 → 本地覆盖的取值优先级）

### Modified Capabilities
- `ota-amount-change-report`: 新增一种上报形态（回读快照），与既有改动上报共用端点但语义不同；明确二者 `operationId` 独立、互不去重

## Impact

| 区域 | 影响 |
|---|---|
| `main/channels/` | 新增 `inventory-readback-dispatcher.ts`、`ctrip/inventory-readback.ts` 及 payload 规格；`types.ts` 加 port、`registry.ts` 加可选字段与投影 |
| `main/channels/ctrip/amount-change-adapter.ts` | **只增不改**：新增「从写请求还原房型日期」的纯函数导出，既有 `parse` 行为一字不动 |
| `main/app-config/` | 全新目录 |
| `main/composition/window-scope.ts` | 装配 dispatcher + 注入窄回调 |
| `shared/types/amount-change.ts` | `OtaChangeType` 加 `'inventoryReadback'` |
| 外部依赖 | 携程 `getRcProductList` / `getRoomInventoryInfo` 两个读接口（worker 侧已在生产验证，纯 cookie 无签名） |
| rms-server | **本 change 不改**。未认领的 `endpointId` 会落 `raw_body` 并返回 `UNKNOWN_ENDPOINT`，报文不丢 |
| 暂不涉及 | 美团 / 抖音；服务端 Translator；appconfig 的服务端下发链路 |

## Non-Goals

- 不改服务端代码（只产出需求文档）
- 不实现 appconfig 的服务端下发（只立结构 + 默认值）
- 不做定时轮询（`add-ctrip-inventory-prob` 的范畴，本次不实施也不删除）
- 不在 desktop 侧解读房态语义（`"G"/"N"`、`"T"/"F"` 原样透传，与既有 `changeRaw` 口径一致）
- 不覆盖美团的两份房量踩点（`docs/踩点/美团/` 下未提交的两份，后续单独立 change）
