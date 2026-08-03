# Harness 选型与架构评审

评审日期：2026-08-03
评审范围：① AI harness 选型与可替换性 ② 订单来了账号体系/workspace/AI 框架的可借鉴与可优化点 ③ 当前架构的调整建议

> **术语以 `2026-08-03-glossary-and-orderlaile-mapping.md` 为准。** 本文中出现的「订单来了」原始字段名（`workspaceId` / `accountId` / `ntwIdNew` 等）是**观察记录，保持原样**，不要搬进我们的代码——对照关系见术语表 §2。
> 本文部分建议已在后续讨论中被修订或否决，相应位置已标注决议。

## 0. 本次评审的新增事实

以下为本次直接从本地安装包和运行态观察到的、此前调研文档未记录或记录不准确的事实。

### 0.1 订单来了的 Codex 是"壳自研 + 模型自控"

`~/.smartorder/config.toml`：

```toml
model = "gpt-5.5"
model_provider = "app_profile"

[model_providers.app_profile]
base_url = "https://www.dingdandao.com/chain/common/v1/public"
wire_api = "responses"
requires_openai_auth = false
env_key = "CODEX_API_KEY"
```

关键点：**它没有直连 OpenAI**。Codex 只是本地 agent loop，模型请求全部打到订单来了自己的网关，走 Responses API 线协议。这意味着：

- 用户不需要 OpenAI 账号，计费和配额在订单来了侧。
- 换模型（换成国产模型、换成 Claude）只需要网关侧适配 Responses 协议，**客户端零改动**。
- 它对 Codex 的依赖 = 依赖一个"本地 agent runtime + MCP 客户端 + skill/plugin 装载器"，**不是依赖 OpenAI 模型**。

这个事实极大改变了"要不要换 harness"的判断——见第 1 节。

### 0.1b 账号体系是三层，不是两层（重要）

本次实测确认，订单来了有**三个独立的身份层**，物理存储完全分离：

| 层 | 存储位置 | 实测内容 | 权威方 |
|---|---|---|---|
| **① 设备身份** | `ddlldesk/device-auth.prod.json` | `clientId: "mac-arm64-8058b48f-…"`、`deviceId: "MHNTHk8zbx"` | 本地生成，云端登记 |
| **② App 账号** | `ddlldesk/global-store.json` → `loginData` | `status: "logged_in"`、`token`、`userId: "9231289"`、`phone`、`source: "register"`、`updatedAt` | 订单来了云端 |
| **③ OTA 渠道账号** | `ddlldesk/workspace-state.prod.json` + `Partitions/` | 每渠道 `accountId` + 独立 Chromium partition + `loginState` 三元组 | OTA 平台（Cookie 在 partition 里） |

三层是**正交**的：

```text
device (clientId/deviceId)      ← 设备维度，用于登记/远控/风控
   └── app user (userId 9231289) ← 业务身份，PMS 数据权限来源
         ├── ota account: ctrip-account-1     (partition A)
         ├── ota account: meituan-account-1   (partition B)
         └── ota account: ...共 15 个
```

**关键点：App 账号的 token 完全不进 partition。** `global-store.json` 是 app 级 JSON，OTA Cookie 在 `Partitions/ddlldesk:prod:<channel>:<accountId>/` 里。两者物理隔离——OTA 页面的 JS 无论如何都碰不到 app token。这是我们必须照抄的边界。

#### App 账号如何绑定到 AI 会话

`ai-workbench-session-owners.json`：

```json
{"version":1,"orphanMigrationDone":true,
 "owners":{"019fb2b5-0226-7c60-9fc5-83bb296f46a7":"9231289"}}
```

这是 **Codex threadId → app userId** 的归属表，`orphanMigrationDone` 说明它处理过"历史会话没有 owner"的迁移。作用：切换 app 账号时，AI 会话不会串到另一个用户。**Codex 自己不知道 app 账号存在**，归属关系由订单来了在外层维护——这正是我在 2.3 建议的 `SessionStore` 双写模式，它已经在做了（虽然只做了 owner 映射这一个字段）。

`state_5.sqlite` 的 `remote_control_enrollments` 表也有 `account_id` 字段，说明远程控制/云端接管也是按 app 账号登记的。

#### 两层账号如何各自流入 AI

从实测 rollout（`sessions/2026/07/30/rollout-…jsonl`）看得很清楚。用户问"查询当前门店当月所有未结清订单"，agent 的动作是：

