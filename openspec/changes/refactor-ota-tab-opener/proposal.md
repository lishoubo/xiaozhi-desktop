## Why

`BrowserManager` 目前掺杂了 OTA 登录判定业务（`loginUrlMatcher`/`onUrlPastLogin`/`checkUrlPastLogin`/`urlPastLoginTriggered`），导致三个开 OTA 标签页的入口职责不对称：`openForNewLogin`/`openWithImportedCookie` 挂了判定，`openExisting` 没挂，无法支撑后续"酒店绑定探测流程"（Part B）需要的显式 intent。本次重构先把入口和职责边界理顺，作为 Part B 的前置依赖。

## What Changes

- `BrowserManager` 移除登录判定相关字段和方法（`ManagedTab.loginUrlMatcher`/`onUrlPastLogin`/`urlPastLoginTriggered`、`checkUrlPastLogin`），改为广播原始导航事实（`tab:navigated`）和标签页关闭事实（`tab:closed`），不再理解"登录"这个业务概念。
- 新建 `OtaTabOpener`（`main/features/ota-tab-opener/`），取代 `LoginTabOpener`：订阅 `BrowserManager` 的导航/关闭事件，自行维护 `tabId → 登录判定状态` 映射，做判定、去重、触发 discovery、广播判定结果。
- `LOGIN_URL_MATCHERS` registry 从 `ota-credential/` 搬到 `ota-tab-opener/`。
- 新建 `ipc/ota-tab-handlers.ts`，统一收拢 4 个开 OTA 标签页的 IPC 入口，全部经过 `OtaTabOpener`；`browser-handlers.ts` 瘦身为纯浏览器容器控制 + cookies。
- **BREAKING（含 renderer）**：这 4 个入口的 IPC namespace 从 `otaCredential.*`/`browser.create` 统一改名为 `otaTab.*`（`openForNewLogin`/`openWithImportedCookie`/`openExisting`/`openView`）——`otaCredential` 前缀名不副实，改用与 `OtaTabOpener` 对齐的命名；`otaCredential` namespace 保留 `listByChannel`/`discoveryCompleted` 两个纯 credential 查询/事件。`preload/api.ts` 与 `BrowserWorkspace.svelte`/`CookieLoginListDialog.svelte` 调用点需同步改名（纯重命名，不改变行为/参数结构）。
- `openExisting` 新增可选 `intent` 参数（类型占位，不定义具体 union），传入时挂判定+广播，不传维持现状行为。
- **BREAKING（内部）**：`LoginTabOpener` 删除，不保留兼容层；`BrowserManager` 构造函数不再接受 `TabEventBus` 参数。

## Capabilities

无 spec 级行为变更——这是纯内部重构，不改变任何 IPC 契约、用户可见行为或渠道判定逻辑本身。见 `.openspec.yaml` 的 `skip_specs: true`。

## Impact

- `apps/desktop/src/main/browser/browser-manager.ts`、`tab-event-bus.ts`
- `apps/desktop/src/main/features/ota-credential/login-tab-opener.ts`（删除）、`login-url-matcher.ts`（搬移）
- 新建 `apps/desktop/src/main/features/ota-tab-opener/`
- `apps/desktop/src/main/ipc/browser-handlers.ts`（瘦身）、新建 `ota-tab-handlers.ts`
- `apps/desktop/src/main/application.ts`（装配变更）
- `apps/desktop/src/shared/ipc-channels.ts`（`otaCredential`/`otaTab` namespace 调整）
- `apps/desktop/src/preload/api.ts`（新增 `otaTab` namespace）
- `apps/desktop/src/renderer/components/browser/BrowserWorkspace.svelte`、`CookieLoginListDialog.svelte`（调用点改名）
- 测试：`browser-manager-partitions.test.ts`、`login-tab-opener.test.ts`（搬移改名）、`tab-event-bus.test.ts`、`ota-hotel-prob-feature.test.ts`
