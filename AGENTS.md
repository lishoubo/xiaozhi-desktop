# 研发工作流规范

> 本文件供 Codex 使用（Codex 固定读取项目根目录的 `AGENTS.md`，文件名不可改）。
> 同一套规则同时维护在 `CLAUDE.md`（供 Claude Code 使用）。两份文件规则相同、措辞对齐，只在工具入口一节有差异（本文用工具无关的说法，`CLAUDE.md` 写 Claude Code 的 skill 与 slash command）。**改动任何一条规则时请同步两处。**

## 仓库上下文

| 路径 | 职责 |
|---|---|
| `apps/desktop/` | Electron 桌面应用 |
| `apps/server/` | 桌面应用的 backend API，以及桌面业务数据管理后台 |
| ↳ PostgreSQL | 本系统主数据库，用于管理本系统数据 |
| ↳ MySQL | RMS 系统数据库，仅以只读方式获取业务数据 |
| `packages/api/` | desktop 与 server 共享的 tRPC contract、schema 和纯类型；不放任一应用的实现细节 |

- 跨端接口先定义共享 contract，再分别实现 server procedure 和 desktop client；不得让 desktop 直接依赖 server 实现。
- 设计 desktop UI 时以当前任务为中心，控制信息密度，优先渐进披露，避免把辅助信息长期堆在主界面。
- 设计 server 管理后台时从管理人员的业务任务出发，优先可检索、可比较、可追踪和可恢复，不照搬 desktop 布局。
- 全仓 UI 原则只维护在根目录 `DESIGN.md`；子项目不复制该文件，有确实独立的规则时写入对应目录的 `AGENTS.md`。

### 根目录治理

根目录只保留全仓入口和事实来源：`AGENTS.md`、`CLAUDE.md`、`DESIGN.md`、根 `package.json` / lockfile、共享工具配置、`openspec/` 与 `docs/`。应用专属配置和说明留在对应 workspace；不要在根目录或多个应用中维护重复文档。

## 依赖

| 依赖 | 层级 | 提供什么 |
|------|------|---------|
| OpenSpec（或等效规范流程） | 规范层 | proposal.md + design.md + tasks.md |
| superpowers（或等效流程） | 流程层 | brainstorm / plan / TDD / debug / review / verify |

安装方式不在此维护。依赖缺失时**明确告知用户，不要静默降级到自己编的流程**。

### 本地 HTTPS 证书

- 本地开发、server E2E 或 server Docker Compose 启动前，先执行根目录 `npm run https:setup`；相关 npm 入口已配置 pre-script，Agent 不得绕过这些入口直接启动 Vite 或 compose。
- 首次执行会通过 mkcert 安装宿主机本地 CA，可能要求用户完成一次系统授权；不得以关闭证书校验替代安装。后续执行负责检查并在服务证书剩余 30 天内自动续签。
- Docker 只读挂载宿主机签发的 `.cert/` 运行时证书，不在容器内创建独立 CA；`.cert/`、CA 私钥和服务私钥不得提交或分享。

## 两层框架

| 层级 | 职责 | 产物 |
|------|------|------|
| 规范层（蓝图） | 需求分析、方案确认 | `proposal.md` + `design.md` + `tasks.md` |
| 流程层（大脑） | brainstorm → plan → TDD → debug → review → verify | 代码 + 验证证据 |

两层通过**文件**传递信息（`tasks.md` 是规范层交给流程层的唯一输入），不通过共享内存或隐式状态。

浏览器验证、QA、发布、部署没有专用工具，用通用能力完成，并遵守下面的安全护栏。

## 核心原则

1. **规范先行**：中/大任务先产出 `proposal.md` + `design.md` + `tasks.md`，再动手写代码。小任务和只读任务不走（见任务分流）。
2. **职责分离**：规范层只产文档；流程层只按 `tasks.md` 执行编码流程。
3. **独立 reviewer 通道**：verification 和 code-review 分两个独立 pass，不能在同一上下文里合并。
4. **证据优先**：没有测试/截图/QA 报告不算完成，没有验证证据不得声称"通过"/"完成"，**禁止虚构命令输出**。
5. **歧义先 brainstorm**：任何创造性工作前，先探索用户意图、澄清需求，再动手。
6. **最短路径优先**：能简单解决的，不升级为完整闭环流程。
7. **依赖最佳实践**：开发时先识别本次涉及的依赖库，优先读取项目当前版本对应的官方文档、项目内技能或本地依赖指南，并按该版本的最佳实践实现；不得仅凭记忆套用其他版本的用法。

## 任务分流

### 只读任务
分析、解释、架构说明、代码阅读 —— 直接处理。
真实 bug 排查但尚未修改 —— 先系统性分析根因，再动手。

### 小任务
单文件或小范围修改、明确 bug 修复、配置/文案调整、小测试补充。
跳过规范流程 / brainstorm / 计划 / 重 review 链。
直接实现 → 定向验证。

### 中任务
多文件但边界清晰，新功能或明确的重构。
先产出规范三件套（必须首先）→ 简短 brainstorm → 实现 → 验证 → verification。

### 大任务
跨模块、共享逻辑、新架构、公共 API 变更。
规范三件套（必须首先）→ brainstorm → 制定计划 → 执行（含 TDD）→ verification → code-review → 交付（发布/部署需用户确认）。

## 测试粒度控制

