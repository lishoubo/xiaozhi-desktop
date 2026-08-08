## Why

`TabEventBus` 住在 `main/services/`，但它的**唯一发射方**是 `main/ota-tab/login-detector.ts`——`services/` 下没有任何 service 发射它，只有 services 订阅它。位置放错让下游被迫绕路：酒店探测的调度器（`OtaHotelProbService`）本该跟它调度的 `channels/` 探测实现放在一起，却因为要订阅 `services/` 里的总线而只能留在 `services/`。

探测调度与浏览器强相关（注入脚本、拦截响应、解析页面），且后续会有多种触发源（用户绑定意图、后台自动爬取），它属于渠道适配层而不是业务编排层。总线归位后这一步才成立。

## What Changes

- `main/services/tab-event-bus.ts` 移至 `main/ota-tab/tab-event-bus.ts`，与唯一发射方同居；`ota-tab/index.ts` 对外导出
- `main/services/ota-hotel-prob-service.ts` 移至 `main/channels/hotel-probe-dispatcher.ts`，类名 `OtaHotelProbService` → `HotelProbeDispatcher`——它只做「订阅事实 → 选 probe → 调用 → 向上通知」的分发，探测逻辑本就在 `channels/<渠道>/hotel-prob.ts` 里
- **BREAKING**（分层契约）`channels/` 的依赖约束收紧并放宽一处：新增禁止 `database/`、`gateway/`，明确允许 `ota-tab/`；`services/`、`ipc/`、`composition/` 维持禁止
- eslint `import/no-restricted-paths` 补齐上述 zones——现有规则只在散落的 `no-restricted-imports` 里禁了实现类，没有针对 `channels/` 的反向依赖 zone
- 修正两处失效注释：`services/tab-event-bus.ts` 提到已删除的 `main/features/ota-credential/`；`services/ota-credential-service.ts` 提到总线旧路径

**不改变任何运行时行为**：纯文件移动、重命名与 lint 规则补齐。事件契约、广播时机、探测触发条件均不变。

**不在本次范围**：Change 3（intent union、detector 存/清 intent、候选下行通知、`startBinding`/`confirmBinding`、弹窗）。本次只调整位置与约束，为 Change 3 的 dispatcher 落位与 notifier 注入让路。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `desktop-main-layering`: 两条分层要求变更。① `channels/` 的依赖约束需补充 `database/`、`gateway/` 禁令并明确允许 `ota-tab/`；② `tab:credential-checked` 的广播契约中，订阅方由 `OtaHotelProbService`（`services/`）改为 `HotelProbeDispatcher`（`channels/`），且需明确总线归属 `ota-tab/`。

## Impact

| 层 | 影响 |
|---|---|
| `main/ota-tab/tab-event-bus.ts` | 新位置（自 `services/` 移入）；`ota-tab/index.ts` 增加导出 |
| `main/channels/hotel-probe-dispatcher.ts` | 新位置 + 改名（自 `services/ota-hotel-prob-service.ts` 移入） |
| `main/composition/window-scope.ts` | import 路径与类名更新 |
| `main/ota-tab/login-detector.ts` | import 路径由 `../services/tab-event-bus` 改为同目录 |
| `main/services/ota-credential-service.ts` | 仅注释中的路径引用 |
| `apps/desktop/.eslintrc.json` | 新增 `channels/` 反向依赖 zones |
| 单元测试 | `tab-event-bus.test.ts`、`login-detector.test.ts`、`ota-hotel-prob-service.test.ts` 的 import 路径与命名；后者文件名一并改为 `hotel-probe-dispatcher.test.ts` |
| 用户可见行为 | **无变化** |

依赖关系：与 Change 1（已完成）无冲突；Change 3 依赖本次的 dispatcher 落位。
