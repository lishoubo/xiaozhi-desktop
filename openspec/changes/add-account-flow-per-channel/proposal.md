## Why

现有 cookie 导入（`CookieImportDialog.svelte` 全局引导浮层 → `cookie-import/store.ts` 落盘）与"添加账号"是两条彼此断开的链路：导入的 cookie 存到磁盘后，唯一的消费点是 `LoginTabOpener.open()` 里悄悄做的"预填"——即使用户已经导入过 cookie，点"添加账号"仍然固定打开一个新登录页让用户重新手动登录，导入的 cookie 没有对应的"直接用这份 cookie 建账号"路径。同时携程和抖音对"一份登录态能建几个账号"的语义不同（携程一份 cookie 对应一个账号；抖音一份登录态可能挂多个公司/门店，且已建号的账号本身就带着可复用的登录态），需要在"添加账号"入口上把这些差异变成用户可见的显式操作，而不是像现在这样悄悄预填。

## What Changes

"添加账号"入口从单一按钮改为最多四个并列操作（按渠道能力显示/置灰，不做隐式判断分流）：

1. **导入 cookie**：复用现有 `CookieImportDialog`，把 cookie 存入该渠道的导入区（`cookie-import/store.ts`），仅存盘，不触发建号
2. **从 cookie 创建**：消费"已导入的 cookie"（来自操作1）直接建号——用该 cookie 注入一个新 partition，跳过人工登录页；该渠道没有已导入 cookie 时按钮置灰不可点。携程场景：注入后直接触发探测，一份 cookie 对应一个账号，成功后视为已消费。抖音场景：注入后打开登录态页面，允许用户选择公司（对应 groupid），选定后对该 groupid 探测建号，一份 cookie 可反复用于建多个账号
3. **从其他登录态创建**（仅抖音）：列出该渠道下已建号成功的账号（`OtaAccount`），选择其一，复用其 `partitionName` 对应的登录态打开页面，允许用户切换/选择另一个公司并对新 groupid 探测建号。该渠道没有已存在账号时按钮置灰或不显示。携程不提供此操作（一份登录态只对应一个账号，复用没有意义）
4. **新建账号**：现状流程A不变——新建 partition → 打开登录页 → 用户登录 → URL 判定 → 探测 → 建号

`LoginTabOpener.open()` 现有的"无条件预填 cookie 到新建登录页"逻辑移除，拆分为上述操作2/4两条独立路径，不再耦合在一起。

## Capabilities

### New Capabilities

- `add-account-flow`：定义"添加账号"入口的四个操作（导入cookie / 从cookie创建 / 从其他登录态创建 / 新建账号）、每个操作的可用性条件（置灰规则）、以及携程与抖音在操作2/3上的行为差异

### Modified Capabilities

（`openspec/specs/` 目前尚无已归档的顶层 spec，无既有 capability 可修改；`douyin-multi-account-nav/design.md` 决策 #3/#4 关于"不提供复用已登录 cookie 入口"的结论，本次变更调整为"提供，但作为用户显式选择的独立操作，而非登录流程默认行为"，具体收敛写入 design.md）

## Impact

- `src/renderer/components/browser/AccountsNav.svelte`：`onAddAccount` 改为打开一个"添加账号"操作面板/弹窗，渲染四个操作按钮，按渠道与已导入cookie/已有账号状态决定可用性
- 新增前端组件：添加账号操作面板；抖音专用的"选择公司"步骤 UI；"选择已有账号复用登录态"的列表 UI
- `src/main/features/ota-account/login-tab-opener.ts`：拆分为"从cookie创建"与"新建账号"两条独立方法，不再无条件预填
- `src/main/browser/browser-manager.ts`：`createWithAlreadyPartition` 需要支持挂载 `onUrlPastLogin`/`loginUrlMatcher`（操作3复用已有 partition 时也要能触发探测，目前该方法不支持这两个回调，仅 `createAndNewPartition` 支持）
- `src/main/account-discovery/discover-and-create.ts`：`multiple` 探测结果目前不落库、不标记 `bound`（design.md 决策 2 遗留缺口），操作2/3 依赖这个"同一 partition 可反复探测直到用户选定"的能力，需要确认现状是否已经满足或需要补一个"确认选择"的触发点
- `src/main/cookie-import/store.ts`：新增"渠道是否存在已导入 cookie"查询能力（供操作2置灰判断）；携程场景建号成功后需要标记 cookie 已消费
- `src/domain/ports/repositories.ts` / `OtaAccountRepository`：新增或复用 `listByChannel`（供操作3列出已有账号）
- `src/main/ipc/browser-handlers.ts` / `shared/ipc-channels.ts`：新增查询"该渠道已导入cookie状态"、"从cookie创建"、"从其他登录态创建（选择账号+选择公司）"对应的 IPC
- 关联测试：`login-tab-opener`、`cookie-import/store`、`AccountsNav`、`discover-and-create` 现有测试需同步调整
