# 酒店 Agent 接入与调用链

本文描述 desktop、server、Kimi 分层模型、受限 MCP、执行状态机、json-render 与 PostgreSQL 的端到端接入。Agent 保持单实例编排，不启用子 Agent。

## 配置

本地配置写在 `apps/server/.env`，生产配置参考 `apps/server/.env.production.example`：

```dotenv
AI_KIMI_API_KEY="replace-with-kimi-api-key"
AI_KIMI_BASE_URL="https://api.moonshot.cn/v1"
# 分类、摘要、取证和常规回答；K2.6 请求会由服务端关闭思考。
AI_KIMI_FAST_MODEL="kimi-k2.6"
# 仅用于验证数据后的复杂经营分析；K3 请求使用 low 推理强度。
AI_KIMI_MODEL="kimi-k3"

# 新通用 DMS MCP 先按名称发现数据库；ID 可作为额外的上线校验。
AI_DMS_MCP_URL="https://dms-mcpr-bfobse-vcyndjbctk.cn-hangzhou.fcapp.run/sse"
AI_DMS_MCP_BEARER_TOKEN="replace-with-server-token"
AI_DMS_DATABASE_NAME="rms_data"
AI_DMS_DATABASE_ID="replace-with-reviewed-database-id"

# 公共天气 MCP 默认关闭；只有明确注册对应业务意图时才按需启用。
AI_PUBLIC_WEATHER_MCP_ENABLED="false"

# server name -> @langchain/mcp-adapters HTTP/SSE/stdio connection
AI_MCP_SERVERS_JSON='{
  "public-hotel-rates": {
    "transport": "http",
    "url": "https://rates.example.com/mcp",
    "headers": { "Authorization": "Bearer replace-with-server-token" },
    "capabilities": ["hotel_rates"]
  }
}'

# staff 登录变体下，apps/server 用它验证 desktop 转发的 RMS Bearer。
XIAOZHI_RMS_SERVER_URL="https://rms.example.com"
```

API Key 和 MCP header 只存在于 server 环境，不能使用 `PUBLIC_` 前缀，也不会进入 renderer、tRPC payload 或日志。生产环境建议改用部署平台 secret manager 或加密的 dotenvx 流程。

国内站 API Key 使用默认的 `https://api.moonshot.cn/v1`；Global Kimi Open Platform API Key 则把 `AI_KIMI_BASE_URL` 改为 `https://api.moonshot.ai/v1`。Key 与域名必须属于同一平台，部署前还应通过该端点的 `/models` 确认两个模型 ID 都可用。

## 完整调用链

```mermaid
flowchart LR
  U[酒店员工] --> UI[Svelte AgentPage]
  UI -->|IPC invoke / event| P[Electron preload]
  P --> H[main Agent handler]
  H --> S[AgentService]
  S -->|tRPC mutation| T[server /api/trpc]
  S <-->|tRPC SSE subscription| T
  T --> I[Session principal resolver]
  I -->|phone cookie| DS[(desktop_session)]
  I -->|staff Bearer /api/v1/me| RMS[RMS API]
  T --> G[HotelAgentGateway]
  G --> E[Business Execution<br/>意图路由 / 参数解析 / 状态机]
  E --> PG[(PostgreSQL Agent tables)]
  E --> R[受限 HotelAgentRuntime]
  R --> V[Evidence Validator]
  R --> K[Kimi K2.6 快速层<br/>Kimi K3 分析层]
  R --> M[@langchain/mcp-adapters]
  M --> SD[searchDatabase 精确发现]
  SD --> MS[固定 DatabaseId 的酒店 MCP 查询]
  R --> SK[SkillProvider 当前为空]
  R --> JU[render_hotel_ui tool]
  JU -->|校验并暂存| R
  R -->|最终 assistant message| T
  UI --> JR[json-render Svelte registry]
```

## 一次请求的时序