```json
{"type":"function_call","name":"so_cli","namespace":"mcp__so_agents",
 "arguments":"{\"query\":\"查询当前门店 2026-07-01 至 2026-07-31 所有未结清订单…\"}"}
```

返回：

```text
token 返回鉴权失败（code="7"）。按照规则，需要提示用户重新登录。
```

三个可直接抄的设计：

1. **agent 传的是自然语言 query，没有传任何 token、userId、门店 ID。** "当前门店"由云端 `so_cli` 根据 bearer token 自己解析。**上下文不下发给模型**，模型也就无从伪造或串店。这比"context-first 工具"更进一步——是 *context-never-leaves-server*。
2. **app 账号鉴权失败的处理路径是"提示用户重新登录"，不是让 agent 重试或找别的路子。** 身份失效必须冒泡到人，agent 无权自救。
3. **`so-agents` 用 `bearer_token_env_var = "DDLL_SO_AGENTS_MCP_BEARER_TOKEN"`** —— app token 通过环境变量注入 MCP 连接，不写进 config.toml，不进 prompt，不落 rollout 日志。

对照 `session_meta`：`originator: "ddlldesk_ai_workbench"`、`model_provider: "app_profile"`、`cwd: /Users/lishoubo/Documents/DDLL/2026-07-30/new-chat`（每个会话一个工作目录，沙箱边界）。整条链路里**没有任何一处出现 app token 或 OTA Cookie**。

#### 两类账号的职责切分

| | App 账号（②） | OTA 账号（③） |
|---|---|---|
| 认证方 | 订单来了云端（手机号+验证码） | OTA 平台（用户自己登录页面） |
| 凭证形态 | bearer token（JSON 文件） | Cookie/Storage（Chromium partition） |
| 凭证生命周期 | 云端可主动失效 | 随 OTA 平台，我们只能观测 |
| 决定什么 | **数据权限**：能看哪些门店、哪些订单 | **操作能力**：能操作哪个渠道后台 |
| 给 AI 的方式 | env var → 远程 MCP（`so_cli`）云端解析 | 不给 token，只给 `browser_*` 工具操作已登录页面 |
| 失效表现 | `code=7` → 提示重新登录 | `loginState: logged_out` → 引导去渠道页登录 |
| 数量 | 1 个（当前登录用户） | N 个（每渠道至少 1） |

一句话概括：**App 账号是"你是谁、你能看什么"，OTA 账号是"你能代表谁去哪个平台干活"。前者是数据权威，后者是执行能力。**

#### 我们要改的地方

订单来了这套三层做得对，但有两个缺口：

1. **App 账号和 OTA 账号之间没有绑定关系。** `workspace-state` 里的 OTA 账号是全局的，不隶属于任何 app userId。切换 app 账号后，OTA 登录态还在那儿——多人共用一台电脑时，A 登录后能直接用 B 留下的携程登录态。

   > **决议（2026-08-03）**：**不做绑定**。两套账号的认证方、凭证形态、生命周期都不同步，硬绑会处处是特例（app 登出要不要清 OTA？OTA 掉线要不要影响 app？）。共用设备的问题用「app 退出时可选清理 OTA 登录态」的 UI 分支解决，不进数据模型。
   > 同时**不引入 tenant 层**、浏览器上下文命名不预留租户段——需要分组时加一层 mapping 表。理由：在标识符里编码结构信息，等于把 schema 迁移问题伪装成字符串格式问题；而命名一旦发出去就固化在用户磁盘上，改名会导致全渠道掉线。

2. **没有"这个 OTA 账号对应哪家门店"的显式绑定。** `channelHotelName` 是从页面抓回来的回显，属于事后确认。

   > **实测补充**：我观察时 15 个账号该字段全为空，但**这是因为当时全部未登录**（`loginState: logged_out`），不能据此推断它设计上有缺口。它到底只做回显还是真的在工具执行前做门店校验，**未验证**。
   > **待决**：一个 OTA 账号挂多家店时如何定位当前门店，取决于目标客户是单体还是连锁。单体酒店场景可跳过。

### 0.2 workspace 的真实语义比调研文档描述的更"扁"

`~/Library/Application Support/ddlldesk/workspace-state.prod.json` 与 Partitions 目录实测：

```text
Partitions/ddlldesk%3Aprod%3Actrip%3Actrip-account-1
Partitions/ddlldesk%3Aprod%3Ameituan%3Ameituan-account-1
Partitions/ddlldesk%3Aprod%3Apms%3Apms-default
...共 15 个
```

