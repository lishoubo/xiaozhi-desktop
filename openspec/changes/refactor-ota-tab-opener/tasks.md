## 1. BrowserManager：加事件广播、瘦身 ManagedTab

- [ ] 1.1 `BrowserManager` 继承/组合 `EventEmitter`，新增 `tab:navigated`（`{tabId, partitionName, channelId, url, webContents}`）在 `did-navigate`/`did-navigate-in-page` 时 emit
- [ ] 1.2 新增 `tab:closed`（`{tabId}`）在 `close(tabId)` 时 emit
- [ ] 1.3 `ManagedTab` 移除 `onUrlPastLogin`/`loginUrlMatcher`/`urlPastLoginTriggered` 字段
- [ ] 1.4 删除 `checkUrlPastLogin` 方法及其调用点
- [ ] 1.5 `createWithAlreadyPartition`/`createAndNewPartition` 签名移除 `onUrlPastLogin`/`loginUrlMatcher` 选项
- [ ] 1.6 构造函数移除第 4 参 `tabEventBus`，删除对 `TabEventBus` 的 import 和依赖
- [ ] 1.7 确认 `browser.stateChanged`（IPC send）广播逻辑不受影响，与新增的进程内事件是两条独立通道

## 2. 新建 OtaTabOpener

- [ ] 2.1 新建 `apps/desktop/src/main/features/ota-tab-opener/` 目录
- [ ] 2.2 搬移 `main/features/ota-credential/login-url-matcher.ts` → `main/features/ota-tab-opener/login-url-matcher.ts`，同步更新所有 import 路径
- [ ] 2.3 新建 `ota-tab-opener.ts`：`loginTabs: Map<tabId, {channel, loginUrlMatcher}>` + `triggered: Set<tabId>`
- [ ] 2.4 订阅 `BrowserManager` 的 `tab:navigated`：命中 `loginTabs` 且未 `triggered` 时判定 `isPastLogin`，命中则 `triggered.add(tabId)` → await `triggerDiscovery(...)` → 广播 `tab:credential-checked`；未命中登记表或已触发过，短路广播 `not-applicable`/跳过（对齐 design.md 决策 2 的语义等价要求）
- [ ] 2.5 订阅 `tab:closed`：清理 `loginTabs`/`triggered` 对应条目
- [ ] 2.6 实现 `openForNewLogin(env, channel, url)`：调用 `browserManager.createAndNewPartition`，登记 `loginTabs`，`addPendingPartition`（原 `LoginTabOpener.open()` 逻辑迁移）
- [ ] 2.7 实现 `openWithImportedCookie(env, channel, url)`：原 `LoginTabOpener.createFromCookie()` 逻辑迁移
- [ ] 2.8 实现 `openExisting(credentialId, intent?: unknown)`：调用 `browserManager.createWithAlreadyPartition`；传了 `intent` 才登记 `loginTabs`
- [ ] 2.9 实现 `openView(channelId, url)`：调用 `browserManager.createWithAlreadyPartition(LEGACY_SHARED_PARTITION, ...)`，不登记
- [ ] 2.10 删除 `main/features/ota-credential/login-tab-opener.ts`

## 3. IPC 层拆分 + namespace 改名

- [ ] 3.1 `shared/ipc-channels.ts`：`otaCredential` namespace 只保留 `listByChannel`/`discoveryCompleted`；新增 `otaTab` namespace，含 `openExisting`/`openForNewLogin`/`openWithImportedCookie`/`openView`（取代原 `browser.create`），channel 字符串同步改用 `ota-tab:*` 前缀
- [ ] 3.2 新建 `apps/desktop/src/main/ipc/ota-tab-handlers.ts`，注册 `otaTab.openExisting`/`otaTab.openForNewLogin`/`otaTab.openWithImportedCookie`/`otaTab.openView` 四个 handler，全部委托 `OtaTabOpener` 实例
- [ ] 3.3 `browser-handlers.ts` 移除 `browser.create` 及上述 3 个 `otaCredential.open*` handler、`LoginTabOpener` 相关代码，只保留纯容器控制（activate/close/goBack/goForward/reload/list/setBounds/setAudioMuted/hide/acknowledgeInterception）+ cookies.* + `otaCredential.listByChannel`
- [ ] 3.4 `registerBrowserHandlers`/新增的 `registerOtaTabHandlers` 的 unregister 清单（`channels` 数组）按拆分同步调整，避免遗漏或重复移除
- [ ] 3.5 `preload/api.ts`：新增 `otaTab` namespace（`openExisting`/`openForNewLogin`/`openWithImportedCookie`/`openView`），从 `otaCredential`/`browser.create` 挪走对应方法；`otaCredential` 保留 `listByChannel`/`onDiscoveryCompleted`
- [ ] 3.6 `BrowserWorkspace.svelte`：`window.hotelButler.otaCredential.{openForNewLogin,openExisting,openWithImportedCookie}` 调用点改为 `window.hotelButler.otaTab.*`；`listByChannel` 调用点不变
- [ ] 3.7 `CookieLoginListDialog.svelte`：`otaCredential.openWithImportedCookie` 调用点改为 `otaTab.openWithImportedCookie`

## 4. application.ts 装配变更

- [ ] 4.1 `BrowserManager` 构造调用去掉 `tabEventBus` 参数
- [ ] 4.2 实例化 `OtaTabOpener`，注入 `browserManager`（订阅方）、`tabEventBus`（广播方，继续给 `OtaHotelProbFeature` 用）、`LOGIN_URL_MATCHERS`、`triggerDiscovery`、`userDataDir`
- [ ] 4.3 `registerBrowserHandlers` 调用点更新为不再传 `loginUrlMatchers`/`triggerDiscovery`（已转移给 `OtaTabOpener`），新增 `registerOtaTabHandlers` 调用并传入 `otaTabOpener`
- [ ] 4.4 `mainWindow.once('closed', ...)` 清理逻辑同步加上 `unregisterOtaTabHandlers`

## 5. 测试同步

- [ ] 5.1 `browser-manager-partitions.test.ts`：改为验证 `tab:navigated`/`tab:closed` 事件是否正确 emit（payload 正确性），移除依赖 `did-navigate` handler 驱动登录判定的旧用例
- [ ] 5.2 新建 `ota-tab-opener.test.ts`：覆盖判定/去重/触发 discovery/广播的完整逻辑（原 `login-tab-opener.test.ts` 用例迁移 + 判定逻辑用例整合）
- [ ] 5.3 删除 `login-tab-opener.test.ts`（逻辑已迁移到 5.2）
- [ ] 5.4 `tab-event-bus.test.ts`：确认类型/行为不变，仅确认不再从 `BrowserManager` 侧驱动
- [ ] 5.5 `ota-hotel-prob-feature.test.ts`：确认订阅的 `TabEventBus` 实例来源变化后用例仍通过，无需改动断言逻辑

## 6. 收尾

- [ ] 6.1 全量类型检查 + 受影响范围单测跑一遍
- [ ] 6.2 真机验证：账号切换弹窗新建登录、cookie 登录、打开已有账号三条路径，确认 namespace 改名后行为与重构前一致（不传 `intent` 时 `openExisting` 行为不变）
- [ ] 6.3 归档/更新 `add-hotel-management-page/ota-tab-opening-audit.md`、`ota-tab-opener-refactor-status.md`：标注已被本 change 取代
