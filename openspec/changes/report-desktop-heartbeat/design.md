## Context

见 `proposal.md`。桌面端认证客户端已在认证请求中携带 `X-App-Version` 和 `X-Device-Id`；`GET /api/v1/me` 用于查询用户信息。RMS 位于另一项目，本方案仅规定桌面端如何调用独立上报接口。

## Goals / Non-Goals

**Goals:** 桌面端每隔约一小时向独立接口发送一次存活与版本上报，不触发登录。

**Non-Goals:** 秒级在线状态、重新登录、为心跳单独设计凭证刷新机制、修改 `/me` 行为、服务端存储与管理端展示的实现。

## Decisions

### 1. 独立的定期上报接口

桌面端调用预期由 RMS 提供的 `POST /api/v1/app/heartbeat`，沿用现有 Bearer 认证、`X-App-Version` 和 `X-Device-Id`，不发送登录凭证或请求体。路径已表达心跳类型，不再添加 `X-Report-Type`。客户端按标准成功响应判断调用结果；接口服务端需求单独记录在 `docs/rms-heartbeat-server-requirements.md`。`GET /api/v1/me` 仍用于查询身份。

### 2. 独立的进程级调度服务，登录后立即上报

在 `apps/desktop/src/main/services/` 下建立独立的心跳调度服务，由 `composition/app-scope.ts` 创建并持有一份，退出应用时随 app scope 一起释放。它与现有 `InventoryScanDispatcher` 的生命周期一致，但不复用渠道扫描器。窗口关闭及 macOS 重开窗口不创建第二个调度器。

`window-scope.ts` 中现有的认证身份确认回调覆盖密码登录、短信登录与恢复会话，可通知进程级服务立即首报；登出成功或本地会话被清除时停止。调度使用 `setTimeout` fixed-delay：上次请求结束后才排下一次，避免请求重叠。读取 access token 继续走既有 token provider。网络失败只记结构化日志，后续周期照常尝试，不因一次上报失败清除本地会话。

在 `app-config/types.ts`、`defaults.ts` 增加 `heartbeat: { intervalMs }`，默认 `60 * 60_000` 毫秒；每轮排下一次时读取 `appConfig.get().heartbeat.intervalMs`，不与 `inventoryScan.idleMs` 共用。非法间隔按至少 30 秒的安全下限处理。本次只使用 appConfig 既有默认值层。

## Risks / Trade-offs

- 应用休眠、断网或强制退出会暂停或终止上报；恢复运行并保持登录后继续按调度上报。
- 老版本客户端不会调用新接口；服务端应兼容，见独立需求文档。
- 当前本仓库已有基于 `/me` 的未完成桌面端实现；后续实施须将其改为新接口，旧实现不能按本方案交付。

## Migration Plan

桌面端发布依赖新接口先行可用；本仓库不实施或部署服务端。旧版桌面端不调用新接口，现有 `/me` 行为不变。
