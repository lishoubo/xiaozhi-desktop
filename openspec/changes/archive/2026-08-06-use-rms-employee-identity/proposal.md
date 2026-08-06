## Why

桌面端当前仅在本机保存手机号会话，服务端 PostgreSQL 还维护一套可由管理后台查询和停用的 `desktop_user` 数据。这与 RMS 已经拥有员工身份事实来源的现状重复，容易产生账号存在性、启停状态和展示信息不一致。

本地开发的 RMS MySQL 目前只创建空数据库，新增的 `apps/server/rms-schema.sql` 没有自动导入，开发者无法在首次启动后直接针对真实 RMS 表结构编写和验证只读查询。

## What Changes

- 本地 Compose 的 RMS MySQL 仅在数据目录首次初始化时自动导入 `apps/server/rms-schema.sql`；已有数据卷不重复导入，生产 Compose 不使用该文件。
- 新增共享 tRPC 员工身份查询 contract，并由 server 使用参数化 SQL 从 RMS `employee` 表查询启用员工。
- 员工身份响应只包含 desktop 所需的安全字段，不返回 `password_hash`；MySQL bigint 主键以字符串传输。
- phone OTP 本次视为已经通过；接口按手机号解析员工身份，但 desktop 本轮不接入该接口，也不新增服务端会话。
- 删除 PostgreSQL `desktop_user` 表、相关查询服务、后台管理路由和后台用户概览。
- 保留 PostgreSQL 中 Better Auth 的管理员表与现有管理后台登录流程。

## Capabilities

### New Capabilities

- `rms-employee-identity`: 以 RMS `employee` 作为 desktop 员工身份事实来源，并提供安全的只读身份查询。
- `local-rms-schema-bootstrap`: 本地 RMS MySQL 首次初始化时加载开发查询所需 schema。

### Modified Capabilities

- `workspace-architecture`: 明确 desktop 身份来自 RMS，PostgreSQL 仅保留管理后台身份和本系统数据。

## Impact

- 影响 `packages/api` 的共享 tRPC contract、server tRPC context、RMS 查询适配器和 E2E 数据准备。
- 影响本地 `compose.local.yaml`，不影响 `compose.production.yaml`。
- 新增 PostgreSQL 迁移以删除 `desktop_user`，不删除管理员 Better Auth 表。
- 移除 server 管理后台的桌面用户导航、页面、服务和相关测试，并将 Dashboard 改为不包含用户数据的后台入口页。
- desktop 仅获得可供后续调用的共享接口类型，本次不修改登录 UI 或本地会话行为。