```mermaid
sequenceDiagram
  actor User as 酒店员工
  participant UI as AgentPage
  participant Main as Electron main
  participant TRPC as tRPC server
  participant DB as PostgreSQL
  participant Collector as 取证策略
  participant Agent as LangChain Agent
  participant Kimi as Kimi K3
  participant MCP as MCP server

  User->>UI: 输入任务或点击酒店快捷操作
  UI->>Main: agent.startRun(prompt | quickActionId)
  Main->>TRPC: agent.startRun mutation + 当前 cookie/Bearer
  TRPC->>TRPC: 从登录态解析 principal
  opt 快捷操作
    TRPC->>TRPC: quickActionId 映射服务端固定提示词
    TRPC->>TRPC: 检查所需 MCP 是否已配置
  end
  TRPC->>DB: 校验 conversation.ownerEmployeeId
  TRPC->>DB: 事务写 user message + business execution + run
  TRPC-->>Main: runId + businessExecutionId + userMessage
  Main->>TRPC: agent.events SSE(runId)
  TRPC->>DB: 按 owner + runId 回放事件
  alt 快捷操作
    TRPC->>TRPC: 按服务端注册表确定意图，不调用模型
  else 自然语言
    TRPC->>Kimi: 结构化意图分类与候选参数抽取
    TRPC->>TRPC: 按意图注册表过滤模型提出的 slot
  end
  TRPC->>DB: CAS 保存路由和参数状态
  alt 参数缺失、无效或存在多个候选
    TRPC->>DB: 保存 awaiting_clarification 与交互 schema
    TRPC-->>UI: business_execution_updated + run_completed
    UI->>UI: 渲染产品自有补充信息卡片
    UI->>TRPC: agent.submitClarification + expectedVersion
    TRPC->>DB: 校验 interaction/版本/答案并创建后续 run
  else 参数已确定
    TRPC->>DB: 保存不可变 resolved request
  end
  TRPC->>Collector: resolved request
  alt 专用意图且 MCP Schema 兼容
    Collector->>MCP: 代码选择工具并构造参数
    MCP-->>Collector: MCP result
  else 通用意图或 Schema 不兼容
    Collector->>Agent: 进入受限取证回合
    Agent->>Kimi: resolved request + 意图工具 allowlist
    Kimi-->>Agent: tool_calls
    Agent->>MCP: 调用只读 MCP
    MCP-->>Agent: ToolMessage
    Agent->>Kimi: 受限回合收尾
  end
  Collector->>DB: 分级解析、标准化并持久化证据
  TRPC->>TRPC: 程序校验范围/时段/新鲜度/空结果/裁剪
  TRPC->>Agent: 仅传不可变请求与已验证证据
  Agent->>Kimi: 生成最终回答（无数据 MCP）
  opt 适合生成式 UI
    Agent->>Agent: render_hotel_ui(spec)
    Agent->>Agent: 校验并暂存 UI spec
  end
  Kimi-->>Agent: 最终文本 token
  Agent->>DB: 写 assistant message + terminal event
  TRPC-->>UI: text_delta / run_completed
  alt 可重试阶段失败且员工选择重新尝试
    UI->>TRPC: agent.retryRun(failedRunId, clientRequestId)
    TRPC->>DB: 校验 owner / 最新 attempt / checkpoint + CAS 恢复 execution
    TRPC->>DB: 新建 retry_of_run_id 指向失败 Run 的新 Run
    TRPC->>Collector: 从恢复阶段继续；answer checkpoint 不重复调用 MCP
  end
```

## tRPC contract 使用示例

desktop main 中先创建 run，再订阅事件。prompt 不放进 SSE URL，避免长输入被代理或浏览器截断：

```ts
const started = await client.agent.startRun.mutate({
  conversationId,
  prompt: '检查今天临近超时的订单',
  clientRequestId: crypto.randomUUID(),
});

const subscription = client.agent.events.subscribe(
  { runId: started.runId, lastEventId: null },
  {
    onData(trackedEvent) {
      const event = trackedEvent.data;
      if (event.type === 'text_delta') appendText(event.delta);
      if (event.type === 'ui_spec') renderSpec(event.spec);
    },
  },
);

// 页面销毁、切换用户或用户停止接收时：
subscription.unsubscribe();
```

