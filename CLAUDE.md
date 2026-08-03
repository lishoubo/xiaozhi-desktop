# Claude Code 研发配置

> 本仓库同时维护 `AGENTS.md`（供 Codex 使用）。两份文件规则相同、措辞对齐，只在工具入口一节有差异（本文写 Claude Code 的 skill 与 slash command，`AGENTS.md` 写工具无关的等效说法）。**改动任何一条规则时请同步两处。**

## 依赖

| 依赖 | 层级 | 提供什么 |
|------|------|---------|
| superpowers | 流程层 | brainstorming / writing-plans / executing-plans / TDD / systematic-debugging / verification / code-review |
| OpenSpec | 规范层 | `/opsx:propose` → proposal.md + design.md + tasks.md |

安装方式不在此维护。依赖缺失时**明确告知用户，不要静默降级到自己编的流程**。

## 两层框架

| 层级 | 工具 | 职责 | 产物 |
|------|------|------|------|
| 规范层（蓝图） | OpenSpec | 需求分析、方案确认 | `proposal.md` + `design.md` + `tasks.md` |
| 流程层（大脑） | superpowers | brainstorm → plan → TDD → debug → review → verify | 代码 + 验证证据 |

两层通过**文件**传递信息（`tasks.md` 是规范层交给流程层的唯一输入），不通过共享内存或隐式状态。

浏览器验证、QA、发布、部署没有专用工具，用通用能力完成，并遵守下面的安全护栏。

## 核心原则

1. **规范先行**：中/大任务先调 `/opsx:propose` 产出三份文档，再动手写代码。小任务和只读任务不走（见任务分流）。
2. **流程归 superpowers**：brainstorm、plan、TDD、debug、verify、code-review 全走 superpowers skill，不走同名第三方。
3. **职责分离**：规范层只产文档；流程层只按 `tasks.md` 执行编码流程。
4. **独立 reviewer 通道**：verification 和 code-review 分两个 pass，不能在同一上下文里合并。
5. **证据优先**：没有测试/截图/QA 报告不算完成，没有验证证据不得声称"通过"/"完成"，**禁止虚构命令输出**。
6. **歧义先 brainstorm**：任何创造性工作前先调用 brainstorming skill。
7. **最短路径优先**：能用一个 skill 解决的，不升级为完整闭环。

## 任务分流

### 只读任务
分析、解释、架构说明、代码阅读 —— 直接处理。
真实 bug 排查但尚未修改 —— 用 `systematic-debugging`。

### 小任务
单文件或小范围修改、明确 bug 修复、配置/文案调整、小测试补充。
跳过 OpenSpec / brainstorming / writing-plans / worktrees / 重 review 链。
直接实现 → 定向验证。

### 中任务
多文件但边界清晰，新功能或明确的重构。
`/opsx:propose`（必须首先调用）→ 简短 brainstorming → 实现 → 验证 → verification。

### 大任务
跨模块、共享逻辑、新架构、公共 API 变更。
`/opsx:propose`（必须首先调用）→ brainstorming → writing-plans → executing-plans + worktrees + TDD → verification → code-review → 交付（发布/部署需用户确认）。

## 测试粒度控制

1. **迭代态只跑定向测试**：写代码/改代码期间只运行改动直接命中的测试（单文件或 `-k <name>` / `::test_name` 定位），禁止在此阶段跑全量套件。Python 场景优先 `pytest <touched_test_file>` 或 `pytest -k xxx`，不用裸 `pytest`。
2. **完成态才允许全量，且只跑一次**：声称完成/提交前按任务分级跑一次对应范围（小任务→受影响模块；中/大任务→全量），跑完即止，不在同一完成态里重复全跑。
3. **TDD 用例克制**：每个行为默认 1 个 happy path + 至多 2 个高价值边界，不生成穷举参数矩阵/mock 组合；需要更全覆盖由用户明确提出。
4. **失败重试熔断**：同一测试连续失败约 3 次仍未解决，转 systematic-debugging 定位根因，不再空转重跑。

## 输出目录

**所有 AI 产出的文档一律落在 `docs/` 下，不在仓库根目录新建文档目录。**

```
openspec/                        规范事实来源（OpenSpec 管理，必须在仓库根目录）
├── config.yaml
├── specs/                       已稳定的规范，按能力拆分
│   └── <capability>/spec.md
└── changes/                     进行中的提案
    ├── <change-name>/
    │   ├── proposal.md          为什么做（背景、目标、成功标准）
    │   ├── design.md            怎么做（架构决策、接口、数据流）
    │   ├── tasks.md             任务清单（流程层的唯一输入）
    │   ├── specs/               本次变更的 delta（验收后合并进顶层 specs/）
    │   └── verification.md      验证证据
    └── archive/YYYY-MM-DD-<name>/   已完成并归档

docs/                            规范之外的文档
├── arch/                        架构设计文档
├── research/                    调研材料
└── *.md                         工程规范、README、外部指南
```

**`openspec/` 必须在仓库根目录**，OpenSpec 工具硬编码此路径，不能挪进 `docs/`。

`specs/` 与 `changes/` 的区别只有一条：**`specs/` 是已稳定的事实，`changes/` 是进行中的提案。** 提案先在 `changes/<name>/specs/` 里写差量，验收后才合并进顶层 `specs/`，然后归档。

### 路由规则

