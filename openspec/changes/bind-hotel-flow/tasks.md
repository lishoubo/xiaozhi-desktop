## 1. 共享契约

- [x] 1.1 新增 `shared/types/ui-waiting-result-types.ts`：`UiWaitingResultPayloads` 映射表（当前只有 `'bind-hotel'`）、`UiWaitingResultKind`、`UiWaitingResultEnvelope<K>`（见 design.md 决策 4）
- [x] 1.2 `shared/browser.ts` 新增 `ProbedHotelDto` 与其 zod schema（候选酒店的跨进程形状：`otaHotelId`/`otaHotelName`/`bindExtra`）
- [x] 1.3 `shared/browser.ts` 新增绑定意图 schema `bindHotelIntentSchema`（`kind: 'bind-hotel'` + `requestId`）与候选通知信封 schema
- [x] 1.4 `shared/ipc-channels.ts` 新增：`hotelManagement.startBinding`、`hotelManagement.confirmBinding`、`uiWaitingResult.delivered`（候选通知频道）

## 2. intent 上行（ota-tab）

- [x] 2.1 `main/ota-tab/ota-tab-service.ts`：`openExisting(credentialId, intent?: unknown)` 的 `intent` 收窄为 `OtaTabIntent` union（当前只有 bind-hotel 一种），透传给 `loginDetector.register`
- [x] 2.2 `main/ota-tab/login-detector.ts`：`register(tabId, channel, intent?)` 把 intent 存入 `loginTabs` 的 `LoginTabState`
- [x] 2.3 同文件：`handleTabNavigated` 广播时把 intent 放进事件；确认 `tab:closed` 已有的 `loginTabs.delete` 覆盖 intent 清理（不新增清理路径）
- [x] 2.4 `main/ota-tab/tab-event-bus.ts`：`TabCredentialCheckedEvent` 增加 `intent?: OtaTabIntent` 字段并更新注释

## 3. 候选下行（channels → renderer）

- [x] 3.1 `main/channels/hotel-probe-dispatcher.ts`：依赖增加 `notify: (envelope: UiWaitingResultEnvelope) => void`
- [x] 3.2 同文件：仅当事件带 `kind: 'bind-hotel'` 意图时才走通知路径；无意图时保持现状（只记日志）
- [x] 3.3 同文件：`probe()` 返回后判断 `event.webContents.isDestroyed()`，已销毁则丢弃候选并记日志，不通知
- [x] 3.4 同文件：构造 envelope（`requestId` 取自 intent、`kind: 'bind-hotel'`、payload 含 `credentialId` 与候选列表）并调 `notify`
- [x] 3.5 `main/composition/window-scope.ts`：把 `notify` 接到 `window.webContents.send(IPC_CHANNELS.uiWaitingResult.delivered, envelope)`，照 `setAccountBoundNotifier` 的形状（判 `window.isDestroyed()`）

## 4. 绑定服务与 IPC

- [x] 4.1 `main/services/hotel-management-service.ts`：新增依赖 `otaTab`（窄接口，只要 `openExisting`）、`otaHotelRepository`（只要 `save`）、`readCookieSnapshot`、`generateRequestId`
- [x] 4.2 同文件：`startBinding()` **只发号** → 返回 `{ requestId }`。标签页由渲染进程自己开（三步收尾只有渲染进程做得了，见 design 决策 1「tab 由谁开」）；`tabOpener` 依赖已删除
- [x] 4.3 同文件：`confirmBinding(input)` → 读 cookie 快照 → `otaAccountGateway.bind(...)` → **成功后**再 `otaHotelRepository.save(...)`；远端失败直接抛出，不写本地（design.md 决策 6）
- [x] 4.4 `main/ipc/hotel-management-handlers.ts`：`HotelManagementOrchestrator` 增加两个方法；注册 `startBinding`/`confirmBinding` 两个 handler，参数走 zod 校验，复用既有 `logFailure`
- [x] 4.5 `main/composition/window-scope.ts` / `app-scope.ts`：`HotelManagementService` 注入 `otaTabService`、`otaHotelRepository`、`readCookieSnapshot`（用 `sessionFactory` 按 partitionName 读 cookie）、`generateRequestId`（`crypto.randomUUID`）
- [x] 4.6 确认装配顺序：`HotelManagementService` 现在依赖 `OtaTabService`，而后者在 `window-scope` 中构造——必要时调整创建顺序或改为窗口级构造

## 5. preload

- [x] 5.1 `preload/namespaces/hotel-management.ts`：新增 `startBinding`、`confirmBinding` 两个 invoke，带 zod 校验
- [x] 5.2 新增 `preload/namespaces/ui-waiting-result.ts`（或并入现有 namespace）：`onDelivered(listener)` 订阅候选通知，schema 校验信封
- [x] 5.3 `preload/api.ts` 挂载新 namespace

## 6. renderer

- [x] 6.1 新增 `renderer/waiting-ui-result.ts`：`createWaitingUiResult(subscribe)` → `{ await(kind, requestId, cb) → cancel, dispose }`（见 design.md 决策 4）
- [x] 6.2 新增候选酒店弹窗组件 `renderer/components/browser/BindHotelCandidatesDialog.svelte`：单选列表 + 确认 + 否决；就地展示不跳转
- [x] 6.3 `renderer/components/browser/BrowserWorkspace.svelte`：挂载 waiting 订阅，收到匹配 requestId 的候选后打开弹窗；组件卸载时 `cancel()` + `dispose()`
- [x] 6.4 绑定发起入口：**改在酒店管理页每行酒店的「新增绑定账号」按钮**（原计划放浏览器工作区，用户纠正：应从酒店出发选账号）；选账号后 `startBinding` + 跨路由 intent 跳浏览器页
- [x] 6.5 用户选定后调 `confirmBinding`，成功提示 + 关闭弹窗；失败用既有 `showAppNotification` 报错，弹窗保持打开供重试
- [x] 6.6 发起新绑定前取消上一次未完成的等待（design.md 风险表：同时只允许一个绑定弹窗）

