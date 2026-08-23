## Context

仓库当前有三个跨进程 seam：

```text
renderer --IPC--> Electron main --tRPC/HTTPS--> SvelteKit server
                                      |
                              @hotel-butler/api
```

`@hotel-butler/api` 同时承担两类职责：

1. 可传输 contract：Zod schema、DTO、事件、输入输出类型
2. server transport/application implementation：`ApiContext`、OTP/员工/session port、鉴权中间件、登录工作流、tRPC router

tRPC 11.18 的标准类型链要求客户端持有 `typeof appRouter` 的 type projection。把真实 router 直接搬到 `apps/server` 会迫使 desktop type-import server，或引入额外代码生成。因此本设计不追求物理上“router 文件必须在 server”，而追求调用方只学习正确 interface，server 工作流具有 locality。

## Goals / Non-Goals

**Goals:**

- 让静态门禁与规范陈述一致
- 默认共享入口只表达跨进程数据 contract
- tRPC transport adapter 只负责 seam 工作，不拥有登录和身份业务编排
- 保持 public Agent interface、网络路径、IPC channel 和用户行为稳定
- 深化 Agent server 与 renderer 模块，减少调用方必须了解的状态和顺序

**Non-Goals:**

- 不替换 tRPC，不引入 OpenAPI/codegen/ts-rest 等第二套 contract 系统
- 不修改数据库 schema、Agent prompt、业务意图或酒店数据规则
- 不重新设计 UI
- 不为只有一个生产实现且无需测试替换的依赖新增 port

## Decision 1: 可序列化 contract 的判据

允许放在默认 `@hotel-butler/api` 入口：

- Zod input/output schema
- `Readonly<z.infer<...>>` DTO
- 字符串/数字/布尔/null、数组与普通 object 组成的事件
- 稳定错误码和 capability 枚举
- desktop 创建 typed tRPC client 所需的 `AppRouter` type-only projection

不得从默认入口暴露：

- logger、repository、database、gateway 实例
- `Request`、`Response`、cookie writer
- 函数回调、class 实例、`AbortSignal`、`AsyncIterable`
- server request context 与认证 principal resolver

`AppRouter` 自身不是“被传输的数据”；它是 TypeScript 对 transport interface 的类型投影。desktop 对它的 type-only import 不产生运行时依赖，作为 tRPC 的必要例外保留。

## Decision 2: 共享 router 是 transport adapter，不是业务模块

新增显式 server-only 子路径 `@hotel-butler/api/router`，包含 tRPC router、transport middleware 和最小 endpoint interface。默认入口不再导出 `ApiContext`、logger 或 server port。

router 的 procedure 只允许：

1. Zod 验证输入/输出
2. 调用一个 request-scoped endpoint module 方法
3. 将 endpoint error 映射成 TRPC error
4. 记录 transport 完成信息

OTP 验证、员工查询、session 签发、principal 解析和健康能力组装迁移到 `apps/server` 的 request endpoint module。该 module 闭包持有本请求的 session 与身份资源，router 不认识 repository 或第三方 adapter。

这与 desktop IPC 的设计相同：transport adapter 可以浅，因为 trust seam 本身有价值；业务深度在 seam 后面的 module。

## Decision 3: desktop 静态门禁按目录表达

- ESLint 正式解析 `.svelte`
- renderer 的 `.ts`、`.svelte.ts` 和 `.svelte` 均禁止 import `main/**`
- `shared/**` 禁止 import `main/**`、`renderer/**`
- `main/ipc/**`、`main/services/**`、`main/channels/**` 维持既有目录约束
- 非 composition 文件禁止 import 被标记为生产实现入口的模块；内部 helper 的 `new` 不算 composition wiring
- 生产实现不得通过默认构造参数自行创建另一个生产 adapter

`BrowserManager` 的默认 `new SessionFactory(logger)` 删除；测试显式传入 fake 或 test builder。

## Decision 4: AppScope 与 WindowScope 用一个显式注册 seam

用单个 `WindowCapabilityRegistry` 取代 `setPartitionRetirer` 与 `setAccountBoundNotifier`：

```ts
interface WindowCapabilities {
  retirePartition(partitionName: string): Promise<void>;
  notifyAccountBound(channel: ChannelId): void;
}

interface WindowCapabilityRegistry {
  attach(capabilities: WindowCapabilities): Disposable;
  current(): WindowCapabilities | null;
}
```

registry 是进程内依赖，不暴露给 renderer。`createWindowScope` attach，dispose 时由返回句柄 detach；重复 attach 或错误顺序明确失败。调用窗口能力的进程模块通过 registry 得到显式的“当前无窗口”结果，不再依赖多个 setter 的隐含顺序。

## Decision 5: 保留 Agent 外部 seam，拆内部执行 seam

`AgentGateway` 的外部方法和 contract 不变。内部至少形成三个私有模块：

- `RunLifecycle`: start/retry/cancel、active controller、恢复
- `BusinessExecution`: route、slot、clarification、workflow collection、answer transition
- `RunEventStream`: event 持久化、replay/live 合并、publish/logging

它们只在 `apps/server/src/lib/server/agent/` 内可见，由 server composition 装配。优先抽取已有独立状态机和事件行为，不把 repository 的全部方法重新暴露成大 port。

测试以 `AgentGateway` interface 为主；对并发、状态转换等复杂内部 seam 保留定向测试。纯 pass-through 私有模块不单独测试。

## Decision 6: Agent renderer controller 是实例级 deep module

新增 factory 创建页面实例级 controller，持有：

- conversation cache 与 active selection
- Run stream event reduction
- initialize/open/start/retry/cancel/delete/clarification 编排
- loading、pending 与 user-safe error 状态

页面仍持有 DOM 引用、ResizeObserver、scroll-follow 和弹窗展示状态。controller 接受一个窄的 desktop Agent adapter，不直接读取全局 `window`，测试使用 in-memory adapter。

不导出全局 singleton，避免测试和未来多窗口之间泄漏状态。现有 `agent-conversation-state.ts` 继续作为纯状态实现，controller 通过它工作。

## Decision 7: 分阶段迁移

1. 先让 lint 门禁真实生效
2. 收敛 `packages/api` 导出与 server endpoint module
3. 拆 Agent server 内部实现
4. 替换 scope callback setter
5. 提取 renderer controller

每阶段保持可编译、定向测试可运行。公共 contract 字段不在本变更中改变，因此无需兼容期双写。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| `.svelte` lint 首次启用暴露大量既有问题 | 先只启用分层与必要 parser；格式/风格问题不借机扩大范围 |
| tRPC router 拆分破坏类型推导 | 保留 `AppRouter = typeof appRouter`，增加 compile-time contract test |
| request-scoped endpoint module 增加对象创建 | module 只保存窄引用，昂贵 adapter 继续进程级复用 |
| Agent 拆分时改变异步时序 | 先用现有 gateway 测试锁定事件顺序、取消和恢复，再移动实现 |
| controller 提取改变滚动或订阅清理 | DOM 行为留在页面，增加 controller 生命周期测试与既有 E2E |

## Migration / Rollback

无数据迁移。每阶段为结构重构，可按阶段 revert。网络 path、cookie、IPC channel 和持久化格式保持不变。