服务端 subscription 是 async generator；订阅时先挂 live listener，再按 PG sequence 回放历史，并用 event ID 去重。因此模型可能已经开始运行，客户端仍不会丢掉订阅建立前的事件。

## 酒店快捷操作

页面通过 `agent.quickActions` 获取服务端目录，并在空会话卡片与输入框上方工具条中渲染。点击后只提交 ID，客户端不能覆盖服务端业务提示词：

```ts
const actions = await client.agent.quickActions.query();
const started = await client.agent.startRun.mutate({
  conversationId,
  quickActionId: 'yesterday_operating_review',
  clientRequestId: crypto.randomUUID(),
});
```

配置 DMS Token 和 `AI_DMS_DATABASE_NAME` 后，默认目录包含“昨日经营复盘”和“查看酒店经营概览”。天气能力仍可用于自然语言查询，但不再作为快捷入口。server 会先用 `searchDatabase` 精确发现数据库；若同时配置 `AI_DMS_DATABASE_ID`，还会校验发现值是否一致。

“公开酒店价格”只有在 `AI_MCP_SERVERS_JSON` 中配置带 `hotel_rates` capability 的真实价格 MCP 后才会出现在页面。仓库没有内置或冒充携程官方价格 MCP，也不会抓取需要登录的携程页面。依赖本地 RMS/PMS 数据但尚无真实 MCP 的异常订单、库存、对账等快捷项已从目录移除。

## 业务读取调用链

快捷操作和自然语言在路由完成后共用同一套业务执行。天气、经营概览和公开房价属于专用意图；通用酒店数据问题保留受限 Agent：

```text
用户输入 / 快捷操作 ID
→ 创建 Conversation Message + Run + BusinessExecution
→ BusinessIntentRouter
→ BusinessSlotResolver
→ 缺参数：持久化 clarification，结束当前 Run，等待用户
→ 参数完整：进入 executing
   ├─ 专用意图且工具 Schema 兼容
   │  → DeterministicWorkflowCollector 由代码选择只读工具并构造参数
   │  → 直接调用 MCP，不调用取证模型，也没有工具后的模型收尾
   └─ 通用查询或第三方工具 Schema 不兼容
      → LangChainAgentRuntime 受限取证回合
      → 模型只能在当前意图 allowlist 内选择只读 MCP
→ MCP 结果按 structuredContent / JSON / 已知适配器 / 有界文本分级解析
→ 生成 EvidenceEnvelope 并执行程序化 scope / period / freshness / empty / filtered 校验
→ sufficient：只把已验证证据交给最终回答模型
→ 最终回答模型生成文字，可调用一次 render_hotel_ui
→ server 校验并暂存 UI spec；只在保存 assistant Message 和发布 run_completed 时一起提交
```

天气 MCP 当前默认关闭，普通天气和天气相关的一般酒店建议直接由 LLM 回答。未来若显式注册天气业务意图，现有版本化天气适配器可提取 Markdown 中的常用字段并保留有界原文；第三方 MCP 若提供 `structuredContent`，证据层优先使用，若只有 JSON 文本则解析后校验，若只有普通文本则保留为 `unstructured` 并在最终回答中说明字段级校验限制。

服务端用不含正文和结果的结构化日志区分耗时：`agent.workflow.collection.*`、`agent.workflow.evidence.assessed` 和 `agent.answer.model.*`。客户端原有的 `tool_started/tool_completed` 继续表示用户可见的工具生命周期；结果视图只在 Run 成功结束后显示，不提前渲染空框或候选视图。

## 失败与前端反馈

失败按发生阶段收敛，不把内部异常、SQL、MCP 地址或凭证展示给用户：