1. **迭代态只跑定向测试**：写代码/改代码期间只运行改动直接命中的测试（单文件或按用例名定位），禁止在此阶段跑全量套件。Python 场景优先 `pytest <touched_test_file>` 或 `pytest -k xxx`，不用裸 `pytest`。
2. **完成态才允许全量，且只跑一次**：声称完成/提交前按任务分级跑一次对应范围（小任务→受影响模块；中/大任务→全量），跑完即止，不在同一完成态里重复全跑。
3. **TDD 用例克制**：每个行为默认 1 个 happy path + 至多 2 个高价值边界，不生成穷举参数矩阵/mock 组合；需要更全覆盖由用户明确提出。
4. **失败重试熔断**：同一测试连续失败约 3 次仍未解决，停下来做系统性根因分析，不再空转重跑。

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
| 临时脚本、中间产物、调试输出 | 临时目录或 `output/`（gitignore），**不进 `docs/`** |

### 收敛规则

同一主题多轮讨论产出多份过程稿时，**最终必须整合成一份定稿**，过程稿删除或明确标注被取代。不留并列的多个"最终方案"。

### 规范治理

- `openspec/specs/` 按 capability 拆分独立目录，不建 `architecture.md` / `api.md` / `deployment.md` 这类跨切面大文件；单个 `spec.md` 建议 ≤ 200 行，超出按子能力拆分
- 格式/大小约束写进 `openspec/config.yaml` 的 `rules:` 字段（OpenSpec 原生支持），不在本文件里另造规则
- **完成门禁触发标准**：改动是否新增/修改/删除了 ① 跨模块接口 ② 架构（新服务、数据流变化、模块边界变化）③ 部署方式（环境变量、基础设施、发布流程）？任一"是" → 必须同步 `openspec/specs/` 对应 capability（验证通过后 archive 或手动合并 delta，只写差量），**不因任务分级小而免检**

## 编程约束

测试细则见 `docs/TESTING_STANDARDS.md`。通用工程与 Electron 安全必须遵守以下硬约束：

- **分层边界由 eslint 强制**，不靠约定（见 `apps/desktop/.eslintrc.json`）：
  - `shared/`（跨进程契约与纯类型）与 `main/ids.ts`（标识符校验）零框架依赖，且 `shared` 不得依赖 `main`
  - `main/ipc/` 只做边界：信任校验 → 参数校验 → 调**恰好一个** service → 错误转换；不得 import `electron`（`ipcMain` 收在 `create-handler-registry.ts`）、不得直连仓储与基础设施
  - `main/services/` 是业务编排，不得直接开 tab —— OTA 标签页的唯一开口是 `main/ota-tab/`
  - `main/channels/` 是被注入的渠道适配器，不得反向依赖 `services`/`ipc`/`composition`
  - `renderer` 只通过 `preload` 访问 `main`
- 只有 composition root（`main/composition/`）能 import 实现类；其余各层依赖窄接口
- `main/index.ts` 是进程入口，不含任何业务对象 `new`
- 保持既有行为，不顺手重构、重命名、升级无关代码
- 优先简单显式的写法，不做投机抽象；只有"确定会有第二种实现"才值得抽象
- 错误在有足够上下文的层处理，或保留 cause 向上抛，**不静默吞掉**
- 客户端和服务端都必须在关键业务节点（开始、边界调用、状态变化、完成、失败）打印结构化日志；携带关联 ID 与耗时，禁止记录密钥、凭证、用户正文、业务结果及高频流式分片
- 严格 TypeScript，避免 `any`、非空断言、类型断言；不可避免时说明原因
- 删除废弃代码，不留注释掉的实现

desktop 主进程分层定稿见 `openspec/specs/desktop-main-layering/spec.md`。

## 安全护栏

- `rm -rf` / `DROP TABLE` / `force-push` / `git reset --hard` / `kubectl delete` 等破坏性命令，**执行前说明影响范围并取得确认**
- 调试敏感模块时，明确告知哪些文件在修改范围内
- 密钥/凭证/API Key **不得硬编码**
- 数据库访问用参数化查询，不用不可信输入拼接 shell 命令或 SQL

### 高风险操作：绝对禁止自动执行

以下两类操作无论处于何种自动化流程中（子代理、执行计划、CI 脚本均不例外），**必须中断、向用户说明、等待明确授权后才能执行**：

1. **合并到 master / main**
   - 包括：`git merge <branch> master`、`git rebase` 变基到主干、`gh pr merge` 合并 PR 到主干
   - 执行前必须：列出将合并的提交摘要 → 等待用户回复"确认"

2. **远端部署 / 发布**
   - 包括：`kubectl apply`、`docker push`、`helm upgrade`、云平台 deploy 命令、推送生产配置、release / publish
   - 执行前必须：描述目标环境、操作内容、影响范围 → 等待用户回复"确认"

## 并行策略

**适合并行：**
- 用户明说"并行"
- 2-4 个边界清晰、独立验证、无共享状态的子任务
- 纯只读的多目标研究

**必须串行：**
- 任务有顺序依赖
- 多个子任务改同一文件 / contract / 共享类型
- `package.json` / lockfile / 根配置 / CI / schema / 总入口
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

**只走规范层：**
需求分析、proposal / design / tasks 文档编写、规范评审、技术方案确认。`tasks.md` 是流程层的唯一输入。

**只走流程层：**
brainstorm、制定计划、执行计划、TDD、debugging、verification、code-review、子代理、分支收尾。
