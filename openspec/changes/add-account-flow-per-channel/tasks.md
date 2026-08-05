# Tasks

## 1. main 进程：探测触发路径抽象（上一轮，已完成）

- [x] 1.1 `BrowserManager.createWithAlreadyPartition` 增加可选 `onUrlPastLogin`/`loginUrlMatcher` 参数（design.md 决策2），与 `createAndNewPartition` 签名对齐；不传时行为不变，验证既有流程B调用方不受影响
- [x] 1.2 `cookie-import/store.ts` 新增 `hasImportedCookies(userDataDir, channel)` 与 `deleteImportedCookies(userDataDir, channel)`（本轮 §2 已删除两者）
- [x] 1.3 `LoginTabOpener` 拆分：保留 `open()` 对应"新建账号"（不注入 cookie），新增 `createFromCookie()`：
  - 携程分支：读取导入的 cookie 注入新 partition → 静默导航落地页 → 直接调用 `DiscoverAndCreate.trigger()`（不经过 `onUrlPastLogin`，design.md 决策3）→ 成功后调用 `deleteImportedCookies`（design.md 决策5，本轮 §10.2 已废止）
  - 抖音分支：读取导入的 cookie 注入新 partition → 打开可见页面 → 挂 `onUrlPastLogin`/`loginUrlMatcher`（design.md 决策4），不删除 cookie 文件
  - `DiscoverAndCreate.trigger()` 从 `Promise<void>` 改为 `Promise<boolean>`（携程静默分支需要知道这次调用是否建号成功）
- [x] 1.4 "从其他登录态创建"入口：`browser-handlers.ts` 内联实现，按 `accountId` 查 `OtaAccountRepository.findById` 拿 `partitionName` → 用 1.1 扩展后的 `createWithAlreadyPartition` 打开、挂探测回调；handler 内部判断非抖音渠道直接拒绝

## 2. main 进程：cookie 列表查询能力（本轮，已完成）

- [x] 2.1 `cookie-import/store.ts` 新增 `listImportedChannels(userDataDir): Promise<readonly ImportedChannelSummary[]>`（design.md §10.3），遍历 `cookie-imports/` 子目录读取各渠道 `manifest.json`，无目录/读取失败返回空数组
- [x] 2.2 `cookie-import/store.ts` 删除 `hasImportedCookies`（无调用点）
- [x] 2.3 `login-tab-opener.ts` 携程分支：去掉探测成功后调用 `deleteImportedCookies` 的一步
- [x] 2.4 `cookie-import/store.ts` 删除 `deleteImportedCookies`（无调用点）
- [x] 2.5 相关单测同步：`store.test.ts` 新增 `listImportedChannels` 用例，移除 `hasImportedCookies`/`deleteImportedCookies` 用例；`login-tab-opener.test.ts` 携程用例改为断言 cookie 不删除

## 3. IPC 层（本轮，已完成）

- [x] 3.1 `ota-account:has-imported-cookies`、`ota-account:create-from-cookie`、`ota-account:create-from-existing-session`（上一轮已完成，`create-from-cookie`/`create-from-existing-session` 本轮继续复用）
- [x] 3.2 新增 IPC `cookies:list-imported-channels`（调用 2.1 的 `listImportedChannels`）
- [x] 3.3 删除 IPC `ota-account:has-imported-cookies` 及对应 handler（无调用点）
- [x] 3.4 `shared/ipc-channels.ts` 增删对应声明；`preload/api.ts` 同步增删暴露的方法（新增 `cookies.listImportedChannels`，删除 `otaAccount.hasImportedCookies`）；`shared/browser.ts` 新增 `importedChannelSummarySchema`

## 4. renderer：设置页 cookie 列表（本轮，已完成，§11 修正后范围收窄）

- [x] 4.1 新增 `CookieLoginListDialog.svelte`：
  - 打开时调用 3.2 的 `cookies.listImportedChannels` 拉取已导入渠道列表，按渠道展示（渠道名 + 导入时间），无已导入渠道时展示空态
  - 右上角"导入 Cookie"复用既有 `CookieImportDialog`（`triggerLabel="导入 Cookie"`），完成后重新查询列表刷新
  - 每行"登录账号"按钮调用既有 `otaAccount.createFromCookie`（channelId 取该行渠道），成功后关闭弹窗、通过 `pending-tab-activation.ts` 记录待激活标签并跳转到浏览器工作区路由（`/`）
  - ~~抖音行额外渲染"从其他账号登录"按钮~~ —— **§11 撤回**：真机验证后确认该操作应放浏览器工作区账号导航栏而非此处，见任务 8
