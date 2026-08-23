# Verification

日期：2026-08-23  
固定点：`c02ce466e125ff39ca94f240fe6d9bd91074cc0a` (`HEAD`)  
对象：固定点之上的未提交工作区差异

## 结论

本变更的定向验收项已通过。全仓 `npm run verify` 已按完成态规则运行一次，但没有全绿：新增的 lint fixture 当时超过 Vitest 默认 5 秒超时，随后只提高该测试的超时预算并定向验证通过。全量 desktop E2E 另有两条既有断言失败，详见“未通过与限制”。因此本记录不声称全仓验证全绿。

## 架构验收

- 默认 `@hotel-butler/api` 运行时入口只导出可序列化 contracts；`AppRouter` 保留为 type-only projection。
- server-only `@hotel-butler/api/router` 持有 tRPC transport/context interface；OTP、员工身份与 desktop session 工作流由 `apps/server` request endpoint 实现。
- desktop 搜索未发现 `@hotel-butler/api/router`、`ApiContext`、server logger/context/port 的依赖。
- renderer/shared 搜索未发现对 `main/**` 的依赖。
- `.svelte`、production adapter/factory 和嵌套 service 的反向 lint fixture 均被拒绝。
- `AgentGateway` 为 341 行 facade；routing、slot resolution、evidence collection、answer transition 位于 `BusinessExecution`，start/retry/cancel/recovery/active controller 位于 `RunLifecycle`，事件 replay/publish 位于 `RunEventStream`。
- `WindowCapabilityRegistry.requireCurrent()` 在无窗口时显式失败，attach/detach 与重复注册有测试。
- renderer controller 为实例级对象；测试覆盖双实例状态隔离、stream unsubscribe、幂等 dispose 和 conversation view identity 更新。

## 当前定向证据

| 命令/检查 | 结果 |
|---|---|
| `npm run test:unit --workspace @hotel-butler/api -- src/index.test.ts src/router.test.ts` | 2 files / 12 tests passed |
| server gateway + desktop endpoint 定向单测 | 2 files / 35 tests passed |
| desktop boundary + controller + staff auth 定向单测 | 3 files / 17 tests passed |
| `agent-scroll.test.ts` | 2 tests passed |
| desktop production-boundary fixture（含嵌套 service） | 1 test passed |
| desktop/server/api lint | passed |
| desktop/server/api check | passed；Svelte check 0 errors / 0 warnings |
| `npx openspec validate deepen-workspace-module-seams --strict` | passed |
| `git diff --check` | passed |
| Agent 页面定向 E2E：打开 AI 管家 | passed |
| Agent 页面定向 E2E：历史阅读时不抢滚动 | 初次复现失败；修复延迟 tick/RAF 与 scroll-follow 判定后 passed |

Svelte autofixer 对 `AgentPage.svelte` 报告 `issues: []`。保留的建议均针对页面必须持有的 `ResizeObserver`、`requestAnimationFrame`、滚动 DOM 引用与 `bind:this`；这些职责按设计留在页面，不迁入 controller。

## 全量运行记录

`npm run verify` 只运行了一次：

- workspace checks：passed
- workspace lint：passed
- desktop unit：102 files；除新增 boundary fixture 的 5 秒 timeout 外，其余 780 tests passed
- server unit：55 files / 361 tests passed
- api unit：3 files / 20 tests passed
- 因 desktop unit 进程退出 1，verify 未继续进入 E2E

timeout 调整为 15 秒后，boundary fixture 定向运行约 4–5 秒并通过；没有重复运行全量 verify。

随后运行 desktop 全量 E2E，结果为 7/9 passed。两条失败是：

1. calendar 基线期望 mini-calendar 为 2026 年 9 月，实际为 8 月；本变更未修改 calendar 代码。
2. quick-action 基线期望显示内部 tool name `query_hotel_operating_data_sql`，实际 UI 按既有 presentation 显示“查询酒店经营数据”；tool 调用本身完成。本变更未修改该 label 映射。

server E2E 曾单独启动，Playwright `.last-run.json` 记录 `status: failed` 且没有 failed test id；该次终端输出在长输出截断后未保留，无法给出可靠根因，故列为未验证而非通过。

## 独立审查

- Verification pass：独立核对 OpenSpec、diff、边界搜索和定向证据；最初发现 BusinessExecution 浅拆分与 lint 覆盖不足，修复后复验关闭。
- Standards review：独立检查分层、日志、错误安全、测试和 Svelte 行为；发现的 endpoint 可观测性/敏感日志覆盖、滚动竞态、production adapter 漏网和嵌套路径绕过均已修复并定向验证。
- Spec review：独立对照 proposal/design/tasks/delta specs；发现的 server-only router 措辞冲突、无窗口静默跳过、BusinessExecution/RunLifecycle 职责与 controller 生命周期证据均已收敛。

仓库没有 `docs/agents/issue-tracker.md`，因此未执行 issue-tracker 对照；本次 Spec review 以该变更的 OpenSpec proposal/design/tasks/delta specs 为事实来源。

## 已知治理债务

- `openspec/specs/hotel-agent-runtime/spec.md` 当前 605 行，超过仓库“建议约 200 行”的治理建议；这是既有大规格，当前 `openspec/config.yaml` 没有硬性行数规则。本变更只写差量并同步事实，没有借架构重构拆分其 capability。
- `BusinessExecution` 是 1165 行的 deep module；复杂度通过单一高层 seam 隐藏，但后续若出现稳定的第二条独立变化轴，可再按状态机阶段拆私有子模块，不应重新泄漏到 Gateway。
