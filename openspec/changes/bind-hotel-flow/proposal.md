## Why

酒店绑定流程目前不存在：用户无法把一个 OTA 酒店绑到 RMS 酒店上。地基已由前两个 change 备好——`ota_hotel` 的写入口 `save()` 与远端 `RmsOtaAccountGateway.bind()` 都已就位但**零调用方**，探测能产出候选却无人接收。本次把这条链接通。

## What Changes

- `OtaTabService.openExisting(credentialId, intent?: unknown)` 的 `intent` 由占位收窄为具体 union；`LoginDetector.register` 接收并保存 intent，随 `tab:credential-checked` 带出，tab 关闭时清除
- 新增 `shared/types/ui-waiting-result-types.ts`：`kind → payload` 映射表，双进程共用的契约；新增 `renderer/waiting-ui-result.ts`：`await(kind, requestId, cb) → cancel`
- `HotelProbeDispatcher` 注入 `notify` 窄回调：探测出候选后判断来源标签页是否仍存活，存活才向上通知；composition root 把它接到 `webContents.send`
- `HotelManagementService` 新增 `startBinding`（生成 requestId、经 `OtaTabService` 开 tab 并携带 intent）与 `confirmBinding`（远端 `bind()` + 本地 `save()`）
- 浏览器工作区新增候选酒店弹窗：**就地展示，不跳转**；用户可点「否」关闭并换渠道重试（重试能跑通依赖 Change 1 已删除的探测早退）
- 用户每次只能选定一家酒店

**关键约束**（讨论中确认，写入 design）：候选结果随通知发给 renderer 而非暂存主进程——候选的生命周期与弹窗完全一致，用户关窗/切页/否决即消亡，主进程全程无 pending 状态。

## Capabilities

### New Capabilities

- `hotel-ota-binding`: 用户发起绑定、探测产出候选、候选回到 UI、用户选定后写远端与本地的完整流程，以及这条链路上的状态归属约定。

### Modified Capabilities

- `local-ota-credentials`: 「本地只保存酒店信息，不表达绑定关系」的写入触发点由抽象的「用户确认」具体化为本次的 `confirmBinding`，并补充远端先于本地的顺序要求。

## Impact

| 层 | 影响 |
|---|---|
| `shared/types/ui-waiting-result-types.ts` | 新增：kind → payload 契约 |
| `shared/browser.ts` / `shared/ipc-channels.ts` | 新增绑定意图 schema、候选通知频道 |
| `main/ota-tab/ota-tab-service.ts` | `intent` 收窄为 union |
| `main/ota-tab/login-detector.ts` | `register` 存 intent，广播时带出，tab 关闭时清除 |
| `main/ota-tab/tab-event-bus.ts` | 事件契约增加 intent 字段 |
| `main/channels/hotel-probe-dispatcher.ts` | 注入 `notify`；判断 `webContents.isDestroyed()` |
| `main/services/hotel-management-service.ts` | 新增 `startBinding` / `confirmBinding` |
| `main/ipc/hotel-management-handlers.ts` | 新增两个入口 |
| `main/composition/window-scope.ts` | 接 `notify` 到 `webContents.send`；`HotelManagementService` 获得 `OtaTabService` 依赖 |
| `preload/namespaces/` | 新增候选通知订阅与两个 invoke |
| `renderer/waiting-ui-result.ts` | 新增等待原语 |
| `renderer/components/browser/` | 新增候选酒店弹窗 |
| `renderer/pages/HotelManagementPage.svelte` | 绑定入口按钮 |
| 用户可见行为 | **绑定流程可用**（前两个 change 后的空窗期结束） |

依赖：Change 1（`save()`、删早退）与 Change 2（dispatcher 落位 `channels/`）均已完成。