- [x] 4.2 `SettingsPage.svelte`：Cookie 行按钮从直接渲染 `CookieImportDialog` 改为渲染 `CookieLoginListDialog` 触发按钮（文案"已登录 Cookie 列表"）
- [x] 4.3 新增 `pending-tab-activation.ts`：cookie 列表页（`/settings`）与浏览器工作区（`/`）分属不同路由，用模块级变量传递"待激活标签"意图；`BrowserWorkspace.svelte` 挂载时读取并消费

## 5. renderer：添加账号面板精简（本轮，已完成）

- [x] 5.1 `AddAccountPanel.svelte` 删除：`hasCookie`/`checkingCookie`/`pickingExistingAccount`/`supportsExistingSession` 状态；`CookieImportDialog` 引用；`createFromCookie()`/`createFromExistingSession()`/`refreshCookieAvailability()` 方法；四宫格 Dialog 内容，改为直接触发 `onNewLogin()` 的单一按钮（不再需要 Dialog）
- [x] 5.2 `AccountsNav.svelte`/`BrowserWorkspace.svelte` 清理不再使用的 props 和死代码（`channel`/`activeTabId`/`onAccountCreated` props、`accountCreated()` 函数）——注：`channel` prop 在任务 8 中又恢复，供"服务商切换"判断渠道

## 6. 文档同步（本轮，已完成）

- [x] 6.1 `cookie-login-account-discovery/design-meituan.md` 第 87 行"未真机验证"风险状态更新为已验证（design.md §10.4）

## 7. 收尾（本轮，已完成）

- [x] 7.1 全局搜索确认 `hasImportedCookies`/`deleteImportedCookies` 无遗留引用（包括测试文件、类型导出）
- [x] 7.2 定向单测：store/login-tab-opener/browser-handlers/preload api 测试同步调整并新增用例
- [x] 7.3 完成态跑一次 main 层相关测试范围：22 个测试文件、113 个用例全部通过；`svelte-check` 0 错误；`tsc --noEmit`/`eslint` 无新增问题
- [ ] 7.4 真机验证：设置页打开 cookie 列表能看到已导入渠道；点击"登录账号"（携程/抖音/美团各一次）能正常注入并跳转——**携程/美团已验证通过**（`Discovery outcome: single`）；**抖音未验证通过**：真机测试中两次 `Login URL matcher checked { isPastLogin: false }` 后标签页被关闭，未触发探测，需要进一步排查（与本次改动是否相关待确认）

## 8. 修正（真机验证后）：「从其他账号登录」挪回浏览器工作区（design.md §11）

- [x] 8.1 `CookieLoginListDialog.svelte`：删除 `existingAccountsChannel`/`existingAccounts` 状态、`showExistingAccounts()`/`loginWithExistingSession()` 方法、抖音专属分支——所有渠道统一只有"登录账号"
- [x] 8.2 `AccountsNav.svelte`：恢复 `channel`/`activeTabId` prop（`channel` 判断 `channel.id === 'douyin'`；`activeTabId` 透传给 8.3 做遮挡修复），新增 `onSelectOtherHotel` prop，仅抖音渲染新增的 `SelectOtherHotelPanel`
- [x] 8.3 新增 `SelectOtherHotelPanel.svelte`：按钮文案"服务商切换"，点击后 `otaAccount.listByChannel(channelId)` 拉取已建号账号列表供选择，选定后调用 `onSelect(account)`
- [x] 8.4 `BrowserWorkspace.svelte`：新增 `selectOtherHotel(account)`，调用既有 `otaAccount.createFromExistingSession`，成功后走 `updateTab`/`activate`/`syncBounds`（与 `createTab`/`openAccount` 同一套组件内状态更新，不复用任务 4.3 的跨路由信号——本身就在浏览器工作区内触发）
- [x] 8.5 `svelte-check`/`tsc --noEmit` 确认无新增类型错误
- [x] 8.6 Review 自查修复：`SelectOtherHotelPanel.svelte` 初版遗漏了 `AddAccountPanel.svelte` 已修复过的"HTML Dialog 被 WebContentsView 遮挡"问题（design.md §11.2）——补上 `browser.hide()`/`activate` 的 hide/restore 模式，创建成功后不恢复旧标签（避免盖住新标签，与 `AddAccountPanel` 同源问题、同一修复方式）
- [ ] 8.7 真机验证：抖音渠道账号导航栏出现"服务商切换"按钮，点击后弹窗不被已打开的标签页遮挡、能列出已建号账号并成功复用登录态切换门店；其他渠道（携程/美团等）确认不出现该按钮

## 9. 首次引导浮层导入完成后自动跳转查看结果（design.md §12）