```json
{
  "lastActiveChannelWorkspaceId": "ctrip",
  "workspaces": {
    "pms":   { "activeAccountId": "pms-default",   "accounts": [...] },
    "ctrip": { "activeAccountId": "ctrip-account-1", "accounts": [...] }
  }
}
```

**`workspaceId` 就是渠道 ID**（ctrip / meituan / tujia / pms / xiaohongshupro …），不是租户、不是门店。字段名甚至直接叫 `lastActiveChannelWorkspaceId`。partition 命名是 `ddlldesk:<env>:<channel>:<accountId>`。

这与 `docs/ORDERLAILE_ARCHITECTURE_REVIEW.md` 里"workspaceId 是渠道/PMS 能力空间"的描述一致，但和"workspace = 多租户空间"的直觉不同。**注意 PMS 自己也是一个 workspace**——门店/租户上下文不在这一层，而在 PMS workspace 内部由云端账号决定。

account 节点的完整形状：

```json
{
  "id": "ctrip-account-1",
  "name": "携程",
  "activeTabId": "...",
  "tabs": [{ "id", "isPrimary", "openerTabId", "title", "url",
             "initialUrl", "allowAnyUrl", "titleLocked" }],
  "isMuted": false,
  "channelHotelName": "",
  "channelUserLogin": "",
  "channelState": {},
  "loginState": "unknown",
  "loginStateUpdatedAt": "",
  "loginStateSource": ""
}
```

值得注意的设计细节：

- `allowAnyUrl` 是 **per-tab** 的导航策略开关——默认 false（只能在渠道 manifest 内导航），个别 tab 才放开。这是一个比"全局 allowlist"更细的粒度。
- `loginState` + `loginStateSource` + `loginStateUpdatedAt` 三元组——登录态不仅记状态，还记**判断来源**和**时间**，可审计、可解释。
- `openerTabId` 保留弹窗父子关系，`isPrimary` 标记渠道主页签。
- `channelHotelName` / `channelUserLogin` 是**从渠道页面反查出来的身份回显**，用于让用户确认"我现在操作的是哪个账号哪个店"。

### 0.3 Codex runtime 的持久化结构

`~/.smartorder/` 下：

```text
state_5.sqlite     threads / agent_jobs / agent_job_items /
                   thread_spawn_edges / thread_dynamic_tools /
                   remote_control_enrollments
memories_1.sqlite  jobs / stage1_outputs
goals_1.sqlite     thread_goals
sessions/          rollout JSONL
skills/            browser-guide / image-generation / pdf / video-generation
codex-marketplaces/ddll-skill-market/prod/current
plugins/
logs/ logs_2.sqlite
```

`threads` 表字段包含 `sandbox_policy` / `approval_mode` / `model_provider` / `agent_nickname` / `agent_role` / `memory_mode` / `reasoning_effort` / `thread_spawn_edges`（子 agent 派生关系）。

这是 **Codex 原生的 schema，不是订单来了自研**。也就是说订单来了把 thread 持久化、memory、goal、多 agent 派生这些全部外包给了 Codex runtime，自己不维护会话状态。这是它能快速上线的原因，也是它最大的锁定点。

### 0.4 三个 MCP server 的边界

```toml
[mcp_servers.browser]           # 本地，Electron 自己以 ELECTRON_RUN_AS_NODE 启动
  command = ".../订单来了"
  args    = [".../app.asar/src/main/services/smart-order/browser-mcp-server.js"]
  env.SMART_ORDER_BRIDGE_SOCKET = "~/.smartorder/bridge.sock"
  tool_timeout_sec = 3600
  default_tools_approval_mode = "approve"

[mcp_servers.app-capabilities]  # 同上，timeout 360
[mcp_servers.so-agents]         # 远程 HTTPS MCP，bearer_token_env_var
  url = "https://so-agents.dingdanll.com/mcp/so-cli"
  enabled_tools = ["so_cli"]
```

值得学的：**MCP server 进程本身不持有任何权限**。它只是个协议翻译器，通过 `bridge.sock` 把调用转发回 Electron 主进程执行。所以即使 Codex 被 prompt injection 攻破，它拿到的也只是 bridge 上的受控工具集，不是 `webContents` 句柄。

另外注意 `so-agents` 是**远程** MCP——业务能力（so_cli）放云端，浏览器能力放本地。这个切分很关键：云端能力可以热更新、可以收敛权限、可以审计；本地只保留必须贴着浏览器做的事。

