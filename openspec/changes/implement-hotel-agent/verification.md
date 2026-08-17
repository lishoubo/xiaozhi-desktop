# Verification

## 结论

酒店 Agent 的 contract、单 Agent runtime、tRPC SSE、Electron 桥、持久化、长期记忆、MCP/Skill 扩展点、生成式 UI 与 session 派生所有权已完成定向验证。Kimi 国内站的直接 HTTP 调用和项目实际 `@langchain/openai` 调用均返回 200。

## 验证证据

- Kimi 国内站：`GET https://api.moonshot.cn/v1/models` 返回 200 且包含 `kimi-k3`。
- Kimi Chat Completions：最小 `kimi-k3` 请求返回 200、包含 reasoning content，最终内容为 `OK`。
- LangChain：项目安装版本的 `ChatOpenAI` 使用 `https://api.moonshot.cn/v1` 返回 `OK`。
- Agent server 单元测试：4 files / 9 tests passed（配置、网关隔离、UI 校验、staff principal）。
- 共享 API contract：1 file / 13 tests passed，包含从 session 派生 principal 与伪造 owner 拒绝。
- Desktop Agent bridge：3 files / 7 tests passed（AgentService、staff token refresh、tRPC client）。
- 类型检查：API、server、desktop 均通过；desktop Svelte 为 0 errors / 0 warnings。
- Lint：API、server、desktop 均通过。
- HTTPS tRPC E2E：3 tests passed；覆盖未登录 401、phone 登录、Agent 会话持久化与 extra owner 字段 400。
- PostgreSQL migration `0005_aspiring_ghost_rider.sql` 已在本地开发库应用，并核对 5 张 Agent 表及索引存在。
- production/local Compose 配置解析通过；`git diff --check` 通过。
- `AgentPage.svelte` 经 Svelte autofixer 检查，无 issue 或 suggestion。
- draw.io MCP 已生成分层架构图与完整调用时序图；同源 Mermaid 版本收录在 `docs/agent-integration-guide.md`。

## 全仓验证说明

完成态全量单元测试曾运行并通过：desktop 69 files / 379 tests、server 19 files / 45 tests、API 1 file / 13 tests。全量流程随后在 desktop Electron E2E 的 `beforeEach -> firstWindow()` 阶段失败：E2E 专用 main/preload Vite 配置没有注入当前认证变体常量，应用在首窗前退出。临时补齐后又暴露该套用例仍按 phone 登录编写、而当前默认构建为 staff 登录；这些是既有 E2E 基础设施与当前认证变体不一致的问题。本变更未保留相关临时修改，也没有把该失败误报为通过。

## 独立 code review

- 所有公开 Agent procedure 都先解析服务端认证上下文，contract 不接受 owner 字段。
- conversation、run、event、memory 的外部访问均带当前 employee owner 谓词；消息只在 conversation owner 校验后读取。
- API Key、模型 Base URL 与 MCP header 保持 server-only，未进入 renderer、contract 或日志。
- SSE 先监听 live 再回放 PG 历史，并按事件 ID 去重，覆盖订阅建立竞态与重连。
- 生成式 UI 不执行任意代码，server 限制组件、树引用、大小和链接协议；前端 registry 没有 action。
- MCP 默认只加载命名明确的只读工具，写工具必须由部署配置显式开启。
- 未发现阻断交付的代码问题；保留限制为停止 SSE 不取消 server run，以及具体酒店 MCP/Skill 仍待业务提供。