- [x] 9.1 新增 `pending-cookie-list-open.ts`：`requestCookieListAutoOpen()`/`consumeCookieListAutoOpen()`，与 `pending-tab-activation.ts` 同一模式但语义独立（design.md 决策17）
- [x] 9.2 `BrowserWorkspace.svelte`：新增 `finishCookiePromptAndReviewImports()`（`finishCookiePrompt` → `requestCookieListAutoOpen` → `push('/settings')`），替换首次引导浮层里 `CookieImportDialog` 的 `onComplete`
- [x] 9.3 `CookieLoginListDialog.svelte`：`onMount` 里 `consumeCookieListAutoOpen()` 为真时自动调用 `openDialog()`
- [x] 9.4 `svelte-check` 确认无新增类型错误
- [ ] 9.5 真机验证：首次启动应用点右下角"导入 Cookie"，完成后应自动跳转到设置页并弹出"已登录 Cookie 列表"；从设置页内"导入 Cookie"入口导入不应触发额外的自动打开（本身已在弹窗内，行为不变）

## 10. 根因修复：抖音探测 `dsl/get` 响应体间歇性读取失败

真机验证过程中复现的既有问题（`douyin-discovery.ts`，此前多次在真机日志中出现 `failed to read dsl/get response body`，之前误判为"非本次改动引入的既有缺陷、未展开排查"——这次两次干净环境测试都在首次尝试触发，说明命中率不低，不该继续搁置）。

- [x] 10.1 根因定位：`DslGetResponseCapture` 只监听 `Network.responseReceived` 就立即调用 `Network.getResponseBody`——CDP 协议里响应头到达（`responseReceived`）不代表响应体已完整接收，必须等 `Network.loadingFinished` 才保证 body 可读，过早调用会间歇性抛错（"No resource with given identifier found" 一类），命中率取决于响应体大小与网络时序
- [x] 10.2 修复 `src/main/account-discovery/douyin-discovery.ts`：`onEvent` 拆成两段——`responseReceived` 命中 `dsl/get` 时只记下 `pendingRequestId`，真正调用 `fetchAndResolveBody` 推迟到该 `requestId` 对应的 `loadingFinished` 事件触发时
- [x] 10.3 `tsc --noEmit` 确认无新增类型错误；`vitest run tests/unit/main`（22 个测试文件、113 个用例）全部通过，确认改动未影响其他既有测试
- [~] 10.4 补充单测：曾尝试为 `DslGetResponseCapture` 的事件时序写定向单测（mock `webContents.debugger`），因 mock 结构与 `discover()` 内部 `clickPoiManageMenu` 异步轮询的时序耦合导致测试超时卡住，排查成本超出投入产出比，用户明确要求停止——**未补充自动化测试**，此修复目前只有真机验证作为证据，后续如需补测试建议先把 `DslGetResponseCapture` 从 `DouyinDiscoveryProbe.discover()` 中解耦出来单独可测
- [ ] 10.5 真机验证：抖音"登录账号"点击后触发探测，确认不再出现 `failed to read dsl/get response body`，首次尝试即可正常拿到门店信息并建号成功（此前干净环境测试两次都在首次尝试失败）

## 11. Monorepo 迁移：将本变更全部改动移植到 `apps/desktop/` 新目录结构

同事在 `dev` 分支上以 `mono repo init` 提交把仓库改造成 npm workspaces monorepo（`apps/desktop/`、`apps/server/`、`packages/api/`），与本变更（任务 1-10）的历史线在 `f1fa403` 分叉。直接 `git merge`/`git pull` 会因路径不对齐产生大量冲突。

- [x] 11.1 备份原分支为 `backup-old-structure`，`git reset --hard origin/dev` 切到新结构
- [x] 11.2 导出 `f1fa403..backup-old-structure` 的完整 diff，把 `src/`/`tests/` 路径前缀替换为 `apps/desktop/src/`/`apps/desktop/tests/`（`openspec/` 保持根目录不变），`git apply` 一次性迁移（未修改内容，纯路径映射）
- [x] 11.3 `npm install` 补齐新 workspace（`packages/api`、`apps/server`）引入的依赖，`check:desktop`/`test:unit:desktop` 全部通过
- [x] 11.4 修复迁移暴露的遗留测试债：`tests/component/BrowserWorkspace.test.ts`、`tests/component/AppRouting.test.ts` 里多处硬编码了"添加账号"面板旧版四操作 Dialog 交互（点"添加账号"→再点弹窗里的"新建账号"→等 Dialog 消失）和设置页"导入 Cookie"直接弹出 `CookieImportDialog` 的旧交互——这两处 UI 结构在任务 4/5（cookie 列表页、精简添加账号面板）就已经改变，但当时组件测试没有跑起来同步更新，导致这批测试从那时起就应该已经失败，直到这次 monorepo 迁移重新跑组件测试才发现。修复：`openCtripViaAddAccount` 及三处内联重复逻辑改为直接点"添加账号"；`AppRouting.test.ts` 里"导入 Cookie"改为先点"已登录 Cookie 列表"再点弹窗内的"导入 Cookie"
- [x] 11.5 `test:component`（12 个测试文件、52 个用例）全部通过