### 0.5 skill 的写法：约束优先于能力

`smart-order-skills/browser-guide/SKILL.md` 全文只有 ~15 行，核心是：

```markdown
**仅当用户明确要求用页面操作**（如「就在当前页改」「不要用 CLI」）时，
可用 browser_click / browser_type 在内嵌 PMS 页完成；
操作前简要说明页面方式更慢、易因 UI 变化失败，并确认影响范围后再执行。

## 操作流程
1. browser_snapshot 获取快照
2. 根据快照中的 ref 定位元素
3. browser_click / browser_type 执行
4. 再次 browser_snapshot 确认结果
```

这条 skill 的主要作用**不是教 agent 怎么点页面，而是劝阻 agent 点页面**——优先走 CLI/API，页面操作是兜底。这是一个非常成熟的产品判断：RPA 是补洞手段，不是主链路。我们抄架构的时候要把这条价值观一起抄过来。

---

## 1. Harness 选型评估

### 1.1 先纠正一个前提

你的担心是"订单来了用的是 codex，我担心我们后面可能会换"。但从 0.1 的发现看，**订单来了自己已经把"换模型"这件事解耦掉了**——它换模型不用动客户端。它真正锁定在 Codex 的是：

```text
锁定的：  thread 持久化 schema、skill/plugin 包格式、marketplace 机制、
          MCP 装载方式、approval/sandbox 策略模型、memory/goal 存储
没锁定的：模型、模型厂商、计费
```

所以"换 harness"这个问题应该被拆成两问：

| 问题 | 难度 | 何时需要决策 |
|---|---|---|
| 换模型（GPT → Claude → 国产） | **低**，网关适配即可 | 随时，不影响架构 |
| 换 harness（Codex → 别的 agent runtime） | **中高**，thread/skill/tool 装载全要重写 | 现在就要留接缝 |

下面只讨论第二问。

### 1.2 候选对比

| 维度 | Codex（SDK/app-server） | Claude Agent SDK | OpenCode | Pi (OpenClaw) | 自研 loop |
|---|---|---|---|---|---|
| 集成方式 | JSON-RPC over stdio/WS | TS/Python 库，进程内或子进程 | HTTP + SSE，OpenAPI 3.1 | 进程内 `createAgentSession()` | — |
| 模型可换 | ✅ `model_providers` 配置，支持自建网关 | ⚠️ 主要面向 Anthropic，第三方需 proxy | ✅ 原生多 provider | ✅ 可配 | ✅ 完全自由 |
| MCP 支持 | ✅ 原生 | ✅ 原生 | ✅ | ✅ | 自己实现 |
| skill/plugin 生态 | ✅ 官方 plugin marketplace，订单来了直接复用 | ✅ Skills 机制 | ⚠️ 较弱 | ⚠️ 较弱 | ❌ |
| 会话/thread 持久化 | ✅ 内置 SQLite | ⚠️ 部分，需自管 | ✅ 共享 SQLite + fork | ⚠️ JSONL 自管 | 自己实现 |
| 沙箱隔离 | ✅ 最强（Seatbelt/Landlock/seccomp） | ⚠️ 依赖宿主 | ❌ 需自己容器化 | ❌ 自己负责 | 自己实现 |
| 多租户隔离 | 环境变量 `CODEX_HOME` 分区 | 每实例 | session 级（共享库） | 每实例内存 | — |
| 中国大陆可用性 | ✅（因为可换 base_url） | ⚠️ 需自建代理 | ✅ | ✅ | ✅ |
| 成熟度 / 生态 | 高 | 高 | 中 | 低 | — |

### 1.3 建议

**结论：继续用 Codex，但按"可替换"来设计。**

理由：

1. **Codex 是目前唯一同时具备 [沙箱] + [plugin marketplace] + [thread 持久化] + [可换模型网关] 的现成方案。** 自研这四样，保守估计 3-6 人月，且沙箱这块很难做对。
2. **订单来了已经趟过路了**——它的 config.toml 就是一份现成的、被生产验证过的接入模板。我们照抄能省掉大量试错。
3. **"换模型"这个更高频的需求，Codex 已经通过 `model_providers` 满足了**，且这正是订单来了在用的路径。真正需要换 harness 的场景（Codex 停止开源、协议 breaking change、许可变化）概率不高但后果重，值得用一层抽象对冲，而不是现在就换。
4. **Claude Agent SDK 是唯一值得认真考虑的备选**，理由是 skill 机制和 MCP 都是一等公民、agent loop 质量高。但它在"自建模型网关"和"沙箱"上不如 Codex，且国内部署要额外解决网络问题。**建议把它作为 Plan B，并在抽象层设计时拿它当"第二个实现"来验证接口是否真的中立。**
5. OpenCode / Pi 生态和成熟度不足以承载生产业务，不建议。