- 缺失、无效或歧义参数进入 `awaiting_clarification`，显示产品自有补充信息卡片；
- 写请求进入 `write_denied`，以普通 assistant 消息说明当前只支持查询和建议；
- 空结果或证据不足进入 `limited`，说明不能得出结论及数据限制；
- 证据酒店范围不匹配直接终止 Run，显示不可重试的安全校验提示，不再落回普通 Agent；
- MCP、模型或未预期服务异常发布 `run_failed`，renderer 清除运行中草稿并显示友好错误横幅；
- SSE 连接中断提示重新打开会话，服务端保留的事件可通过游标恢复。

`run_failed.retryable` 会投影到持久化执行轨迹。只有最新失败 attempt 且数据库中存在安全
checkpoint 时才显示“重新尝试”；重试事务恢复同一个 `agent_business_execution`，并新建
一个带 `retry_of_run_id` 的 `agent_run`。路由/参数阶段恢复解析，取证阶段复用不可变请求，
已进入 grounded answering 的失败直接复用已验证证据，不再调用 MCP。配置错误、证据拒绝、
写操作拒绝、已被更新 attempt 取代的旧失败都不可重试。

## 用户 session 隔离

客户端永远不提交 owner 字段。server 从认证链路生成：

```ts
type AgentPrincipal = {
  employeeId: string;
  orgId: string;
};
```

- phone 变体：Electron 专用 `persist:xiaozhi:server-api` cookie jar → `desktop_session` → RMS employee。
- staff 变体：main 动态注入当前 RMS access token；server 每次调用 `/api/v1/me` 验证后生成 principal。
- PG：conversation、run、event、memory 查询都以当前全局唯一 `employeeId` 约束，同时在 conversation 和 memory 中保存 `orgId`；消息只能在已通过 owner 校验的 conversation 下读取。
- tRPC input 使用 strict Zod object，伪造 `ownerEmployeeId` 会得到 `BAD_REQUEST`。
- 页面销毁、切换会话或退出登录时取消 main 中的 SSE subscription，renderer 不保存跨用户全局 Agent store。

同一员工在不同设备登录时会看到自己的持久化会话，这是预期的跨设备恢复；不同员工不会共享会话或长期记忆。

## 生成式 UI

模型不能直接输出任意 Svelte/HTML。它只能调用 `render_hotel_ui`，server 会验证：

- 组件必须来自酒店白名单；
- root 和所有 child 引用必须存在；
- 最多 100 个 element、序列化后不超过 200 KB；
- Link 只允许 HTTPS 或应用内相对路径；
- registry 未声明 action，因此模型生成的 Button 不会自动执行后台写操作。
- Table 行必须与列等长，单元格只能是字符串、有限数字、布尔值或 `null`；对象和数组会被拒绝，避免显示成 `[object Object]`。

除了 `Table`、`Alert`、`Progress`、`Card`、`Badge`、`Tabs` 和 `Collapsible`，酒店 registry 现在还包含：

- `HotelAreaChart`：入住率、需求、收入或天气的连续趋势；
- `HotelLineChart`：价格、评分、温度等精确趋势比较；
- `HotelBarChart`：渠道、房型、部门或日期的离散比较；
- `HotelDonutChart`：2–5 类渠道、房态或费用构成；
- `HotelRadarChart`：统一量纲的服务质量或竞品维度；
- `HotelRadialChart`：入住率、清扫率、到账率等单目标。

图表使用 shadcn-svelte Chart/LayerChart 组合方式和 tooltip，颜色固定映射到项目 `DESIGN.md` 的蓝、青、橙、玫红、深海军蓝，不允许模型自定义任意颜色。图表 props 使用共享 strict Zod schema；server 和 renderer 使用同一约束，并限制数据点和分类数量。

## MCP 与 Skill 扩展