## 7. 测试

- [x] 7.1 `hotel-probe-dispatcher.test.ts`：新增「带 bind-hotel 意图时调用 notify 且 envelope 内容正确」
- [x] 7.2 同文件：新增「webContents 已销毁时不调用 notify」
- [x] 7.3 同文件：新增「无意图时不调用 notify，仅记日志」
- [x] 7.4 `login-detector.test.ts`：新增「register 传入的 intent 随广播带出」与「tab 关闭后 intent 不再出现在后续广播」
- [x] 7.5 新增 `hotel-management-service.test.ts`：`startBinding` 每次发新号；`confirmBinding` 远端成功后才 save；**远端失败时不 save**
- [x] 7.6 新增 `ota-tab-handlers.test.ts`：`openExisting` 的 intent 透传、缺省即普通打开、**非法意图被 schema 拒绝且不调 service**
- [x] 7.6 新增 `waiting-ui-result.test.ts`：requestId 匹配才回调、回调后自动清除、`cancel()` 后不再回调、不匹配的信封被忽略
- [x] 7.7 `ota-tab-service.test.ts`：确认 intent 收窄后既有用例仍通过，补一条「传 bind-hotel 意图时 register 收到该意图」

## 8. 验证

- [x] 8.1 `npm run check --workspace @hotel-butler/desktop` 通过
- [x] 8.2 `npm run lint --workspace @hotel-butler/desktop` 通过（确认 `channels/` 未因 notify 引入违规依赖）
- [x] 8.3 迭代期定向测试：改到哪个文件跑哪个
- [x] 8.4 完成态跑一次单元测试全量：`npm run test:unit:desktop`
- [ ] 8.5 **真机端到端**（与用户一起）：启动应用 → 发起绑定 → 观察日志出现 `Discovery triggered` → `discovery outcome` → 候选通知 → 弹窗出现 → 选定确认 → `ota_hotel` 出现 1 行且字段正确
- [ ] 8.6 真机验证否决路径：点「否」后不写库，换渠道重新发起能再次探测出候选（验证 Change 1 删除早退的效果）
- [ ] 8.7 真机验证失败路径：远端 mock 抛错时本地不写入、UI 有明确报错
- [ ] 8.8 将验证证据写入 `openspec/changes/bind-hotel-flow/verification.md`

## 8. 修复真机断链（问题 1）

- [x] 8.1 新增 `renderer/components/browser/browser-ota-tabs.svelte.ts`：渲染进程侧 OTA tab 状态层，`adopt()` 收敛三步收尾（进标签栏 / 切渠道设活动标签 / `syncBounds`）
- [x] 8.2 `BrowserWorkspace.svelte` 改为只渲染 + 注册视口，tab 状态全部读 store；凭证列表不收进 store
- [x] 8.3 `BindHotelDialog.svelte` 自给自足：consume 意图 → `store.openExisting(credentialId, intent)` → 登记等待；不经父组件传 props
- [x] 8.4 `otaTab.openExisting` 支持 intent：preload 加参数、handler 过 `otaTabIntentSchema` 校验、`OtaTabOrchestrator` 的 `intent?: unknown` 收窄为 `OtaTabIntent`
- [x] 8.5 `hotelBindingWaiting` 意图带上 `credentialId`；`AddOtaBindingDialog` 改调无参 `startBinding()`
- [x] 8.6 静态门禁：check 835 files 0 errors、lint 0 problems、单元 246 tests

## 9. 真机复验暴露的后续断点

- [x] 9.1 **默认激活覆盖**：`browser.list()` 的兜底激活与绑定开 tab 是并行异步链，前者后完成把后者顶掉（现象：标签开了、渠道切了，内容区却是携程）。store 记 `#explicitlyActivated`，兜底改用 `activateIfIdle()` 让位；`activate()` 顺带补上漏设的 `activeChannelId`
- [x] 9.2 **`bound` 早退吞掉凭证**：`OtaCredentialService.trigger` 对已探测过的 partition 返回 `null`，下游据此认定「没登录成功」而跳过探测——绑定选的就是已登录账号，这条路径必然失效。改为返回 `findByPartitionName()`；`inflight` 分支保持 null。回归测试已验证能抓到该 bug（revert 即红）
- [x] 9.3 **弹窗被原生视图遮住**：`WebContentsView` 永远盖在 HTML 之上，z-index 管不到。弹窗开合时 `suspendViewport()` / `resumeViewport()`，让位期间 `syncBounds()` 直接 return；ESC / 点遮罩走 `onOpenChange` 以免绕过恢复
- [x] 9.4 弹窗尺寸对齐 `AccountSwitcherDialog`（`max-w-4xl` + `p-7`）——那个弹窗同样是 `browser.hide()` 让位，只是够大盖住了空白
- [x] 9.5 `confirmBinding` 失败透传远端文案，剥掉 Electron 的 `Error invoking remote method` 包装（`binding-failure-message.ts` + 3 个单测）
- [x] 9.6 补排查日志：dispatcher 的 `tabId`/`intentKind`/`dropped`/`delivered`，renderer 的 `registered`/`claimed`/`nobody claimed`
- [x] 9.7 **真机验证**：候选弹窗正常出现，`Binding candidates claimed` 与 `delivered` 的 requestId 一致
- [ ] 9.8 **真机验证绑定落库**：换一家未绑定抖音的酒店走完确认，确认 `ota_hotel` 有记录（此前撞上 seed 的「已存在活跃绑定」业务拒绝）
