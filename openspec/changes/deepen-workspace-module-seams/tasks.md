## 1. 静态门禁（TDD）

- [x] 1.1 增加 lint fixture/反向测试，证明 `.svelte` renderer import `main/**` 会失败
- [x] 1.2 配置 desktop ESLint 解析 `.svelte`，不引入无关风格整改
- [x] 1.3 增加 composition-root 目录约束测试，覆盖生产实现 import
- [x] 1.4 删除 `BrowserManager` 默认创建 `SessionFactory` 的路径并更新测试 builder
- [x] 1.5 运行 desktop lint 与相关定向测试

## 2. 共享 contract 与 server endpoint module（TDD）

- [x] 2.1 增加 package export 测试，锁定默认入口只暴露客户端 contract 与 `AppRouter` type
- [x] 2.2 建立 `@hotel-butler/api/router` server-only 子路径
- [x] 2.3 在 `apps/server` 建立 request-scoped auth/system endpoint module 测试
- [x] 2.4 将 OTP、员工查询、session 签发和 server error 编排迁移到 endpoint module
- [x] 2.5 将 tRPC procedure 收敛为验证、单次 module 调用和传输映射
- [x] 2.6 调整 desktop/server imports，确认 desktop 无 server context/port import
- [x] 2.7 运行 api router、server auth、desktop tRPC 定向测试

## 3. Agent server 深化（TDD）

- [x] 3.1 用现有 gateway 测试锁定 Run start/retry/cancel/recovery 和事件 replay 时序
- [x] 3.2 提取 `RunEventStream` 内部模块并通过 gateway interface 验证
- [x] 3.3 提取 `RunLifecycle` 内部模块并通过 gateway interface 验证
- [x] 3.4 提取 `BusinessExecution` 内部模块并通过 gateway interface 验证
- [x] 3.5 删除被 gateway interface 测试替代的浅层重复测试
- [x] 3.6 运行 Agent gateway/runtime/业务执行定向测试

## 4. Desktop scope seam（TDD）

- [x] 4.1 为 `WindowCapabilityRegistry` 编写 attach/detach/重复注册/无窗口测试
- [x] 4.2 实现 registry，以单个显式句柄替代两个 callback setter
- [x] 4.3 收窄 `AppScope` 对 `WindowScope` 暴露的 interface，优先暴露能力而非具体类
- [x] 4.4 运行 composition、partition、credential 与窗口清理定向测试

## 5. Agent renderer controller（TDD）

- [x] 5.1 加载 Svelte 5 项目技能与当前版本官方文档
- [x] 5.2 为实例级 controller 编写 initialize/open/start/retry/cancel/delete/stream 生命周期测试
- [x] 5.3 提取 controller，复用 `agent-conversation-state.ts`，通过窄 adapter 注入 IPC 能力
- [x] 5.4 将 `AgentPage.svelte` 收敛为展示、DOM/滚动和 controller 事件绑定
- [x] 5.5 对修改后的 Svelte 文件运行 autofixer，直到无 issue；记录无法消除的建议原因
- [x] 5.6 运行 renderer Agent 定向单元测试和相关 desktop E2E

## 6. 验证与规范收敛

- [x] 6.1 全仓搜索 desktop 对 server context/port 与 renderer 对 main 的违规依赖
- [x] 6.2 迭代完成后只运行一次全仓 `npm run verify`
- [x] 6.3 独立 verification pass，写入 `verification.md`
- [x] 6.4 独立 code-review pass，分别检查 Standards 与 Spec
- [x] 6.5 将三个 delta 合并进稳定 specs，确认单个 spec 大小约束
- [x] 6.6 汇报行为兼容性、验证证据和未验证项
