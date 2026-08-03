# 架构评审文档索引

2026-08-03 一轮评审的产出。

> 📌 **只读一份就读 [最终架构方案](2026-08-03-final-architecture.md)** —— 它整合了目录结构、框架剥离方案、核心领域模型、执行顺序。下面 4 份是它的推导过程与素材。

| # | 文档 | 讲什么 | 状态 |
|---|---|---|---|
| **0** | [**最终架构方案**](2026-08-03-final-architecture.md) | **四层结构（domain/main/preload/renderer）、框架剥离、核心模型、6 步执行** | ✅ **定稿，以此为准** |
| 1 | [术语表与订单来了映射](2026-08-03-glossary-and-orderlaile-mapping.md) | 命名定稿；订单来了字段对照 | ✅ 定稿，仍有效 |
| 2 | [Harness 选型与架构评审](2026-08-03-harness-and-architecture-review.md) | 继续用 Codex 但留可替换接缝；三层账号体系实测 | ✅ 定稿，仍有效 |
| 3 | [调研遗漏与后端抽象](2026-08-03-research-gaps-and-backend-abstraction.md) | 8 条调研遗漏；5 个 Gateway 的完整签名 | ✅ 定稿，仍有效 |
| 4 | [架构调整方案](2026-08-03-current-architecture-change-plan.md) | 升级/Codex/存储三大议题的详细论证 | ✅ 定稿，文档 0 引用其结论 |

> 🗑️ 已删除：`2026-08-03-top-level-layout.md`、`2026-08-03-target-directory-structure.md`、`2026-08-03-STATUS.md` —— 结论已全部并入文档 0（含逐文件改造清单），不再保留过程稿。

前置背景：[`../ORDERLAILE_ARCHITECTURE_REVIEW.md`](../ORDERLAILE_ARCHITECTURE_REVIEW.md)（2026-08-01，P0/P1/P2 问题清单）

---

## 本轮整合定下的三件事

**① 顶层 = 方案 A**，`src/` 留在根目录，新增 `resources/{skills,channels,runtime,icons}` + `scripts/ dist/ output/`。方案 B（`app/` 分层）搁置。

**② 核心业务剥离框架** —— 新增 `src/domain/`（原计划的 `shared/domain/` 提升为顶层）：

```text
domain/           零框架依赖：不 import electron / better-sqlite3 / svelte / codex
  policy/         纯决策逻辑（导航策略、RiskLevel、登录态判定、三段式状态机）
  ports/          5 个 Gateway + AgentRuntime + BrowserPort + Repositories
main/             Electron 侧实现（adapters）
shared/           只放 IPC 契约与 view-model
```

判定标准 = 验收标准：**`domain/` 的测试用裸 vitest 跑，不需要 mock 任何东西。**
用 eslint `no-restricted-imports` + `import/no-restricted-paths` 焊死（**语法未实测，第 1 步先验证**）。

**③ 核心模型**（将来补不回来的）：`ChannelManifest`、`LoginState` 三元组、`ChannelObservation` + `DataQuality`、`InventoryImpact`、`ProposedAction` 三段式、5 个 `SCHEMA_VERSIONS`。

详见文档 0 第三、四部分。

---

## 仍然未决

1. 🔴 **MCP server 形态** —— `RunAsNode: false` 禁用了 `ELECTRON_RUN_AS_NODE`，需在关 fuse / 进程内 MCP / 打包独立 Node 三者中选一。第 6 步前必须定
2. 🟡 **rms 后端术语未对齐** —— 未读 `xiaozhi-rms-workspace` 接口定义，会影响 Gateway 签名
3. 🟡 **一个 OTA 账号挂多店时如何定位当前门店** —— 取决于目标客户是单体还是连锁
4. 🟢 **`workspace` 的确切含义** —— 留白

---

## 下一步

```text
第 0 步  ctrip automation 改 opt-in（1 行）★ 当前唯一有实际安全风险的项
准备     建 resources/ scripts/ dist/ output/；删 vite.preload.config.ts；移 DESIGN.md
第 1 步  建 domain/ + ports/ + policy/，配 eslint 规则，跑 tsc 看报错地图
第 2-6 步 见文档 0 第五部分
```

---

## 验证边界

所有文档均为**静态审查 + 设计**，**未修改任何代码，未运行构建/测试**。

已实测：订单来了（`app.asar` 51616 条路径、`config.toml`、`workspace-state.prod.json`、`Partitions/` 15 个目录、三个 sqlite schema）、Cherry Studio（GitHub API 目录树，未读源码）、rms（两级目录树）、本仓库（`src/` 全量 119 个文件、根目录全部配置）。

**未验证的关键项**：eslint 两条规则的配置语法（整个 domain 剥离依赖它）、`RunAsNode` fuse 冲突、`resources/` 的 Forge 打包写法、所有代码片段均未编译。