用户说"放到 docs 下"时，若内容属于研发类文档，按下表放进对应目录，完成后告知一句原因；非研发类文档尊重原意留在 `docs/` 顶层。

| 文档类型 | 目标位置 |
|---|---|
| 架构/接口/部署等全局事实（已稳定） | `openspec/specs/<capability>/spec.md` |
| 单次需求的 proposal/design/tasks | `openspec/changes/<name>/` |
| 测试计划/QA 报告/验证证据 | 中/大任务：`openspec/changes/<name>/verification.md`；小任务：内联汇报，**不建文件** |
| 架构设计文档、技术方案 | `docs/arch/YYYY-MM-DD-<topic>.md` |
| 调研、竞品分析、选型对比 | `docs/research/<topic>.md` |
| 面向外部消费者的 API 文档、README、用户指南 | `docs/` 顶层，不路由 |
| 临时脚本、中间产物、调试输出 | scratchpad 或 `output/`（gitignore），**不进 `docs/`** |

### 收敛规则

同一主题多轮讨论产出多份过程稿时，**最终必须整合成一份定稿**，过程稿删除或明确标注被取代。不留并列的多个"最终方案"。

### 规范治理

- `openspec/specs/` 按 capability 拆分独立目录，不建 `architecture.md` / `api.md` / `deployment.md` 这类跨切面大文件；单个 `spec.md` 建议 ≤ 200 行，超出按子能力拆分
- 格式/大小约束写进 `openspec/config.yaml` 的 `rules:` 字段（OpenSpec 原生支持），不在本文件里另造规则
- **完成门禁触发标准**：改动是否新增/修改/删除了 ① 跨模块接口 ② 架构（新服务、数据流变化、模块边界变化）③ 部署方式（环境变量、基础设施、发布流程）？任一"是" → 必须同步 `openspec/specs/` 对应 capability（验证通过后 `openspec archive` 或手动合并 delta，只写差量），**不因任务分级小而免检**

## 编程约束

详见 `docs/ENGINEERING_PRINCIPLES.md`（工程原则）、`docs/TESTING_STANDARDS.md`（测试）、`docs/ELECTRON_SECURITY.md`（Electron 安全）。以下是必须遵守的硬约束：

- **核心业务逻辑与框架解耦**：`src/domain/` 零框架依赖，不 import `electron` / `better-sqlite3` / `svelte` / harness SDK / `node:fs`。判定标准 = 验收标准：domain 的测试用裸 vitest 跑，不需要 mock 任何东西
- 依赖方向：`renderer` 只通过 `preload` 访问 `main`；`domain` 不依赖任何一端；只有 composition root 能 import Gateway 实现
- 保持既有行为，不顺手重构、重命名、升级无关代码
- 优先简单显式的写法，不做投机抽象；只有"确定会有第二种实现"才值得抽象
- 错误在有足够上下文的层处理，或保留 cause 向上抛，**不静默吞掉**
- 严格 TypeScript，避免 `any`、非空断言、类型断言；不可避免时说明原因
- 删除废弃代码，不留注释掉的实现

架构定稿见 `docs/arch/2026-08-03-final-architecture.md`。

## 安全护栏

- `rm -rf` / `DROP TABLE` / `force-push` / `git reset --hard` / `kubectl delete` 等破坏性命令，**执行前说明影响范围并取得确认**
- 调试敏感模块时，明确告知哪些文件在修改范围内
- 密钥/凭证/API Key **不得硬编码**
- 数据库访问用参数化查询，不用不可信输入拼接 shell 命令或 SQL

### 高风险操作：绝对禁止自动执行

以下两类操作无论处于何种自动化流程中（subagent、executing-plans、CI 脚本、workflow 均不例外），**必须中断、向用户说明、等待明确授权后才能执行**：

1. **合并到 master / main**
   - 包括：`git merge <branch> master`、`git rebase` 变基到主干、`gh pr merge` 合并 PR 到主干
   - 执行前必须：列出将合并的提交摘要 → 等待用户回复"确认"

2. **远端部署 / 发布**
   - 包括：`kubectl apply`、`docker push`、`helm upgrade`、云平台 deploy 命令、推送生产配置、release / publish
   - 执行前必须：描述目标环境、操作内容、影响范围 → 等待用户回复"确认"

## Subagent 策略

**一定派子代理：**
- 用户明说"并行 / parallel / dispatch"
- 2-4 个边界清晰、独立验证、无共享状态的子任务
- 纯只读的多目标研究

**一定不派：**
- 任务有顺序依赖
- 多个子任务改同一文件 / contract / shared types
- `package.json` / lockfile / 根配置 / CI / schema / 总入口 默认串行
- 单一目标的 bug 修复
- 根因未明的调试

## 完成门禁

声明完成 / commit / push / PR 之前必须满足：

1. 相关验证已完成并**如实报告结果**
2. 通过对应质量门禁（review / verification）
3. 关键验证无法执行时**明确说明原因**
4. **禁止虚构命令输出**
5. 没有验证证据，不得声称"通过"/"完成"
6. 改动触及跨模块接口/架构/部署时，已同步更新 `openspec/specs/` 对应文件

## 职责边界

**只走 OpenSpec：**
需求分析、proposal / design / tasks 文档编写、规范评审、技术方案确认。`tasks.md` 是 superpowers 的唯一输入。

**只走 superpowers：**
brainstorming / writing-plans / executing-plans、TDD、systematic-debugging、verification、code-review、subagent、worktrees、分支收尾。
