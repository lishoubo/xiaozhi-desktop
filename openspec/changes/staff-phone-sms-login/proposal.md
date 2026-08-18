## Why

酒店用户没有 RMS 员工账号，无法用现有的用户名/密码登录桌面端；rms-server 已上线短信验证码登录（登录即注册），客户端需要接上。同一个安装包要同时服务酒店用户和服务商员工，因此登录方式必须在**运行时**可切换，而不是靠构建变体二选一。

## What Changes

- `staffAuth` 通道新增两个方法：`requestPhoneCode`（发验证码）、`loginWithPhoneCode`（验证码登录），直连 rms-server，复用现有 token 栈
- 登录页在 staff 变体内做**运行时**用户类型切换：「酒店用户」（手机号+验证码，默认）/「服务商用户」（用户名+密码）
- 错误码按 rms-server 的 5 个短信错误码分别给文案，不再压成一句
- 认证请求新增 `X-App-Version` / `X-Device-Id` 两个头，device id 为本机生成并持久化的稳定 uuid
- `staffIdentitySchema` 新增 `phone` / `userType` 两字段（`strictObject`，不加则 `/api/v1/me` 解析失败）；`userType` 本期**只存不用**
- 编译期 `XIAOZHI_AUTH_VARIANT` 开关**语义不变**（仍是 `staff | phone`），旧 `phone` 变体（经 `apps/server` 的手机号登录）原样保留，不复用其代码

**非目标**：不改 token 存储/刷新/401 重试链路，不消费 `userType` 做界面分流，不动旧 `phone` 变体。

## Capabilities

### New Capabilities

无。短信登录是 `staffAuth` 体系内的第二种凭证形态，与密码登录共用 token 栈、IPC 通道和会话恢复逻辑，不构成独立能力。

### Modified Capabilities

- `staff-password-auth`: 该能力从「单一密码登录」扩展为「同一通道下密码与短信两种凭证形态」——新增短信接口契约与错误码、新增两个认证请求头、`MeResponse` 契约扩字段，并确立「登录方式在运行时选择，构建变体不再决定登录方式」这一边界

## Impact

| 层 | 文件 |
|---|---|
| 契约 | `packages/api/src/contracts.ts`（`staffIdentitySchema` 扩字段、新增 `staffPhoneCodeRequestResponseSchema`） |
| 基础设施 | `main/staff-auth/rms-auth-client.ts`、`rms-auth-errors.ts`、新增 device id 持久化 |
| 编排 | `main/services/staff-auth-service.ts` |
| 边界 | `shared/ipc-channels.ts`、`main/ipc/staff-auth-handlers.ts`、`preload/namespaces/staff-auth.ts` |
| UI | `renderer/pages/StaffLoginPage.svelte` |

**外部依赖**：rms-server 的 `/api/v1/auth/sms/request-code` 与 `/api/v1/auth/sms/login`（已上线，白名单免鉴权）。联调需手机号先在阿里云控制台绑定。

**零改动**：token store、token provider、401 重试、所有业务 gateway、`renderer/App.svelte` 会话出口 —— 前提是短信登录返回与密码登录同形状的 `TokenResponse`（服务端已按此设计）。`composition/app-scope.ts` 仅新增 device id / appVersion 两个注入参数，认证栈装配结构不变。
