## Why

当前仓库的部署边界清楚，但若干模块 seam 的代码事实与治理规则已经出现偏差：desktop lint 没有处理 `.svelte`，composition-root 规则只拦截少数具体 import；`packages/api` 同时放置可传输 contract、tRPC 传输声明、server 身份 port 与登录工作流；`HotelAgentGateway` 和 `AgentPage.svelte` 分别集中承载过多 server 执行编排与 renderer 页面编排；进程级 `AppScope` 还通过 setter 回填窗口级能力，形成类型未表达的时间耦合。

这些问题暂未形成循环依赖，但会让下一次跨端 Agent 或 OTA 改动需要同时理解过多实现细节，并让文档声称的 lint 门禁产生错误安全感。

## What Changes

- 补齐 desktop `.svelte` lint 与目录级依赖门禁；移除实现模块内部创建生产依赖的默认构造路径
- 收敛 `@hotel-butler/api` 的公开面：默认入口只暴露可传输 schema、DTO、事件和客户端所需的 router 类型；server-only tRPC transport 声明使用显式子路径
- 将手机号登录、session、身份目录等 server 工作流和 port 移到 `apps/server`，共享 tRPC router 只做验证、鉴权 seam、调用一个 request-scoped endpoint module 与传输错误映射
- 保留现有外部 Agent contract，把 `HotelAgentGateway` 内部的 Run 生命周期、业务执行和事件流拆成私有深模块
- 用显式窗口能力注册句柄替代 `AppScope` 的多个 callback setter，收窄两级 scope 的 interface
- 把 `AgentPage.svelte` 的异步会话/Run 编排收进实例级 renderer controller，页面保留展示与 DOM 交互
- 删除被新 interface 测试替代的浅层重复测试，保留 adapter、状态机与信任 seam 的高价值测试

## Clarification: serializable contract

本变更所说的“可序列化 contract”是能跨 HTTPS/tRPC、Electron IPC 或 structured clone 传输的数据形状：Zod 输入输出 schema、由 schema 推导的只读 DTO、判别联合事件以及稳定错误码。它不包含 logger、数据库连接、repository、`Request`/`Response`、函数、class 实例、`AbortSignal` 或 `AsyncIterable` 等进程内能力。

desktop 当前确实只通过 tRPC 调用 server，并且 `AppRouter` 是 type-only import；不存在把 server resolver 打进 desktop 运行时代码的问题。当前问题是共享 package 的所有权过宽：同一个 `router.ts` 还实现了 OTP 验证、员工查询、session 签发与错误处理。迁移目标是去掉这部分 server 工作流，不是否定现有 tRPC 类型安全。

## Capabilities

### Modified Capabilities

- `workspace-architecture`: 明确共享 contract、tRPC transport 声明与 server 工作流的所有权；禁止 desktop 依赖 server context port
- `desktop-main-layering`: lint 覆盖 Svelte 文件、composition root 规则覆盖目录依赖，并以显式注册句柄表达跨 scope 生命周期
- `hotel-agent-runtime`: 保持外部 contract 稳定，把执行编排拆为 server 私有内部 seam，并把 renderer 编排放入实例级 controller

## Impact

| 范围 | 影响 |
|---|---|
| `packages/api` | 导出面与 router context 形状调整；公开 DTO/事件保持兼容 |
| `apps/server` | 新增 tRPC request endpoint module 与 Agent 内部执行模块；endpoint 装配迁移 |
| `apps/desktop/src/main` | lint、composition scope、tRPC adapter 类型依赖调整 |
| `apps/desktop/src/renderer` | Agent 页面 controller 提取；用户可见行为不变 |
| 测试 | contract、lint 反向验证、server endpoint module、Agent gateway、renderer controller |
| 稳定规范 | 验证通过后同步三个 capability spec |

本变更不改变数据库 schema、网络路径、认证产品行为、Agent contract 字段或 UI 视觉设计。
