## 当前进度（2026-08-06）

- 状态：21/21 项任务完成，代码、验证证据和稳定规范均已收口。
- 实现提交：`ec4831d feat(desktop): split OTA credentials from accounts`。
- 验证：desktop 单元测试 201 个、组件测试 52 个通过；TypeScript、Svelte、lint 与 OpenSpec 严格校验通过。
- 运行态：已清空旧 userData 并按新 migration 启动；SQLite 中不存在 `ota_account_legacy_v5`，重新登录/导入可生成 credential/account。
- 下一步：用户验收后归档 `introduce-local-ota-credential`；本轮不包含 CredentialProbe、BrowserIntent、登录信息页或 RMS 接口。

## 1. Domain 模型拆分

- [x] 1.1 先更新 identity/domain 定向测试：覆盖合法与非法 `OtaCredentialId`、credential 必须有 partition、account 必须有 credentialId 且不再拥有 partition；运行最小测试确认按预期失败
- [x] 1.2 新增严格 JSON value/object 类型和 `OtaCredential` 模型，改造 `OtaAccount` 为 `credentialId + otaHotel + bindExtra`，不引入 Electron、SQLite、文件系统依赖；运行 1.1 测试至通过
- [x] 1.3 更新 repository ports：新增 `OtaCredentialRepository`，将账号的 `updatePartitionName` 改为更新 credential 与酒店发现事实所需的方法；用裸 Vitest 验证 domain 零框架依赖

## 2. SQLite schema、迁移与 repository

- [x] 2.1 更新 v5 → 新 schema migration 定向测试：旧账号无论渠道和上下文均被丢弃、目标表为空且不存在 `ota_account_legacy_v5`；只运行 migration 测试确认旧实现按预期失败
- [x] 2.2 简化事务性 migration：直接删除旧 `ota_account`，创建 `ota_credential` 和目标 `ota_account` 并重建索引，不保留或转换旧数据；运行 2.1 测试至通过
- [x] 2.3 先新增 `SqliteOtaCredentialRepository` 定向测试，覆盖 create、按 ID 查询、按 partition 查询和 partition 唯一约束；实现 repository 并运行测试至通过
- [x] 2.4 更新 `SqliteOtaAccountRepository` 测试与实现，覆盖 credentialId/bindExtra 序列化、按渠道排序、按酒店查重和 credential 重指向；确认 repository 返回的 domain account 不含 partitionName

## 3. 探测落库兼容改造

- [x] 3.1 先更新三个渠道 DiscoveryProbe 的定向测试和共享 outcome 类型：抖音输出 `{ merchantGroupId }`，美团输出结构化 partner 信息，携程输出 null；运行对应测试确认旧实现失败
- [x] 3.2 改造渠道 probe 与 landing URL policy 使用结构化 `bindExtra`，保持现有 URL、网络监听、DOM 解析和触发时机不变；运行 3.1 测试至通过
- [x] 3.3 先重写 `DiscoverAndCreate` 定向测试：覆盖按 partition 复用/创建 credential、新账号引用 credential、相同酒店重指向新 credential、旧 credential/partition 不删除以及失败保留已有数据
- [x] 3.4 改造 `DiscoverAndCreate` 和 composition root 注入两个 repository；移除自动清理旧账号 partition 的依赖与路径，保持 inflight/bound、`single/none/multiple` 和通知行为不变；运行 3.3 测试至通过

## 4. 账号读取、IPC 与现有 UI 效果

- [x] 4.1 先更新 main handler/preload contract 定向测试：账号列表 DTO 包含 credentialId、bindExtra 和 main 投影的兼容 partitionName；打开账号与“从其他登录态创建”均须通过 credential repository 解析 partition；缺失 credential 明确报错
- [x] 4.2 增加 main 侧账号 DTO mapper/read service 并改造 browser handlers，禁止 handler 或 domain account 直接读取 partitionName；运行 4.1 测试至通过
- [x] 4.3 更新共享 schema、preload 类型和 renderer 调用点，将 `channelContext` 改为 `bindExtra`，保留现有账号列表、排序、激活标签和打开账号交互；运行受影响的 preload 与 BrowserWorkspace/AccountsNav 组件测试
- [x] 4.4 全局搜索生产代码，确认 `OtaAccount.partitionName`、`channelContext`、`updatePartitionName` 和旧 session 删除路径无残留；允许的 `partitionName` 仅限 credential、browser/session、pending partition 与兼容 DTO mapper

## 5. 验证与质量门禁

- [x] 5.1 迭代态完成后运行受影响 desktop 模块测试并修复回归；按照测试规范不在此前重复运行全量套件
- [x] 5.2 独立 verification pass：使用从 v5 schema 构造的临时数据库核对旧账号被丢弃、目标表为空、外键正确且无 legacy 表，并把证据写入本 change 的 `verification.md`
- [x] 5.3 清理本应用开发数据并启动 desktop，验证重新登录或 cookie 导入后可按新模型生成 credential/account 并正常打开账号；将运行证据写入 `verification.md`
- [x] 5.4 完成态仅运行一次 desktop 全量质量门禁（单元/组件测试、类型检查、Svelte 检查和 lint），如实记录命令与结果
- [x] 5.5 独立 code-review pass：重点审查 domain 是否重新混入 partition、migration 是否彻底移除 legacy 表、错误是否保留 cause、日志是否泄露 partition/bindExtra，以及是否出现超出本 change 的 intent/probe/UI/RMS 改造
- [x] 5.6 根据架构完成门禁，将本 change 的 `local-ota-credentials` delta spec 同步到稳定 specs 后再归档；未实现或验证前不得提前同步
