## Why

酒店管理页已经完成 mock 展示，但仍不能读取 RMS 酒店与 OTA 绑定，也不能完成新增酒店、删除酒店、解绑和新增绑定。下一阶段需要在保持 Electron 凭证安全边界的前提下，把页面升级为可替换远端实现的完整业务入口，并优先打通“选择已有本地登录凭据后探测并绑定 OTA 酒店”的核心流程。

## What Changes

- 定义最小 RMS 酒店与 OTA account 投影：酒店只返回 `id/name/status`，OTA account 只返回远端 `id`、酒店与 OTA 酒店标识、渠道、状态和 `bindExtra`；不把 RMS 组织、用户名或其他账号字段带入 desktop。
- 在 desktop main 定义 `RmsHotelGateway` 与 `RmsOtaAccountGateway`，本期注入有状态 mock 实现，远端接入时替换 adapter 而不改变 renderer 流程。
- 将酒店管理页从静态 mock 改为通过 preload/IPC 加载数据，并支持新增 RMS 酒店、删除 RMS 酒店和删除 OTA 绑定。
- 实现新增绑定流程：选择同渠道的已有 `OtaCredential`，携带通用 `OtaTabIntent` 打开其本地登录态，复用 `OtaHotelProbFeature` 探测酒店，再通过 `OtaTabIntentBus` 按 intent 指定的结果回调键发布纯业务结果；酒店绑定流程持有自己的上下文，要求用户选择确认后由 main 导出 Cookie 并调用 Gateway 绑定。
- 为新增绑定引入一次性 operation 生命周期、候选事件、确认接口和幂等保护；取消、探测失败或远端失败均不得产生假绑定。
- 保留现有紧凑酒店列表样式，并补充加载、错误、空状态、确认弹窗和操作中反馈。
- 本期不实现 OTA account 重新登录、失效绑定修复或真实 RMS adapter；真实 RMS 只需在后续提供 Gateway 所要求的查询、创建、删除、绑定和解绑接口。

## Capabilities

### New Capabilities

- `hotel-management`: 查看并管理 RMS 酒店及 OTA 绑定，并使用本地已有 OTA 登录凭据创建新的远端酒店绑定。

### Modified Capabilities

无。

## Impact

- 影响 desktop 的共享 schema、domain port、main composition root、酒店管理 IPC/preload、renderer 页面与弹窗。
- 在 main `features/` 下增加通用 OTA intent、跨 Feature 事件模型与类型安全结果回调机制，并改造 `OtaHotelProbFeature` 以区分无 intent 的默认探测和显式酒店探测 intent。
- main 进程需要从指定 credential partition 导出受渠道域名白名单约束的 Cookie；Cookie 不进入 renderer、SQLite 或普通日志。
- 本期不修改 `apps/server`、RMS Java 服务或 RMS 数据库；真实接入前需要 RMS 提供匹配 Gateway 语义的接口，并先在 `packages/api` 定义共享 contract。
