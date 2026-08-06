## Context

server 同时连接 PostgreSQL 与只读 RMS MySQL。PostgreSQL 中的 `admin_*` 表由 Better Auth 服务管理后台登录，`desktop_user` 则是此前为桌面手机号用户单独建立的副本。desktop 已有 Electron main 内的 tRPC client，但当前登录仍是 renderer 本地 mock；用户明确允许 phone OTP 暂时默认通过，并要求先提供员工信息接口而不确定 desktop 的消费位置。

`apps/server/rms-schema.sql` 是包含 `rms` 与 `rms_data` 表结构的 MySQL dump。MySQL 官方镜像只会在数据目录为空时执行 `/docker-entrypoint-initdb.d` 下的脚本，这正好提供“未初始化时导入、已初始化时跳过”的幂等边界。

## Goals / Non-Goals

**Goals:**

- 让本地 RMS 容器首次启动后具备 dump 中的真实表结构。
- 以 RMS `employee` 的启用记录确认 desktop 手机号对应的身份。
- 让共享 API 明确约束输入和安全输出，避免泄漏密码哈希或不安全地序列化 bigint。
- 删除本系统对 desktop 用户的 PostgreSQL 副本和管理能力。
- 保持管理后台管理员认证和现有生产 RMS 连接方式不变。

**Non-Goals:**

- 不实现短信发送、OTP 校验、access token、服务端 desktop session 或权限授权。
- 不把 employee 数据复制到 PostgreSQL，也不允许 server 写 RMS。
- 不在本次把新接口接入 desktop 登录页、preload 或 IPC。
- 不删除 Better Auth 管理员所需的 `admin_user`、`admin_session`、`admin_account`、`admin_verification`。

## Decisions

### 1. 使用 MySQL 官方首次初始化目录

`compose.local.yaml` 将 `./rms-schema.sql` 只读挂载到 RMS 容器的 `/docker-entrypoint-initdb.d/001-rms-schema.sql`。脚本执行时机由 MySQL 镜像的数据目录初始化流程控制；`rmsdata` 已有数据时不会再次执行，因此不会触发 dump 中的 `DROP TABLE IF EXISTS`。生产 Compose 不增加挂载。

E2E MySQL 也从同一文件初始化，以防测试使用的表结构与本地开发漂移；测试随后插入最小的启用 employee fixture。

### 2. 共享 contract 通过 context port 连接 server 实现

`packages/api` 定义手机号输入、`EmployeeIdentity` 输出 schema 和 `identity.employeeByPhone` query。`ApiContext` 只声明 `employeeDirectory.findActiveByPhone(phone)` 端口，不 import MySQL 或 server 文件。server 的 tRPC handler 将 RMS 实现注入 context，desktop 继续只依赖共享 `AppRouter` 类型。

接口返回 `EmployeeIdentity | null`：启用员工返回身份，手机号不存在或员工停用均返回 `null`。该统一结果便于当前 OTP 后的存在性确认，也避免向调用方区分“未找到”和“已停用”。

### 3. RMS 查询保持只读、参数化和最小字段

server 使用 mysql2 pool 的参数占位符查询：按 `phone` 和 `status = 1` 过滤并 `LIMIT 1`。只选择 `id`、`org_id`、`username`、`full_name`、`phone`、`role_code`；不选择 `password_hash`。pool 开启 bigint 字符串模式，contract 将 `id`、`orgId` 定义为十进制字符串，避免 JavaScript 精度丢失。

### 4. PostgreSQL 只删除 desktop 用户副本

Drizzle schema 移除 `desktop_user` 并生成向前迁移 `DROP TABLE desktop_user`。同时删除 desktop 用户列表/状态更新服务、管理页面和 E2E 用例。Better Auth 管理员表继续保留，因为后台仍需要 PostgreSQL 管理员身份。

Dashboard 不再统计或列出 desktop 用户，改为静态的管理后台入口说明；管理员保护仍由 `/admin` layout 执行。

## Risks / Trade-offs

- [OTP 暂无真实校验，公开手机号查询可被滥用] → contract 明确这是临时边界；本次不返回敏感字段，缺失和停用统一返回 `null`。接入真实登录前必须在调用该 query 前建立 OTP 凭证或受保护 context。
- [dump 含 `DROP TABLE`] → 只挂载到官方首次初始化目录，不提供运行时重复导入命令；已有数据卷不会执行。
- [RMS bigint 超过安全整数] → mysql2 强制返回字符串，API schema 禁止 number。
- [员工手机号可能不唯一] → 当前 RMS schema 未声明唯一索引，查询使用稳定的主键升序并 `LIMIT 1`；后续应在 RMS 事实规范中确立手机号唯一性。本次不写外部数据库 schema。
- [删除 desktop_user 会丢失本地管理状态] → 这是需求指定的数据源切换，迁移不可逆恢复；管理员数据不受影响。

## Migration Plan

1. 先发布共享 contract、RMS 只读实现与测试。
2. 生成并执行 PostgreSQL 向前迁移，删除 `desktop_user`。
3. 移除管理后台用户入口和查询代码。
4. 本地开发新建 RMS 数据卷时由 MySQL 自动加载 dump；已有卷保持原状。如开发者希望重新导入，必须自行明确删除对应本地卷，本任务不自动执行。
5. 回滚应用代码时可恢复旧页面与 schema 定义，但已执行的 `desktop_user` 删除迁移不会自动恢复历史数据。
