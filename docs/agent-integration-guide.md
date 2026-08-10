# 酒店 Agent 接入与调用链

本文描述 desktop、server、Kimi K3、MCP、json-render 与 PostgreSQL 的端到端接入。Agent 保持单实例编排，不启用子 Agent。

## 配置

本地配置写在 `apps/server/.env`，生产配置参考 `apps/server/.env.production.example`：

```dotenv
AI_KIMI_API_KEY="replace-with-kimi-api-key"
AI_KIMI_BASE_URL="https://api.moonshot.cn/v1"
AI_KIMI_MODEL="kimi-k3"

# 默认启用仓库固定版本的公共天气 MCP；不需要 API Key。
AI_PUBLIC_WEATHER_MCP_ENABLED="true"

# server name -> @langchain/mcp-adapters HTTP/SSE/stdio connection
AI_MCP_SERVERS_JSON='{
  "public-hotel-rates": {
    "transport": "http",
    "url": "https://rates.example.com/mcp",
    "headers": { "Authorization": "Bearer replace-with-server-token" },
    "capabilities": ["hotel_rates"]
  }
}'

# 默认 false，只加载 get/list/read/search/find/query 等只读 MCP 工具。
AI_MCP_ALLOW_WRITE_TOOLS="false"

# staff 登录变体下，apps/server 用它验证 desktop 转发的 RMS Bearer。
XIAOZHI_RMS_SERVER_URL="https://rms.example.com"
```

API Key 和 MCP header 只存在于 server 环境，不能使用 `PUBLIC_` 前缀，也不会进入 renderer、tRPC payload 或日志。生产环境建议改用部署平台 secret manager 或加密的 dotenvx 流程。

国内站 API Key 使用默认的 `https://api.moonshot.cn/v1`；Global Kimi Open Platform API Key 则把 `AI_KIMI_BASE_URL` 改为 `https://api.moonshot.ai/v1`。Key 与域名必须属于同一平台。

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
  G --> PG[(PostgreSQL Agent tables)]
  G --> R[HotelAgentRuntime]
  R --> K[Kimi K3 Chat Completions]
  R --> M[@langchain/mcp-adapters]
  M --> MS[酒店 MCP servers]
  R --> SK[SkillProvider 当前为空]
  R --> JU[render_hotel_ui tool]
  JU -->|ui_spec event| T
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
  TRPC->>DB: 写 user message + run
  TRPC-->>Main: runId + userMessage
  Main->>TRPC: agent.events SSE(runId)
  TRPC->>DB: 按 owner + runId 回放事件
  Agent->>DB: 读取消息与当前员工长期记忆
  Agent->>Kimi: messages + tools（stream=true）
  Kimi-->>Agent: token / tool_calls
  opt 需要酒店数据
    Agent->>MCP: 调只读酒店工具
    MCP-->>Agent: 工具结果
    Agent->>Kimi: ToolMessage
  end
  opt 适合生成式 UI
    Agent->>Agent: render_hotel_ui(spec)
    Agent->>DB: 持久化 ui_spec event
    TRPC-->>Main: ui_spec SSE
    Main-->>UI: preload stream event
    UI->>UI: json-render 渲染白名单组件
  end
  Kimi-->>Agent: 最终文本 token
  Agent->>DB: 写 assistant message + terminal event
  TRPC-->>UI: text_delta / run_completed
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
  quickActionId: 'today_weather',
  clientRequestId: crypto.randomUUID(),
});
```

当前默认目录包含查看今日天气、未来七天天气和空气质量提醒。它们由固定版本的 `@dangahagan/weather-mcp` 提供，使用 NOAA/Open-Meteo 等公共数据源，不需要 API Key；server 通过 stdio 启动本地 MCP 进程，并只加载读工具。

“公开酒店价格”只有在 `AI_MCP_SERVERS_JSON` 中配置带 `hotel_rates` capability 的真实价格 MCP 后才会出现在页面。仓库没有内置或冒充携程官方价格 MCP，也不会抓取需要登录的携程页面。依赖本地 RMS/PMS 数据但尚无真实 MCP 的异常订单、库存、对账等快捷项已从目录移除。

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

除了 `Table`、`Alert`、`Progress`、`Card`、`Badge`、`Tabs` 和 `Collapsible`，酒店 registry 现在还包含：

- `HotelAreaChart`：入住率、需求、收入或天气的连续趋势；
- `HotelLineChart`：价格、评分、温度等精确趋势比较；
- `HotelBarChart`：渠道、房型、部门或日期的离散比较；
- `HotelDonutChart`：2–5 类渠道、房态或费用构成；
- `HotelRadarChart`：统一量纲的服务质量或竞品维度；
- `HotelRadialChart`：入住率、清扫率、到账率等单目标。

图表使用 shadcn-svelte Chart/LayerChart 组合方式和 tooltip，颜色固定映射到项目 `DESIGN.md` 的蓝、青、橙、玫红、深海军蓝，不允许模型自定义任意颜色。图表 props 使用共享 strict Zod schema；server 和 renderer 使用同一约束，并限制数据点和分类数量。

## MCP 与 Skill 扩展

`AI_MCP_SERVERS_JSON` 的每个 entry 交给 `MultiServerMCPClient`，支持 HTTP、SSE 和 stdio。远端必须 HTTPS，本机开发可使用 loopback HTTP；默认只加载命名上可判定为读取类、且名称中不含 create/update/delete/refund/pay/publish 等写入语义的工具。`capabilities` 当前只接受 `weather` 和 `hotel_rates`，快捷操作仅在对应能力真实配置时返回。不要把 MCP URL、command、args 或 header 暴露成用户输入。名称过滤只是第一道防线，生产 MCP server 仍应按凭证实施真正的只读权限。

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
| `agent_run` | 幂等 client request 与运行状态 | `owner_employee_id` |
| `agent_run_event` | SSE 回放、工具步骤与终态 | `owner_employee_id` |
| `agent_memory` | 跨会话长期记忆 | `owner_employee_id + key` |

## 当前限制

- 本期不含子 Agent。
- 公共天气数据受上游服务可用性和 fair-use 限制影响，不能替代官方灾害预警。
- 携程或其他平台的实时酒店价格需要合法、稳定的价格 MCP/API；未配置时快捷操作不会展示。
- “停止接收”会关闭本窗口 SSE，但 server 会继续完成并持久化当前 run，之后重新打开会话可看到最终结果。
- 尚未实现附件上传、语音和需要人工确认的写操作。
