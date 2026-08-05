## Why

现有 cookie 导入（`CookieImportDialog.svelte` 全局引导浮层 → `cookie-import/store.ts` 落盘）与"添加账号"是两条彼此断开的链路：导入的 cookie 存到磁盘后，唯一的消费点是 `LoginTabOpener.open()` 里悄悄做的"预填"——即使用户已经导入过 cookie，点"添加账号"仍然固定打开一个新登录页让用户重新手动登录，导入的 cookie 没有对应的"直接用这份 cookie 建账号"路径。同时携程和抖音对"一份登录态能建几个账号"的语义不同（携程一份 cookie 对应一个账号；抖音一份登录态可能挂多个公司/门店，且已建号的账号本身就带着可复用的登录态），需要在"添加账号"入口上把这些差异变成用户可见的显式操作，而不是像现在这样悄悄预填。

**追加背景（本轮修订）**：上述"添加账号四操作面板"方案已实现并部分真机验证（`tasks.md` 1-4 节），但真机验证暴露了可用性问题——四个按钮挤在一个小 Dialog 里，用户看不到"我在哪些渠道已经导入过 cookie、导入的是什么时候"，操作①"导入cookie"和②"从cookie创建"分处两步、状态不直观。改为把"cookie 的可见性与登录入口"整体迁移到设置页的独立列表页，添加账号面板收敛为单一"新建账号"入口：设置页管"已导入的登录态"，添加账号面板只管"新建一个账号"，职责更清晰，也更适合桌面打包后的实际使用习惯。

## What Changes

1. **设置页新增"已登录 Cookie 列表"**：原设置页"Cookie"行的按钮位置改为"已登录 Cookie 列表"入口，打开后是一个列表弹窗：右上角保留"导入 Cookie"（复用现有 `CookieImportDialog`，逻辑不变，仍是全局跨渠道一次性导入）；列表本身按渠道展示已导入的 cookie，每行：渠道名 + 导入时间（`manifest.importedAt`）+ 操作：
   - **登录账号**（该渠道有已导入 cookie 时才展示这一行）：调用现有 `createFromCookie`，用该 cookie 注入一个新 partition 并打开标签页，跳转到内置浏览器；新 partition 处于未绑定状态，用户在页面里自行完成登录确认/选门店/选公司，随后走既有的 URL 判定 → 探测 → 建号流程
   - **从其他账号登录**（仅抖音）：调用现有 `createFromExistingSession`，弹出该渠道下已建号账号列表，选择其一后复用其 `partitionName` 对应登录态打开页面，允许切换到另一个公司/门店再次探测建号
2. **"添加账号"面板收敛为单一操作**：移除面板内原操作①导入cookie、②从cookie创建、③从其他登录态创建三个按钮，只保留④新建账号——`AddAccountPanel.svelte` 从四宫格精简为单按钮，与设置页 cookie 列表不再有功能重叠
3. **携程"登录账号"成功后不再删除 cookie**：原决策5（探测成功后调用 `deleteImportedCookies`）废止。携程与抖音行为统一——同一份 cookie 允许反复登录/重建，不会因为"已消费"而从列表里消失。`deleteImportedCookies` 函数本身随调用点一起删除（无遗留死代码）
4. **cookie 导入去重维持现状不变**：同渠道再次导入直接整体覆盖（`writeImportedCookies` 已有行为），继续按渠道去重、不做更细粒度的按账号去重（cookie 内容无法可靠解析出账号/门店标识）
5. **美团渠道风险状态更新**：`cookie-login-account-discovery/design-meituan.md` 标注的"`poiInfos` 接口本次未做真机验证"风险已由用户真机验证通过，本次同步更新该文档的风险状态
6. **修正（真机验证后）：「从其他账号登录」挪回浏览器工作区，改名「服务商切换」**：第1点里"cookie 列表页抖音行旁边的从其他账号登录按钮"经真机验证确认位置不对——这是"给抖音账号导航栏加一种新增门店的方式"，跟"cookie 导入管理"是不同语境。改为：cookie 列表页所有渠道统一只有"登录账号"一个操作；浏览器工作区账号导航栏（`AccountsNav.svelte`）新增"服务商切换"按钮，与"添加账号"并列，仅抖音渠道渲染，点击后列出该渠道已建号账号供选择，复用其登录态切换门店（`createFromExistingSession` 调用点从 cookie 列表页改为这里，方法本身不变）

`LoginTabOpener.open()` 现有的"无条件预填 cookie 到新建登录页"逻辑保持已移除的状态（沿用上一轮结论），`createFromCookie`/`createFromExistingSession` 两个 main 层方法与对应 IPC 保留并复用，本轮只调整它们在 renderer 侧的入口位置与携程分支的 cookie 消费策略。

## Capabilities

### New Capabilities

- `cookie-login-list`：定义设置页"已登录 Cookie 列表"——展示字段（渠道、导入时间）、每行操作（登录账号，所有渠道一致）

### Modified Capabilities

- `add-account-flow`（本变更上一轮新增，尚未归档进 `openspec/specs/`）：范围收窄为仅"新建账号"一个操作，原操作①②③迁移进 `cookie-login-list`；携程 cookie 消费策略从"成功后删除"改为"不删除"

（`douyin-multi-account-nav/design.md` 决策 #3/#4 关于"不提供复用已登录 cookie 入口"的结论，延续上一轮的调整结论："提供，但作为用户显式选择的独立操作"——本轮只是把这个入口从添加账号面板挪到了 cookie 列表页，结论不变）

## Impact

- `src/renderer/pages/SettingsPage.svelte`：Cookie 行的按钮改为打开新增的 cookie 列表弹窗组件
- 新增前端组件 `CookieLoginListDialog.svelte`：列表渲染 + "登录账号"操作（所有渠道一致），复用既有 `createFromCookie` IPC
- `src/renderer/components/browser/AddAccountPanel.svelte`：删除操作①②③相关的按钮、状态（`hasCookie`/`checkingCookie`/`pickingExistingAccount`/`supportsExistingSession`/`CookieImportDialog` 引用）与逻辑，只保留 `newLogin`
- `src/renderer/components/browser/AccountsNav.svelte`：恢复 `channel` prop，新增 `onSelectOtherHotel` prop，仅抖音渠道渲染新增组件 `SelectOtherHotelPanel.svelte`（"服务商切换"按钮 + 已建号账号选择列表，复用既有 `createFromExistingSession` IPC）
- `src/renderer/components/browser/BrowserWorkspace.svelte`：新增 `selectOtherHotel(account)` 处理函数，与既有 `createTab`/`openAccount` 同一套 `updateTab`/`activate`/`syncBounds` 状态更新模式
- `src/main/cookie-import/store.ts`：新增 `listImportedChannels(userDataDir): Promise<ReadonlyArray<{channel: ChannelId; importedAt: string}>>`（供列表页一次性查询所有已导入渠道，替代只能单渠道查询的现状）；删除 `deleteImportedCookies`（无调用点）
- `src/main/features/ota-account/login-tab-opener.ts`：携程分支去掉"探测成功后删除cookie"这一步
- IPC：新增 `cookies.listImportedChannels`（列表页数据源）；删除 `ota-account:has-imported-cookies` 及对应 preload 方法（`AddAccountPanel` 不再需要按渠道置灰，无其他调用点）；`ota-account:create-from-existing-session` 调用方从 cookie 列表页改为 `AccountsNav`/`SelectOtherHotelPanel`，方法本身不变
- 关联测试：`cookie-import/store`、`login-tab-opener`（携程分支）、`AddAccountPanel`、新增的 cookie 列表组件测试需同步调整
