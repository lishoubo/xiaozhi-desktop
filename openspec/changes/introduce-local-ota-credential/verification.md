# Verification

## 自动化验证

### Domain 与定向实现验证

- `npm run test:unit --workspace @hotel-butler/desktop -- tests/unit/domain/identity.test.ts tests/unit/domain/ota-account.test.ts tests/unit/domain/ota-credential.test.ts`
  - 结果：3 个文件、21 个用例通过。
- `npm run test:unit --workspace @hotel-butler/desktop -- tests/unit/main/database/ota-credential-migration.test.ts`
  - 修订后的结果：1 个文件、2 个用例通过。
  - 覆盖：含任意旧渠道上下文的 v5 账号被直接丢弃、目标 credential/account 表为空、不存在 legacy 表、账号外键与 version 6 记录正确。
- `npm run test:unit --workspace @hotel-butler/desktop -- tests/unit/main/database/ota-credential-repository.test.ts tests/unit/main/database/ota-account-repository.test.ts`
  - 结果：2 个文件、12 个用例通过。
- `npm run test:unit --workspace @hotel-butler/desktop -- tests/unit/main/discover-and-create.test.ts`
  - 结果：1 个文件、10 个用例通过。
- `npm run test:unit --workspace @hotel-butler/desktop -- tests/unit/main/browser-handlers.test.ts tests/unit/preload/api.test.ts tests/unit/domain/ota-account-landing-url-policy.test.ts`
  - 结果：3 个文件、22 个用例通过。
- `npm run test:component --workspace @hotel-butler/desktop -- tests/component/BrowserWorkspace.test.ts`
  - 结果：1 个文件、13 个用例通过。
- `npm run check:types --workspace @hotel-butler/desktop`
  - 结果：通过。

## 迁移不变量核对

- version 6 直接删除旧结构 `ota_account`，不读取或转换旧账号数据。
- migration 创建空的 `ota_credential` 与新版 `ota_account`，并为账号建立 `credential_id` 受限外键和所需索引。
- 生产代码中不存在 legacy 行类型、解析逻辑或 `ota_account_legacy_v5` 表创建逻辑。
- migration 不调用 Electron session API，不移动或删除 partition 目录。

## 完成态质量门禁

- `npm run test:unit:desktop`
  - 修订后的结果：41 个测试文件、201 个用例通过。
- `npm run test:component`
  - 结果：12 个测试文件、52 个用例通过。
- `npm run check:desktop`
  - 结果：TypeScript 通过；Svelte 检查 0 errors、0 warnings。
- `npm run lint:desktop`
  - 结果：通过。

## 手工验证

- 按用户确认永久删除原 userData 与 `/private/tmp` 备份，从空数据目录重新启动。
- 从空 userData 执行 `npm run dev:desktop`：Electron Forge 成功构建 main、preload 和 renderer，并启动应用。
- 运行日志确认：`migrationsApplied: 6`、主窗口创建、renderer 初始化均成功。
- 对新建的 `hotel-butler.sqlite` 做只读核验：`.tables` 仅包含正式的 `ota_credential` 与新版 `ota_account` 等应用表；查询 `ota_account_legacy_v5` 数量为 0。
- 运行中重新登录/导入后生成 1 条 credential 与 1 条关联 account，证明清空旧账号后可按新模型恢复使用。

## Code review

- Domain 的 `OtaAccount` 已无 partition 字段；`OtaCredential` 是唯一登录态指针模型。
- migration 在现有事务中直接删除旧账号表并创建两个正式表；没有 legacy 表、旧数据转换或 session 清理逻辑。
- main handler 通过 read service 解析 credential，缺失或渠道不一致时明确失败，不回退共享 session。
- discovery 与 IPC 日志不记录 partition、cookie、password 或 bindExtra 内容。
- review 发现并修复：同一酒店重新发现时原实现只更新 credentialId，现改为同一操作同步更新酒店名、bindExtra 和 discoveredAt。
- 未引入 CredentialProbe、BrowserIntent、登录信息页或 RMS 接口，范围符合本 change。
- `git diff --check` 通过；生产代码全局搜索未发现 `ota_account_legacy_v5` 或旧 migration helper 残留。
