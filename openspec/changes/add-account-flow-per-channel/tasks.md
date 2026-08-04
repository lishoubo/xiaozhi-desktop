# Tasks

## 1. main 进程：探测触发路径抽象

- [ ] 1.1 `BrowserManager.createWithAlreadyPartition` 增加可选 `onUrlPastLogin`/`loginUrlMatcher` 参数（design.md 决策2），与 `createAndNewPartition` 签名对齐；不传时行为不变，验证既有流程B调用方不受影响
- [ ] 1.2 `cookie-import/store.ts` 新增 `hasImportedCookies(userDataDir, channel)` 与 `deleteImportedCookies(userDataDir, channel)`
- [ ] 1.3 `LoginTabOpener` 拆分：保留 `open()` 对应操作4"新建账号"（去掉现有的无条件 cookie 预填，改为纯新建不注入），新增方法对应操作2"从cookie创建"：
  - 携程分支：读取导入的 cookie 注入新 partition → 静默导航落地页 → 直接调用 `DiscoverAndCreate.trigger()`（不经过 `onUrlPastLogin`，design.md 决策3）→ 成功后调用 1.2 的 `deleteImportedCookies`（design.md 决策5）
  - 抖音分支：读取导入的 cookie 注入新 partition → 打开可见页面 → 挂 `onUrlPastLogin`/`loginUrlMatcher`（design.md 决策4），不删除 cookie 文件
- [ ] 1.4 新增操作3"从其他登录态创建"入口方法（main 层，供 IPC 调用）：按 `accountId` 查 `OtaAccountRepository.findById` 拿 `partitionName` → 用 1.1 扩展后的 `createWithAlreadyPartition` 打开、挂探测回调（仅抖音场景会被调用，携程分支不提供此方法的 IPC 入口）

## 2. IPC 层

- [ ] 2.1 新增 IPC：查询"该渠道是否有已导入 cookie"（供操作2置灰判断，包一层 1.2 的 `hasImportedCookies`）
- [ ] 2.2 新增 IPC：触发"从cookie创建"（调用 1.3 新方法）
- [ ] 2.3 新增 IPC：触发"从其他登录态创建"（调用 1.4 新方法），仅抖音渠道允许调用，携程调用时明确拒绝并返回可读错误
- [ ] 2.4 `shared/ipc-channels.ts` 补充对应 channel 声明

## 3. renderer：操作面板与四按钮可用性

- [ ] 3.1 `AccountsNav.svelte` 的 `onAddAccount` 改为打开一个操作面板（新增组件），渲染最多4个操作按钮
- [ ] 3.2 打开面板时通过 2.1 与既有 `listByChannel` 查询计算按钮可用性：
  - 操作2 可用 ⟺ 该渠道有已导入 cookie
  - 操作3 可用 ⟺ 渠道为抖音 且 该渠道已有至少1个建号账号
  - 操作1、操作4 恒可用
- [ ] 3.3 操作1"导入cookie"：面板内按钮打开既有 `CookieImportDialog` 组件（第三处触发入口，逻辑不改，仍是跨渠道一次性导入）；`BrowserWorkspace.svelte` 首次引导浮层与 `SettingsPage.svelte` 设置页入口保持不变，不删除、不改造；`CookieImportDialog` 关闭后面板重新查询 2.1 刷新操作2可用性
- [ ] 3.4 操作2"从cookie创建"：调用 2.2，按渠道展示不同的等待态提示文案（携程"正在验证"，抖音"请在打开的页面中选择公司"）
- [ ] 3.5 操作3"从其他登录态创建"（仅抖音渲染）：先展示已有账号列表供选择，选定后调用 2.3
- [ ] 3.6 操作4"新建账号"：复用现状 `startLogin` 调用路径，行为不变

## 4. 收尾

- [ ] 4.1 删除 `LoginTabOpener` 中已废弃的无条件预填逻辑残留（确认 1.3 之后没有遗留死代码）
- [ ] 4.2 定向单测：`cookie-import/store.ts` 新增函数、`LoginTabOpener` 两个分支（携程静默探测成功/失败路径，抖音注入+挂回调路径）、`createWithAlreadyPartition` 新参数不传时行为不变
- [ ] 4.3 完成态跑一次受影响模块的既有测试（`login-tab-opener`、`cookie-import`、`discover-and-create`、`browser-manager` 相关用例），不跑全量套件
- [ ] 4.4 真机验证：携程"从cookie创建"成功建号、失败提示；抖音"从cookie创建"选公司建号；抖音"从其他登录态创建"选账号再选新公司建号；确认操作面板四按钮置灰规则符合预期（不做细粒度组件级UI测试，聚焦端到端业务路径是否走通）