### 1.4 可替换性怎么落地：`AgentRuntime` 接口

不要把 Codex 的概念泄漏到业务层。在 main 进程里定义一层与 harness 无关的契约：

```ts
// src/main/agent/agent-runtime.ts —— 不 import 任何 codex 相关模块
export interface AgentRuntime {
  createThread(input: {
    context: ExecutionContext;      // workspace/account/property/profile
    skillIds: readonly string[];
    approvalMode: 'auto' | 'approve' | 'readonly';
  }): Promise<ThreadHandle>;

  sendTurn(thread: ThreadHandle, message: UserTurn): AsyncIterable<AgentEvent>;
  interrupt(thread: ThreadHandle): Promise<void>;
  listThreads(filter: ThreadFilter): Promise<ThreadSummary[]>;
}

// 归一化事件——不暴露 codex 原生事件形状
export type AgentEvent =
  | { kind: 'text-delta';    text: string }
  | { kind: 'reasoning';     text: string }
  | { kind: 'tool-call';     toolName: string; args: unknown; callId: string }
  | { kind: 'tool-result';   callId: string; result: ToolResult }
  | { kind: 'approval-required'; callId: string; risk: RiskLevel }
  | { kind: 'turn-complete'; usage: TokenUsage }
  | { kind: 'error';         error: AgentError };
```

三条硬约束：

1. **renderer 只认 `AgentEvent`**，永远不知道 Codex 存在。
2. **工具实现不写在 harness 侧**。工具的真身在我们自己的 `ToolRegistry`（见 3.3），MCP server 只是把 registry 暴露给 harness 的适配器。换 harness = 换适配器，工具一行不动。
3. **skill 内容用中立 markdown 写**（frontmatter 只用 `name` / `description`），不用 Codex 专有字段。真要用 plugin marketplace，把 marketplace 当作**分发通道**，不当作 skill 的**存储格式**。

这样换 harness 的代价被压缩到：一个 `CodexAgentRuntime` 实现 + 一个 MCP 适配器，约 1-2 周工作量。

### 1.5 一个必须现在就做的决策：模型网关

订单来了走的是 `base_url = 自家网关 + wire_api = responses`。**强烈建议我们照做**，而且要在接 Codex 的第一天就做，不要先直连 OpenAI 再改：

```text
Electron ──> 自建网关 ──> 模型厂商（可换）
             ├── 鉴权（用我们的用户体系，不是 OpenAI key）
             ├── 配额 / 计费 / 限流
             ├── 审计（prompt / 输出留痕）
             ├── 脱敏（订单、手机号、身份证出站前处理）
             └── 模型路由（按任务类型选模型、灰度、降级）
```

理由不只是"可换模型"：**没有网关，用户的 OTA 订单数据会直接出境到模型厂商，且我们没有任何审计和脱敏能力**。这在酒店行业是合规红线。

---

## 2. 账号体系 / Workspace / AI 框架：借鉴与优化

### 2.1 值得直接抄的

| # | 设计 | 为什么值得抄 |
|---|---|---|
| 1 | **partition per (channel, account)** | 唯一能同渠道多账号并存、且隔离完整 Chromium storage 的方案。命名 `xiaozhi:<env>:<channel>:<otaAccountId>`，仅 `SessionFactory` 内部拼接 |
| 2 | **loginState 三元组**（state + source + updatedAt） | 登录态是推断出来的，必须记来源才能解释和 debug |
| 3 | **per-tab `allowAnyUrl`** | 导航策略默认收紧、按需放开，粒度比全局 allowlist 好 |
| 4 | **`isPrimary` / `openerTabId`** | 渠道主页签可重建、弹窗可溯源 |
| 5 | **MCP server 无权限，bridge 转发** | agent 被攻破也拿不到 `webContents` |
| 6 | **snapshot → ref → act → snapshot** | 不让模型猜 selector 和 URL |
| 7 | **context-first 工具**（`pms_get_context` 先行） | 上下文不完整就拒绝执行，杜绝"操作错账号" |
| 8 | **本地 MCP + 远程 MCP 分层** | 业务能力云端热更、贴浏览器的能力才留本地 |
| 9 | **skill 用来"劝阻"而非"教会"** | RPA 是补洞，API 是主链路——把价值观写进 prompt |
| 10 | **`channelHotelName` / `channelUserLogin` 回显** | 让用户肉眼确认操作对象，比任何日志都有效 |

