## 1. shared 层：频道定义与类型

- [x] 1.1 `shared/ipc-channels.ts`：在 `otaCredential` 分组下新增
      `openForNewLogin`、`openWithImportedCookie`、`discoveryCompleted` 三个频道；
      从 `otaAccount` 分组删除 `startLogin`、`createFromCookie`、`accountBound`、
      `listByChannel`、`openExisting`、`createFromExistingSession` 六个频道
- [x] 1.2 `shared/browser.ts`：`otaAccountBoundEventSchema`/`OtaAccountBoundEvent`
      改名为 `otaDiscoveryCompletedEventSchema`/`OtaDiscoveryCompletedEvent`；删除
      `otaAccountChannelSchema`、`otaAccountIdSchema`、
      `createFromExistingSessionInputSchema`/`CreateFromExistingSessionInput`、
      `otaAccountSchema`/`OtaAccountDto`（均确认无其他调用方后删除）

## 2. main 层：handler 实现

- [x] 2.1 `main/ipc/browser-handlers.ts`：`startLogin`/`createFromCookie` 两个
      handler 的注册频道改为 `IPC_CHANNELS.otaCredential.openForNewLogin`/
      `openWithImportedCookie`，内部调用逻辑不变
- [x] 2.2 `main/application.ts` 里 `onAccountBound` 回调改为发送
      `IPC_CHANNELS.otaCredential.discoveryCompleted`
- [x] 2.3 删除 `otaAccount.listByChannel`/`openExisting`/`createFromExistingSession`
      三个 handler 的注册代码
- [x] 2.4 确认 `OtaAccountReadService` 零调用点后直接删除该文件（用户确认："直接
      删除这个文件"）；连带清理了同样零调用点的 `otaAccountLandingUrl` 函数
      （`domain/policy/ota-account-landing-url-policy.ts`，超出原计划范围，是
      实施过程中发现的连带死代码）
- [x] 2.4a（新增，原计划外）：`main/application.ts` 里 `registerBrowserHandlers(...)`
      调用点删除多余的 `otaAccountRepository` 参数传递（`registerBrowserHandlers`
      的参数类型已不再声明该字段）

## 3. preload 层：DesktopApi 契约

- [x] 3.1 `preload/api.ts`：`DesktopApi` 类型定义里，`otaAccount.startLogin`/
      `createFromCookie`/`onAccountBound` 三个方法签名移到 `otaCredential` 分组下，
      改名为 `openForNewLogin`/`openWithImportedCookie`/`onDiscoveryCompleted`
- [x] 3.2 同步修改具体实现对象（`Object.freeze({...})`），迁移三个方法实现
- [x] 3.3 删除 `listByChannel`/`openExisting`/`createFromExistingSession` 三个方法
- [x] 3.4 `otaAccount` 分组已清空，从 `DesktopApi` 类型和实现对象、以及最终
      `return Object.freeze({...})` 汇总处整体移除 `otaAccount` 键

## 4. renderer 层：调用点迁移

- [x] 4.1 `BrowserWorkspace.svelte`：`otaAccount.startLogin` → `otaCredential.openForNewLogin`
- [x] 4.2 `BrowserWorkspace.svelte`：`otaAccount.createFromCookie` → `otaCredential.openWithImportedCookie`
- [x] 4.3 `BrowserWorkspace.svelte`：`otaAccount.onAccountBound` → `otaCredential.onDiscoveryCompleted`
      （连带把局部变量名 `unsubscribeAccountBound` 改为 `unsubscribeDiscoveryCompleted`，
      含调用点）
- [x] 4.4 `CookieLoginListDialog.svelte`：`otaAccount.createFromCookie` → `otaCredential.openWithImportedCookie`

## 5. 删除孤儿组件

- [x] 5.1 删除 `SelectOtherHotelPanel.svelte`
- [x] 5.2 删除 `AccountsNav.svelte`
- [x] 5.3 全仓库搜索确认无残留引用，结果为空

## 6. 验证

- [x] 6.1 `grep -rn "otaAccount\."` 确认 renderer/preload/main/shared 无残留引用
- [x] 6.2 `npm run check:types --workspace=apps/desktop` 全量重跑，零错误；
      `npm run test:unit --workspace=apps/desktop` 全量重跑，47 个测试文件、
      231 个测试用例全部通过。过程中发现测试文件（`tests/unit/domain/ota-account-landing-url-policy.test.ts`、
      `tests/unit/main/browser-handlers.test.ts`、`tests/unit/main/ipc-logging.test.ts`、
      `tests/unit/preload/api.test.ts`）引用了已删除/改名的符号，属于原 tasks.md
      未覆盖到的遗漏项，已补充修复（见下方"6.2 补充任务"）
- [x] 6.3 用户在真机（`scripts/desktop-dev.sh --clean`，已同步更新脚本清理
      userData 目录后启动）手动验证：携程"登录新渠道账号"、抖音、美团三个渠道
      的真实登录场景全部成功，`otaCredential.openForNewLogin`/
      `openWithImportedCookie` 链路无运行时报错
- [x] 6.4 `ota_credential`/`ota_account` 两张表在三次真实登录后均正确写入
      （携程、抖音、美团各一条 credential + 一条 account，字段完整、渠道身份和
      酒店信息均正确），证明 `DiscoverAndCreate` → `otaCredential.discoveryCompleted`
      事件 → renderer 刷新账号列表这条链路完整可用

### 6.2 补充任务（实施中发现，原 tasks.md 未覆盖测试文件迁移）

- [x] 6.2.1 `tests/unit/domain/ota-account-landing-url-policy.test.ts`：整份重写为
      `tests/unit/domain/ota-channel-landing-url-policy.test.ts`，只测仍存在的
      `otaChannelLandingUrl`，删除已不存在的 `otaAccountLandingUrl` 相关用例
- [x] 6.2.2 `tests/unit/main/browser-handlers.test.ts`：删除 2 个 describe 块
      （`otaAccount.listByChannel / openExisting handlers`、
      `otaAccount.createFromExistingSession handler`，合计 9 个测试用例），清理 5 处
      `registerBrowserHandlers` 调用中多余的 `otaAccountRepository` 字段及死 import
- [x] 6.2.3 `tests/unit/main/ipc-logging.test.ts`：清理 3 处 `registerBrowserHandlers`
      调用中的 `otaAccountRepository` 字段，无测试用例删除/迁移
- [x] 6.2.4 `tests/unit/preload/api.test.ts`：删除 1 个测试用例（测已删除的
      `otaAccount.listByChannel`/`openExisting`），迁移 1 个测试用例（`otaAccount.onAccountBound`
      → `otaCredential.onDiscoveryCompleted`，断言逻辑不变）
- [x] 6.2.5 全部测试文件修复完成后重跑：`npm run check:types --workspace=apps/desktop`
      零错误；`npm run test:unit --workspace=apps/desktop` 47 个文件 231 个用例全部通过
- [x] 6.2.6（用户在实施过程中追加）：`main/features/ota-account/` 目录改名为
      `main/features/ota-credential/`（`git mv`，保留文件历史）——该目录下唯一文件
      `login-tab-opener.ts` 早已改造为只服务 `otaCredential.*` IPC（`OtaAccountReadService`
      已在 2.4 删除），目录名沿用 `ota-account` 名不副实。同步更新
      `main/ipc/browser-handlers.ts`、`tests/unit/main/login-tab-opener.test.ts`
      两处 import 路径；重跑类型检查零错误，两个受影响测试文件（8 个用例）全部通过