`AI_MCP_SERVERS_JSON` 只声明可用连接，不会让 Agent 自动加载这些 MCP。通用意图始终直接调用 LLM，并携带会话历史、摘要和员工记忆；MCP 与业务 Skill 清单为空，只保留用户明确要求记忆时使用的本地长期记忆工具，不提供生成式 UI。只有选中的服务端业务意图显式声明某项 capability、Skill 或本地工具时，运行时才加载该意图所需的依赖。每个获准的 MCP entry 交给 `MultiServerMCPClient`，支持 HTTP、SSE 和 stdio。远端必须 HTTPS，本机开发可使用 loopback HTTP。系统没有“开启写工具”的配置：加载层始终拒绝 create/update/delete/refund/pay/publish 等写入语义工具，业务路由层也会把订单、价格、库存、房态、支付和配置变更确定性拒绝。内置 DMS 在工具初始化时由程序调用 `searchDatabase`，按 `AI_DMS_DATABASE_NAME` 要求唯一精确匹配，并可用 `AI_DMS_DATABASE_ID` 二次核对；随后只向 Agent 暴露 `listTables`、受同一 schema 约束的 `getTableDetailInfo`、`generateSql` 与经程序校验的 `executeScript`，且每次覆盖模型提交的 databaseId。无法绑定 DatabaseId 的 `askDatabase`、实例管理、数据变更单和审批工具不会进入 Agent。专用经营概览由代码构造固定聚合 SELECT，只调用一次 SQL 工具；通用酒店数据问题才允许受限 schema/SQL Agent。`capabilities` 接受 `weather`、`hotel_rates` 与内置 DMS 的 `hotel_data`；快捷操作仅在对应能力真实配置时返回。不要把 MCP URL、command、args 或 header 暴露成用户输入。生产 MCP server 仍应按凭证实施真正的只读权限。

Skill 当前是显式空实现：

```ts
export interface SkillProvider {
  list(): Promise<readonly { name: string; instructions: string }[]>;
}
```

业务确定后新增 provider，并在 composition root 替换 `EmptySkillProvider` 即可。Skill 指令会进入 system prompt；不要让 Skill 自行绕过 tool 权限或 session owner 约束。

## 持久化表

| 表 | 作用 | 隔离键 |
|---|---|---|
| `agent_conversation` | 会话标题与生命周期 | `owner_employee_id` |
| `agent_message` | user/assistant 内容与最终 UI spec | 经 conversation owner |
| `agent_run` | 幂等 client request、运行状态与 retry attempt 血缘 | `owner_employee_id` |
| `agent_run_event` | SSE 回放、工具步骤与终态 | `owner_employee_id` |
| `agent_business_execution` | 跨多个 Run 的意图、参数状态、追问、证据阶段与 CAS 版本 | `owner_employee_id` |
| `agent_business_execution_event` | 执行状态转换审计 | 经 execution owner |
| `agent_memory` | 跨会话长期记忆 | `owner_employee_id + key` |

本次 migration 是加法变更：先创建业务执行及事件表，再给 message/run 增加可空外键，因此既有行会以 `businessExecutionId=null` 继续加载。若上线后需要回滚应用版本，应先回滚应用并保留新增表和可空列；它们不会影响旧代码。只有确认不再需要执行审计数据后，才可在单独、经审批的 migration 中先删除两条外键/可空列，再删除新表，不能把数据删除混入应用回滚。

## 当前限制

- 本期不含子 Agent。
- 本期禁止所有业务写操作；后续加入写操作时需要单独的影响预览、授权和审计设计。
- 酒店时区当前使用应用默认 `Asia/Shanghai`。酒店目录尚未成为本系统可信主数据；酒店候选通过受限 DMS 查询获得，并明确属于共享 DMS token 可见范围。
- 一次会话只允许一个非终态业务执行。等待补充信息可跨页面重载恢复；服务重启时孤立的运行态会被标记为可重试失败，不会自动重放未知工具调用。
- 公共天气数据受上游服务可用性和 fair-use 限制影响，不能替代官方灾害预警。
- 携程或其他平台的实时酒店价格需要合法、稳定的价格 MCP/API；未配置时快捷操作不会展示。
- “停止接收”会关闭本窗口 SSE，但 server 会继续完成并持久化当前 run，之后重新打开会话可看到最终结果。
- 尚未实现附件上传、语音和需要人工确认的写操作。