### 2.2 值得优化的（订单来了的弱点）

#### 优化 1：账号与门店的关系建模

> **本节已按 2026-08-03 决议修订。原稿建议加 Tenant 层并在浏览器上下文命名里预留租户段，该建议已被否决，理由见 0.1b 决议。**

订单来了把 `workspaceId` 直接等同于渠道，`ChannelAccount ↔ 门店` 的关系没有显式建模。这在单店场景无所谓，但连锁/管理公司场景下：

- 一个携程商家账号常常挂多家店。
- 一家店也可能有多个账号（不同签约主体）。

**当前定稿的模型（不含 Tenant）：**

```text
Hotel (门店)
  ↕ 多对多（AccountBinding）
OtaAccount (渠道账号)
  └── BrowserContextKey = { environment, channel, otaAccountId }
        └── Tab
```

`OtaAccount ↔ Hotel` 用 `AccountBinding` 显式建模，不要用外键硬绑——多对多是业务事实，不是可选项。

需要组织级分组时，加一层 mapping 表，**不改浏览器上下文的命名**。术语定义见 `2026-08-03-glossary-and-orderlaile-mapping.md`。

#### 优化 2：`channelState: {}` 太弱，应该是结构化的渠道能力声明

订单来了的 `channelState` 是个空对象兜底字段。建议我们用 **channel manifest** 显式声明每个渠道的能力和策略（这点 `ORDERLAILE_ARCHITECTURE_REVIEW.md` P0-2 已经提出，这里补充字段）：

```ts
type ChannelManifest = {
  channelId: string;
  displayName: string;
  entryUrls: readonly string[];
  allowedOrigins: readonly string[];
  allowedRedirectOrigins: readonly string[];  // OAuth 跳转
  cookieDomains: readonly string[];
  popupPolicy: 'deny' | 'same-origin' | 'manifest-origins';
  downloadPolicy: 'deny' | 'allow-to-artifact-store';
  loginHealth: LoginHealthStrategy;   // 怎么判断登录态
  identityProbe: IdentityProbeStrategy; // 怎么抓 hotelName/userLogin
  capabilities: readonly ChannelCapability[];  // 支持哪些工具
  apiAdapter?: 'official' | null;     // 有没有官方 API，有则优先
};
```

`apiAdapter` 这个字段是关键：**它让"API 优先、RPA 兜底"从口号变成代码里的分支**。

#### 优化 3：thread 持久化不要完全外包给 harness

订单来了把 thread/memory/goal 全放在 `~/.smartorder/*.sqlite`（Codex 自己的 schema）。好处是省事，坏处是：

- 换 harness 时会话历史全部丢失，或需要写迁移器。
- 会话和业务实体（任务、订单、门店）没有关联——无法回答"这个订单的处理过程中 agent 说了什么"。
- 无法做业务侧的会话检索、审计导出、合规留存。

**建议：双写。** harness 保留它自己的 thread 存储（不去动），我们**额外**在自己的 SQLite 里存一份归一化的会话记录：

```text
agent_session(id, appUserId, hotelId, channel, otaAccountId, harnessThreadId,
              harness, model, startedAt, endedAt, status)
agent_message(sessionId, seq, role, kind, content, tokenUsage, at)
agent_tool_call(sessionId, callId, toolName, argsRedacted,
                resultSummary, approvedBy, riskLevel, at)
```

`harnessThreadId` + `harness` 两个字段就是接缝——换 harness 后老会话仍可读，新会话换个 harness 标记继续写。

#### 优化 4：审批模型要比 `default_tools_approval_mode = "approve"` 更细

订单来了是**按 MCP server** 设审批模式（整个 browser server 一律 approve）。这会导致两个问题：只读的 `browser_snapshot` 也要人点确认（体验差），或者为了体验放开成 auto（安全差）。

**建议按工具的风险等级分级**：

```ts
type RiskLevel =
  | 'readonly'      // snapshot/screenshot/list —— 自动执行
  | 'navigational'  // 在 manifest 内导航 —— 自动执行，记日志
  | 'mutating-low'  // 填表单但不提交 —— 自动执行，记日志
  | 'mutating-high' // 提交订单/改价/改库存 —— 强制人工审批 + 执行后校验
  | 'destructive';  // 取消订单/退款 —— 强制审批 + 二次确认 + 不可批量
```

