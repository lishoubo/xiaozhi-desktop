## Why

`IPC_CHANNELS.otaAccount.*` 这个命名空间目前混杂了两类不同性质的方法：真正操作
`OtaAccount` 记录的方法（现已确认全部无 renderer 调用点，是死代码/孤儿组件），以及
"发起登录、返回 `BrowserTab`"这类和 `OtaAccount` 数据模型无关的机制层方法（`startLogin`
`createFromCookie`）。这个分组名字撞了 domain 模型名，容易让人误以为 `otaAccount.*`
下的方法都在读写 `OtaAccount` 记录，实际不是。现有账号切换器
（`AccountSwitcherDialog.svelte`）早已只展示 `OtaCredential`，`otaAccount.onAccountBound`
事件的唯一消费者也是刷新 `OtaCredential` 列表，说明这几个仍在使用的方法本质上服务的是
"登录凭据/登录动作"，该收敛到 `otaCredential.*` 下并按实际功能重新命名，而不是继续
挂靠一个名不副实的分组。

## What Changes

- 迁移三个仍在使用的方法到 `otaCredential.*` 命名空间，并按实际功能重命名：
  - `otaAccount.startLogin` → `otaCredential.openForNewLogin`
  - `otaAccount.createFromCookie` → `otaCredential.openWithImportedCookie`
  - `otaAccount.onAccountBound` → `otaCredential.onDiscoveryCompleted`
- **BREAKING**（仅限桌面应用内部 IPC 契约，不影响外部系统）：删除三个已确认无
  renderer 调用点的死代码方法及其 IPC 频道：
  - `otaAccount.listByChannel`
  - `otaAccount.openExisting`
  - `otaAccount.createFromExistingSession`
- 删除上述死代码方法背后唯一的调用来源、且自身也无任何页面引用的孤儿组件：
  - `apps/desktop/src/renderer/components/browser/SelectOtherHotelPanel.svelte`
  - `apps/desktop/src/renderer/components/browser/AccountsNav.svelte`
- 同步更新 `shared/ipc-channels.ts`、`shared/browser.ts`（相关 schema/类型）、
  `preload/api.ts`（`DesktopApi` 类型与具体实现）、
  `main/ipc/browser-handlers.ts`（handler 注册）、以及所有 renderer 调用点
  （`BrowserWorkspace.svelte`、`CookieLoginListDialog.svelte`）。
- `domain/ota-account.ts`、`domain/ports/repositories.ts` 里的
  `OtaAccountRepository`、`main/database/ota-account-repository.ts` 的 SQLite
  实现均保留不动——`OtaAccount` 的写入路径（`DiscoverAndCreate` 内部
  `upsertAccount()`）继续正常工作，只是不再通过 IPC 对外暴露读取。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无——本次改动不涉及 `OtaCredential`/`OtaAccount` 的持久化模型、归并规则或探测逻辑，
纯粹是 IPC 方法的命名空间调整与死代码清理，不改变系统对外行为，已在 `.openspec.yaml`
设置 `skip_specs: true`。）

## Impact

- **Affected files**（预计）：
  - `apps/desktop/src/shared/ipc-channels.ts`
  - `apps/desktop/src/shared/browser.ts`
  - `apps/desktop/src/preload/api.ts`
  - `apps/desktop/src/main/ipc/browser-handlers.ts`
  - `apps/desktop/src/renderer/components/browser/BrowserWorkspace.svelte`
  - `apps/desktop/src/renderer/components/browser/CookieLoginListDialog.svelte`
  - `apps/desktop/src/renderer/components/browser/SelectOtherHotelPanel.svelte`（删除）
  - `apps/desktop/src/renderer/components/browser/AccountsNav.svelte`（删除）
- **不受影响**：`domain/ota-account.ts`、`domain/ports/repositories.ts`、
  `main/database/ota-account-repository.ts`、`main/account-discovery/discover-and-create.ts`
  内部的探测、归并、upsert 逻辑；`OtaCredential` 相关的持久化行为。
- **风险**：桌面应用内部 IPC 契约变更，仅影响 main↔renderer 两端自身代码，不涉及外部
  API 或跨应用契约，风险可控。
