# 架构文档索引

## 实现范式（写代码前读）

| 文档 | 讲什么 | 状态 |
|---|---|---|
| [Hotel Agent 当前架构图](2026-08-12-hotel-agent-architecture.mmd) | 可直接导入 mermaid.live；覆盖会话、压缩、运行时、工具、持久化与 SSE | ✅ 当前实现 |
| [OTA 标签页异步结果对接范式](2026-08-08-ota-tab-async-result-pattern.md) | UI 发起 → 开标签页 → 用户操作 → 结果回到 UI 的标准形状；加同类流程该改哪些文件 | ✅ 已落地两例 |
| [Electron IPC 背景](2026-08-06-electron-ipc-background.md) | IPC 边界的约束与写法 | ✅ 有效 |
| [浏览器 session partition](2026-08-03-electron-browser-session-partition.md) | partition 命名与登录态隔离 | ✅ 有效 |

**事实来源不在这里**：分层边界看
[`openspec/specs/desktop-main-layering/spec.md`](../../openspec/specs/desktop-main-layering/spec.md)，
本地凭证模型看 [`openspec/specs/local-ota-credentials/spec.md`](../../openspec/specs/local-ota-credentials/spec.md)。
`docs/arch/` 放的是**怎么做**，`openspec/specs/` 放的是**必须满足什么**。

## 早期评审素材（2026-08-03）

保留作背景，**结论多已被后续变更取代，不要照着实现**：

| 文档 | 讲什么 | 状态 |
|---|---|---|
| [术语表与订单来了映射](2026-08-03-glossary-and-orderlaile-mapping.md) | 命名定稿；订单来了字段对照 | ✅ 术语部分仍有效 |
| [Harness 选型与架构评审](2026-08-03-harness-and-architecture-review.md) | 继续用 Codex 但留可替换接缝 | 🟡 背景 |
| [调研遗漏与后端抽象](2026-08-03-research-gaps-and-backend-abstraction.md) | 8 条调研遗漏；Gateway 签名设想 | 🟡 背景，Gateway 实际形状以代码为准 |

前置背景：[`../ORDERLAILE_ARCHITECTURE_REVIEW.md`](../ORDERLAILE_ARCHITECTURE_REVIEW.md)（2026-08-01）

> ⚠️ 早期文档里的 `domain/` + `ports/` 四层结构**已废弃**。2026-08-08 的分层重构改为
> `main/{services,channels,ota-tab,database,gateway,ipc,composition}`，见
> `openspec/changes/restructure-desktop-main-layers/`。

## 已删除的过程稿

以下文档的结论已并入现行 spec 或被实现取代，2026-08-08 删除：

- `2026-08-03-final-architecture.md`、`2026-08-03-current-architecture-change-plan.md`
  —— 四层结构方案，已被分层重构取代
- `2026-08-03-login-tab-flows.md`、`2026-08-05-ota-login-and-hotel-binding-current-state.md`
  —— 登录链路现状，已实现，现状看代码
- `2026-08-06-ota-remote-hotel-binding-design.md` —— 远端绑定设计草案，已由
  `openspec/changes/bind-hotel-flow/` 实现并取代