`mutating-high` 及以上一律走 `proposed → approved → executing → verified/failed` 状态机（`ORDERLAILE_ARCHITECTURE_REVIEW.md` 已提出，这里给出触发条件）。

#### 优化 5：`tool_timeout_sec = 3600` 是个坑

订单来了给 browser MCP 设了 1 小时超时。这意味着一个卡住的页面操作会挂住 agent 一小时。建议：

- 按工具设超时：snapshot 10s / click 30s / 等待页面 60s / 整个任务 10min。
- 超时后必须有**可诊断产物**：截图 + DOM 快照 + 网络日志，进 artifact store。
- 任务级别要能取消，取消要能真正中断底层 CDP 调用（不只是丢弃 promise）。

#### 优化 6：补上订单来了没有的——多 agent 并发的账号级锁

`state_5.sqlite` 有 `thread_spawn_edges`（子 agent 派生），说明订单来了支持多 agent。但没看到账号级并发控制。风险场景：两个 agent 同时操作同一个携程账号的同一个页面，互相踩踏。

**建议：`ExecutionContext` 解析时获取账号级互斥锁**，同一 `(channel, otaAccountId)` 同时只允许一个写操作序列，只读可并发。

### 2.3 AI 框架分层建议

```text
┌─────────────────────────────────────────────────┐
│ Renderer  只认 AgentEvent，不知道 harness 存在    │
└───────────────────┬─────────────────────────────┘
                    │ IPC (schema 校验)
┌───────────────────▼─────────────────────────────┐
│ Main: AgentOrchestrator                          │
│   ├── AgentRuntime 接口  ←── 可替换接缝           │
│   │     └── CodexAgentRuntime (当前实现)          │
│   ├── SessionStore  (我们自己的会话归一化存储)     │
│   ├── ToolRegistry  ←── 工具真身在这里            │
│   │     ├── BrowserCapability   (snapshot/click) │
│   │     ├── ContextCapability   (get_context)    │
│   │     ├── TaskCapability      (采集/巡检)       │
│   │     └── ToolPolicy (风险分级/审批/超时/审计)   │
│   └── ExecutionContextResolver + 账号级锁         │
└───────────────────┬─────────────────────────────┘
                    │ bridge (unix socket)
┌───────────────────▼─────────────────────────────┐
│ MCP Adapter (无权限进程)                          │
│   把 ToolRegistry 翻译成 MCP tools 给 harness     │
└─────────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│ Codex Runtime (独立进程，无 Electron/DB/Cookie)   │
└───────────────────┬─────────────────────────────┘
                    │ HTTPS
┌───────────────────▼─────────────────────────────┐
│ 自建模型网关 (鉴权/计费/审计/脱敏/模型路由)         │
└─────────────────────────────────────────────────┘
```

---

## 3. 当前架构的调整建议

当前代码状态（`src/` 约 100 个文件）：Electron + Svelte 5 + Forge，安全基线不错（fuses、sandbox、contextIsolation、IPC sender 校验、权限默认拒绝、CSP），已有 unit/component/e2e 三层测试。业务侧目前是"浏览器壳 + 日历 + Agent 静态演示页 + 携程 check-in 自动化"。

`docs/ORDERLAILE_ARCHITECTURE_REVIEW.md` 已经给出了 P0/P1/P2 问题清单和阶段划分，**我认可它的判断，不重复**。这里只补充它没覆盖的、与本次 harness/账号体系结论相关的调整。

### 3.1 补充调整项

| # | 调整 | 与已有评审的关系 |
|---|---|---|
| A | ~~领域模型加 `Tenant` 层~~ **已否决**：不做多租户，需要分组时加 mapping 表 | 见 0.1b 决议 |
| B | `AccountBinding` 建模 OtaAccount↔Hotel 多对多 | 补充 P1-1 |
| C | ChannelManifest 增加 `apiAdapter` / `identityProbe` 字段 | 补充 P0-2 |
| D | 先建模型网关，再接 harness | 新增，合规前置 |
| E | `AgentRuntime` 接口 + `SessionStore` 双写 | 新增，可替换性 |
| F | ToolPolicy 按 RiskLevel 分级而非按 server | 细化 P1-4 |
| G | 账号级互斥锁 | 新增，多 agent 并发安全 |
| H | 逐工具超时 + 超时诊断产物 | 细化 P1-6 |

