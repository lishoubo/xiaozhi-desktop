# 携程房态监听

## Why

价量态监听目前只覆盖「价」，用户在渠道后台改**房态**（开房/关房）RMS 一无所知。携程房态已完成踩点（`docs/踩点/携程/房量01.md`），端点与页面都落在现有监听链路的射程内，接入成本只是一个适配器分支。

同时暴露契约的一处缺口：`OtaAmountChangeReport` 没有字段说明「这次改的是什么」，RMS 只能靠 `(source, endpointId)` 查表反推 —— desktop 每加一个端点都要通知 RMS 同步一行。

## What Changes

- **上报契约新增 `changeType` 字段**（`'price' | 'roomStatus'`），由渠道适配器在 `parse()` 时返回，随上报体发给 RMS。
  - `'roomStatus'` 是**量态类改动的统称**（房态开关 + 房量），语义上是**意向标记而非精确分类**：RMS 必须读 `changeRaw` 才知道实际改了什么。这样后续接入抖音 `batch_save_stock_state_calendar`（一个请求体里房态房量都有）与美团那两个端点时，枚举不必再动。
  - `endpointId` 保留原语义（走的哪个接口），RMS 解析 `changeRaw` 形状时仍依赖它。
  - **不改 rms-server**：desktop 侧照发，服务端如何接收不在本次范围。
- **携程适配器新增房态端点** `setbatchroombookablestatus`。开房与关房是同一端点、同一形状，只差 `roomStatus` 字段取值（`G` 开 / `N` 关），不拆两个 `endpointId`。
- **新增携程房态的 `changeRaw` 模型** `channels/ctrip/room-status-payload.ts`，与既有 `amount-change-payload.ts` 并列。剔除 `holidyInfo`（携程前端塞进 `dateItemInfoDtoList[]` 的节假日字典，与本次改动无关的静态噪音）。
- **三个既有渠道适配器补 `changeType: 'price'`** —— 契约加了必填字段，抖音/携程/美团的现有分支都要显式声明。

**非目标**：房量（携程本次踩点没有）、抖音房态、美团房态房量。机制层（`amount-save-capture.ts` / `amount-change-watcher.ts`）**一行不改**。

## Capabilities

### New Capabilities

- `ota-amount-change-report`: 价量态改动上报的跨模块契约 —— desktop 观测渠道后台的手工改动并上报 RMS 的报文形状、渠道适配器接口、以及各渠道 `changeRaw` 的解读规格。这条能力链路已实装（抖音/携程/美团改价）但从未沉淀进 `openspec/specs/`；本次因新增 `changeType` 触及跨系统契约，补建该 spec 并含本次差量。

### Modified Capabilities

（无）

## Impact

| 范围 | 影响 |
|---|---|
| `apps/desktop/src/shared/types/amount-change.ts` | `OtaAmountChangeReport` 新增 `changeType`，`OtaAmountChangeObserved` 随之带上 |
| `apps/desktop/src/main/channels/types.ts` | `AmountChangeAdapter.parse` 的返回体多一个字段（接口本身不变） |
| `apps/desktop/src/main/channels/ctrip/` | 适配器加端点 + 分支；新增 `room-status-payload.ts` |
| `apps/desktop/src/main/channels/douyin/`、`meituan/` | 各补 `changeType: 'price'` |
| `apps/desktop/src/main/gateway/rms/rms-amount-change-gateway-http.ts` | 请求体与日志各加一个字段 |
| **rms-server（外部系统）** | desktop 会开始发 `changeType`。服务端侧的接收不在本次范围，由 RMS 团队处理；未接收时该字段被忽略，不影响既有改价上报 |
| 机制层 `amount-save-capture.ts` / `amount-change-watcher.ts` | **不改** |
| 页面路径 `WATCH_PATHS` | **不改** —— 房态踩点的 referer 是 `/ebkovsroom/inventory/calendar`，已被现有前缀覆盖 |
