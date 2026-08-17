# 设计

## 边界

`packages/api` 只承载 schema、类型、tRPC procedure 与窄 `AgentGateway` 接口。Kimi、Drizzle、MCP 与提示词实现全部位于 `apps/server`。desktop renderer 只通过 preload API 访问 main，main 通过 tRPC client 连接 server。

## 调用链

1. renderer 调用 preload 创建会话并订阅一次 Agent run。
2. main 的 `AgentService` 使用 tRPC mutation/query 和 SSE subscription；IPC handler 只做校验并调用该 service。
3. server 校验 desktop cookie 或 staff bearer 身份，将员工 ID 作为数据隔离键。
4. `HotelAgentRuntime` 读取会话历史与长期记忆，加载 MCP 工具和空 Skill registry，再调用 Kimi K3。
5. runtime 将规范化事件先持久化再向 SSE yield；消息完成后持久化最终 assistant message。
6. renderer 按事件 ID 归并文本、步骤、工具状态和 json-render spec。

## 数据模型

- `agent_conversation`: 员工拥有的会话与标题。
- `agent_message`: 用户/助手消息及可选生成式 UI JSON。
- `agent_run_event`: run 内单调递增事件，用于历史恢复和审计。
- `agent_memory`: 员工级长期记忆，带 key、内容与更新时间。

所有查询同时约束 owner ID；删除会话采用显式删除并级联其消息与事件，不删除长期记忆。

## Agent 运行时

- 模型：OpenAI-compatible，国内站默认 `https://api.moonshot.cn/v1`，可由 `AI_KIMI_BASE_URL` 切换 Global 站；默认模型 `kimi-k3`，由 `AI_KIMI_MODEL` 覆盖。
- 运行模式：单 Agent；保留完整 tool-call 消息，流式输出文本与工具生命周期。
- MCP：`AI_MCP_SERVERS_JSON` 提供 server-side 配置，只接受 `http`/`sse` transport，stdio 默认不开放。
- Skill：`SkillProvider` 当前返回空列表，能力状态会显式报告 `0`。
- 长期记忆：提供只作用于当前员工命名空间的 recall/remember 工具。
- 生成式 UI：提供 `render_hotel_ui` 工具，服务端校验组件白名单与树引用后产生 `ui_spec` 事件。

## 安全与失败语义

- API Key 仅从 server 环境读取，禁止进入 contract、日志或 renderer。
- MCP URL 与请求头来自 server 配置，不接受用户 prompt 注入配置。
- 每个 run 设置模型/工具调用上限；取消 SSE 时中止上游调用。
- 临时模型/MCP 故障产生可展示 error 事件；不会把凭证或原始响应体透给客户端。