### 3.2 现在就该动的两件事（其余排后）

你说"架构调整可以放在后面任务"，所以这里只标出**成本会随时间快速上升**的两项，其余等排期：

1. ~~**领域模型和 ID 规则定下来（含 Tenant 层）。**~~ **已完成（2026-08-03）**：命名与 ID 规则已定稿，见 `2026-08-03-glossary-and-orderlaile-mapping.md`。不含 Tenant 层。

2. **模型网关的存在性决策。** 不是现在就建，而是现在就确认"我们不会直连模型厂商"。因为如果默认直连，Agent 页面很容易先接通再说，之后数据出境和审计就补不回来了。

其余（per-account partition 改造、channel manifest、ToolRegistry、持久化）建议按 `ORDERLAILE_ARCHITECTURE_REVIEW.md` 的阶段 0/1/2 排，本次不改动。

### 3.3 一个需要你拍板的分歧

`ORDERLAILE_ARCHITECTURE_REVIEW.md` 建议"先做只读纵向闭环，Agent 只做解释不做执行"。我同意这个顺序，但要提醒一点：

**当前 `src/main/automation/ctrip-check-in-automation.ts` 已经在启动时自动跑携程 check-in 自动化了**（`application.ts` 里 `ctripAutomation.start()`，只由环境变量 `HOTEL_BUTLER_DISABLE_STARTUP_AUTOMATION` 控制）。这是一个**在全局共享 session 上、无上下文、无审批、开机自动执行的写操作**。它同时踩了 P0-1（共享 session）、P1-1（无上下文）、F（无审批）。

建议：在 per-account partition 改造完成前，把它默认关闭（改成 opt-in 而不是 opt-out）。这是个 1 行改动，但能避免在错误的账号上自动执行。

---

## 4. 验证说明

本报告为静态评审 + 本地运行态只读观察，未修改任何生产代码，未触发外部系统操作，未运行订单来了的写操作。

实际执行的观察：
- 读取 `/Applications/订单来了.app/Contents/Resources/` 下 `release-runtime-config.json`、`skills-catalog.json`、`smart-order-skills/browser-guide/SKILL.md`、`codex-primary-runtime/` 目录结构
- 读取 `~/.smartorder/config.toml`、`ls ~/.smartorder/`
- `sqlite3 .tables` / `.schema threads` 于 `state_5.sqlite`、`memories_1.sqlite`、`goals_1.sqlite`（只读元数据，未读取业务数据行）
- 读取 `~/Library/Application Support/ddlldesk/` 下 `workspace-state.prod.json`（全量 19 个 workspace）、`device-auth.prod.json`、`global-store.json`、`ai-workbench-session-owners.json`、`launch-sequence.prod.json`、`ls Partitions/`
- 读取一条 Codex rollout JSONL（`sessions/2026/07/30/rollout-…-019fb2b5-….jsonl`）确认 session_meta 与 so_cli 工具调用的实际参数形状
- `.schema remote_control_enrollments`
- 读取当前仓库 `package.json`、`src/` 文件清单、`src/main/browser/browser-manager.ts`、`src/shared/browser.ts`、`src/main/application.ts`
- Web 检索 harness 选型对比（见下方来源）

注：`global-store.json` 内含真实 token / userId / 手机号，本文档只引用字段名与结构，未抄录凭证值；该文件属于本机个人数据，不应进入仓库或日志。

未验证 / 仍属推断的部分：
- 订单来了云端网关内部实现（仅从 config.toml 的 base_url 推断）
- 云端 `so_cli` 如何把 bearer token 解析成"当前门店"（只观察到 code=7 鉴权失败路径，未观察到成功路径）
- 切换 app 账号时 OTA partition 是否会被清理（当前只有单账号数据，无法验证）
- `bridge.sock` 上的实际协议内容（未连接，未抓包）
- 订单来了是否有账号级并发锁（从 schema 推断"未见"，不等于"没有"）
- app.asar 未解包分析（547MB，本次未做）

来源：
- [Embedding AI Agents in SaaS: Codex CLI vs OpenCode vs Pi](https://codex.danielvaughan.com/2026/04/07/embedding-ai-agents-saas-codex-opencode-pi/)
- [Claude Code vs Claude Agent SDK](https://www.augmentcode.com/tools/claude-code-vs-claude-agent-sdk)
