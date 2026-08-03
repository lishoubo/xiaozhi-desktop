# 研发工作流规范

> 本文件供 Codex 使用（Codex 固定读取项目根目录的 AGENTS.md，文件名不可改）。
> 同一套规则同时维护在 CLAUDE.md（供 Claude Code 使用）和 GEMINI.md（供 Gemini CLI 使用），三者内容存在重叠，手工维护，改动一条规则时请逐一同步三处。

## 三层框架

| 层级 | 工具 | 职责 |
|------|------|------|
| 规范层（蓝图） | OpenSpec | 需求分析 → proposal.md + design.md + tasks.md |
| 流程层（大脑） | superpowers / 等效流程 | brainstorm → plan → TDD → debug → review → verify |
| 执行层（手脚） | gstack / 等效工具 | 浏览器 / QA / ship / deploy / canary / 护栏 |

## 核心原则

1. **规范先行**：任何新需求或较大改动，必须先产出 proposal.md + design.md + tasks.md，再动手写代码。
2. **职责分离**：规范层只产文档；流程层只按 tasks.md 执行编码流程；执行层只做验证和交付。三者通过文件传递信息。
3. **独立 reviewer 通道**：verification 和 code-review 分两个独立 pass，不能在同一上下文里合并。
4. **证据优先**：没有测试 / 截图 / QA 报告不算完成；没有验证证据不得声称"通过"或"完成"；禁止虚构命令输出。
5. **歧义先 brainstorm**：任何创造性工作前，先探索用户意图、澄清需求，再动手。
6. **最短路径优先**：能简单解决的，不升级为完整闭环流程。

## 任务分流

### 只读任务
分析、解释、架构说明、代码阅读 —— 直接处理。
真实 bug 排查但尚未修改 —— 先系统性分析根因，再动手。

### 小任务
单文件或小范围修改、明确 bug 修复、配置/文案调整、小测试补充。
跳过完整 brainstorm / 计划 / 重 review 链。
直接实现 → 定向验证 → 必要时在浏览器确认效果。

### 中任务
多文件但边界清晰，新功能或明确的重构。
先走 OpenSpec 产出规范文档 → 简短 brainstorm → 实现 → 浏览器或 QA 验证 → verification。

### 大任务
跨模块、共享逻辑、新架构、公共 API 变更。
OpenSpec 规范 → brainstorm → 制定计划 → 执行（含 TDD）→ QA → verification → code-review → 发布 → 部署 → 灰度。

## 测试粒度控制

1. **迭代态只跑定向测试**：写代码/改代码期间只运行改动直接命中的测试（单文件或按用例名定位），禁止在此阶段跑全量套件。Python 场景优先 `pytest <touched_test_file>` 或 `pytest -k xxx`，不用裸 `pytest`。
2. **完成态才允许全量，且只跑一次**：声称完成/提交前按任务分级跑一次对应范围（小任务→受影响模块；中/大任务→全量），跑完即止，不在同一完成态里重复全跑。
3. **TDD 用例克制**：每个行为默认 1 个 happy path + 至多 2 个高价值边界，不生成穷举参数矩阵/mock 组合；需要更全覆盖由用户明确提出。
4. **失败重试熔断**：同一测试连续失败约 3 次仍未解决，停下来做系统性根因分析，不再空转重跑。

## OpenSpec 规范结构

```
openspec/
  specs/     # 当前系统事实来源（已稳定的规范）
  changes/   # 每次变更提案（进行中）
    <change-name>/
      proposal.md   # 为什么做（背景、目标、成功标准）
      design.md     # 怎么做（架构决策、接口、数据流）
      tasks.md      # 具体任务清单（流程层的输入）
```

**规范与执行的衔接：**
1. 需求输入 → OpenSpec 产出 tasks.md
2. tasks.md 作为流程层的输入，启动 brainstorm
3. 执行中发现规范遗漏或错误 → 回退更新 design.md / tasks.md，再继续执行

**全局架构/接口/部署治理：**
- `specs/` 按 capability 拆分独立 spec.md，不建 architecture.md / api.md / deployment.md 这类跨切面大文件；单文件建议 ≤ 200 行，超出按子能力拆分
- 格式/大小约束写进 `openspec/config.yaml` 的 `rules:` 字段（OpenSpec 原生支持），不在本文件里另造规则
- **完成门禁触发标准**：改动是否新增/修改/删除了 ① 跨模块接口 ② 架构（新服务、数据流变化、模块边界变化）③ 部署方式（环境变量、基础设施、发布流程）？任一"是" → 必须同步 `specs/` 对应 capability 文件（验证通过后 archive 或手动合并 delta，只写差量），不因任务分级小而免检

## 文档路由规则

用户说"放到 docs 下"时，若判断内容属于研发类文档，自动改放规范目录，完成后告知一句原因；非研发类文档尊重原意留在 `docs/`。

| 文档类型 | 目标位置 |
|---|---|
| 架构/接口/部署等全局事实 | `openspec/specs/<capability>/spec.md` |
| 单次需求的 proposal/design/tasks | `openspec/changes/<name>/` |
| 未关联 openspec change 的技术方案 | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` |
| 测试计划/QA报告/验证证据 | 中/大任务：`openspec/changes/<name>/verification.md`；小任务：内联汇报，不建文件 |
| 面向外部消费者的 API 文档、README、用户指南等 | 留在 `docs/`，不路由 |

## 安全原则

- 破坏性操作（删除文件/数据库/分支、强制推送、重置）必须用户明确确认，执行前说明影响范围
- **分支合并到 master / main 绝对禁止自动执行**：无论流程处于哪个阶段，`git merge`、`git rebase` 合并到 master/main，或合并 PR 到主干，都必须暂停并等待用户明确授权，不得在任何自动化步骤中静默执行
- **远端部署绝对禁止自动执行**：deploy / release / publish / 推送镜像 / 更新生产配置等任何影响远端环境的操作，必须暂停并等待用户明确授权，描述操作内容和影响范围后方可执行
- 调试敏感模块时，明确告知哪些文件在修改范围内
- 密钥 / 凭证 / API Key 不得硬编码
- 数据库访问用参数化查询，不用不可信输入拼接 shell 命令或 SQL

## Subagent / 并行策略

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
1. 相关验证已完成并如实报告结果
2. 通过对应质量门禁（review / verification）
3. 关键验证无法执行时明确说明原因
4. 禁止虚构命令输出
5. 没有验证证据，不得声称"通过"/"完成"
6. 改动触及跨模块接口/架构/部署时，已同步更新 `openspec/specs/` 对应文件

## 职责边界速查

**只走规范层（OpenSpec）：**
需求分析、proposal / design / tasks 文档编写、规范评审、技术方案确认。tasks.md 是流程层的唯一输入。

**只走流程层：**
brainstorm、制定计划、执行计划、TDD、debugging、verification、code-review、分支收尾。

**只走执行层：**
浏览器操作、QA 测试、发布、部署、灰度、复盘、安全审计、危险操作确认。
