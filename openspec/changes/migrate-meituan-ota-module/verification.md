## Verification Pass

日期：2026-08-06

范围仅包含美团渠道迁移、`OtaCredential.channelAccountId` 与对应 SQLite/repository 行为。
本 pass 不承担代码风格 review，也未迁移抖音或携程。

## 结果

| 验收点 | 证据 | 结果 |
|---|---|---|
| v6 credential 升级后保留，新字段为空且存在普通联合索引 | `ota-credential-migration.test.ts` | 通过 |
| credential 可保存、查询并仅更新渠道账号身份 | domain/repository 定向测试 | 通过 |
| 美团账号详情校验 `bizAcctId`，只输出白名单字段 | `meituan-account-identity.test.ts` | 通过 |
| `poiInfos` 映射全部有效酒店与合作方上下文 | `meituan-poi-infos.test.ts` | 通过 |
| 美团显式调用、创建/刷新 credential、多酒店 upsert、失败不写入 | `discover-and-create.test.ts` | 通过 |
| pending partition 与 renderer 通知在多酒店结果中各执行一次 | `discover-and-create.test.ts` | 通过 |
| 美团模块不反向依赖 `account-discovery` | 对 `main/ota` 的 import 搜索 | 通过 |
| 抖音、携程实现仍位于原 discovery 目录并由原 registry 管理 | 文件清单与 `discovery-probe.ts` | 通过 |
| 原始美团响应、账号详情诊断和 `console` 日志已移除 | 生产代码关键字搜索 | 通过 |

## 命令证据

定向测试：

```text
npm --workspace @hotel-butler/desktop run test:unit -- \
  tests/unit/domain/ota-credential.test.ts \
  tests/unit/main/database/ota-credential-migration.test.ts \
  tests/unit/main/database/ota-credential-repository.test.ts \
  tests/unit/main/database/ota-account-repository.test.ts \
  tests/unit/main/discover-and-create.test.ts \
  tests/unit/main/meituan-account-identity.test.ts \
  tests/unit/main/meituan-poi-infos.test.ts \
  tests/unit/main/browser-handlers.test.ts
```

结果：8 个测试文件、48 个用例通过。

类型检查：

```text
npm --workspace @hotel-butler/desktop run check:types
```

结果：退出码 0。

依赖与日志边界检查：

```text
rg -n "from '../../account-discovery|from '../account-discovery|ChannelAdapter|Meituan poiInfos raw response|account detail diagnostic|console\." \
  apps/desktop/src/main/ota apps/desktop/src/main/account-discovery --glob '*.ts'
```

结果：无匹配。

## 尚未包含

- 本 pass 没有用真实美团账号重新走一次运行态登录。接口链路已在本次实现前通过踩点验证，
  但新落库链路仍需用户运行态验收。

## 完成态质量门禁

- desktop 全量 unit 首次运行：43 个文件中 42 个通过，212 个用例中 211 个通过；唯一失败
  是 `calendar-database.test.ts` 仍断言 migration 数量为 6。
- 将该测试中的 schema migration 总数和初始化日志断言更新为 7 后，定向重跑该文件：
  4/4 用例通过。按“完成态全量只跑一次”规则，没有重复运行全量 unit。
- desktop component：12 个文件、52 个用例通过。
- `npm --workspace @hotel-butler/desktop run check`：通过；Svelte 0 errors、0 warnings。
- `npm --workspace @hotel-butler/desktop run lint`：通过。

## Code Review Pass

审查重点：领域不变量、数据库更新语义、敏感日志、Electron view 清理、依赖方向和范围控制。

发现并修复：

1. 美团 `poi-infos` 最初反向引用 `account-discovery` 的结果类型；已将酒店结果类型收回
   `main/ota/meituan`，恢复“功能模块 → 渠道模块 → 通用基础能力”的依赖方向。
2. `channelAccountId` 最初允许空白字符串，repository 更新也可能将其落库；已在 domain
   拒绝空白值，并让 repository 在执行 SQL 前复用 domain 校验，失败时保留原记录。
3. 补充同源脚本候选列表解析测试，验证会跳过失败候选并选取首个可校验账号。

review 修复后的定向证据：domain/repository 9 个用例通过，美团账号身份 4 个用例通过；
Node TypeScript、定向 ESLint、`git diff --check` 和敏感日志关键字检查均通过。未发现剩余的
高优先级问题。
