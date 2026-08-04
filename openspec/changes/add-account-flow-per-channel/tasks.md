# Tasks

## 1. main 进程：探测触发路径抽象

- [x] 1.1 `BrowserManager.createWithAlreadyPartition` 增加可选 `onUrlPastLogin`/`loginUrlMatcher` 参数（design.md 决策2），与 `createAndNewPartition` 签名对齐；不传时行为不变，验证既有流程B调用方不受影响
- [x] 1.2 `cookie-import/store.ts` 新增 `hasImportedCookies(userDataDir, channel)` 与 `deleteImportedCookies(userDataDir, channel)`
- [x] 1.3 `LoginTabOpener` 拆分：保留 `open()` 对应操作4"新建账号"（去掉现有的无条件 cookie 预填，改为纯新建不注入），新增方法对应操作2"从cookie创建"：
  - 携程分支：读取导入的 cookie 注入新 partition → 静默导航落地页 → 直接调用 `DiscoverAndCreate.trigger()`（不经过 `onUrlPastLogin`，design.md 决策3）→ 成功后调用 1.2 的 `deleteImportedCookies`（design.md 决策5）
  - 抖音分支：读取导入的 cookie 注入新 partition → 打开可见页面 → 挂 `onUrlPastLogin`/`loginUrlMatcher`（design.md 决策4），不删除 cookie 文件
  - 实现比原计划多改一处：`DiscoverAndCreate.trigger()` 从 `Promise<void>` 改为 `Promise<boolean>`（携程静默分支需要知道这次调用是否建号成功才能决定要不要删 cookie，`onAccountBound` 全局回调粒度不够，见 commit da744a3）
- [x] 1.4 新增操作3"从其他登录态创建"入口方法——未新增 main 层方法，直接在 IPC handler（`browser-handlers.ts`）内联实现：按 `accountId` 查 `OtaAccountRepository.findById` 拿 `partitionName` → 用 1.1 扩展后的 `createWithAlreadyPartition` 打开、挂探测回调；handler 内部判断非抖音渠道直接拒绝

## 2. IPC 层

- [x] 2.1 新增 IPC `ota-account:has-imported-cookies`（供操作2置灰判断，包一层 1.2 的 `hasImportedCookies`）
- [x] 2.2 新增 IPC `ota-account:create-from-cookie`（调用 1.3 新方法）
- [x] 2.3 新增 IPC `ota-account:create-from-existing-session`（调用 1.4），仅抖音渠道允许调用，携程调用时抛错"该渠道不支持从其他登录态创建账号"
- [x] 2.4 `shared/ipc-channels.ts` 补充对应 channel 声明；`preload/api.ts` 同步暴露三个新方法

## 3. renderer：操作面板与四按钮可用性

- [x] 3.1 `AccountsNav.svelte` 的"添加账号"改为渲染新增组件 `AddAccountPanel.svelte`（Dialog 弹窗，四操作按钮）
- [x] 3.2 打开面板时通过 2.1 与既有 `listByChannel` 查询计算按钮可用性：
  - 操作2 可用 ⟺ 该渠道有已导入 cookie
  - 操作3 可用 ⟺ 渠道为抖音 且 该渠道已有至少1个建号账号
  - 操作1、操作4 恒可用
- [x] 3.3 操作1"导入cookie"：面板内按钮打开既有 `CookieImportDialog` 组件（第三处触发入口，逻辑不改，仍是跨渠道一次性导入）；`BrowserWorkspace.svelte` 首次引导浮层与 `SettingsPage.svelte` 设置页入口保持不变；`CookieImportDialog` 关闭后面板重新查询 2.1 刷新操作2可用性
- [~] 3.4 操作2"从cookie创建"：已调用 2.2；**未做**按渠道区分的等待态文案（携程"正在验证"/抖音"请在打开的页面中选择公司"），当前是通用 `busy` 态 + `Spinner`，无渠道专属提示文案——后续优化项
- [x] 3.5 操作3"从其他登录态创建"（仅抖音渲染）：先展示已有账号列表供选择，选定后调用 2.3
- [x] 3.6 操作4"新建账号"：复用现状 `startLogin` 调用路径，行为不变

## 4. 收尾

- [x] 4.1 `LoginTabOpener` 无遗留死代码（`open()` 已去掉预填，`createFromCookie()` 是独立新方法）
- [x] 4.2 定向单测：`cookie-import/store.ts` 新增函数、`LoginTabOpener` 携程/抖音两分支、`createWithAlreadyPartition`/`createAndNewPartition` 新参数不传时行为不变、`discover-and-create.trigger()` 返回值语义、`browser-handlers` 新 handler 分支，共补充/调整 5 个测试文件
- [x] 4.3 跑了 main 层全部单测（22 个测试文件，112 个测试全部通过），未跑全量套件
- [~] 4.4 真机验证部分完成：
  - 已验证：携程"从cookie创建"成功建号（真机日志确认 `Discovery outcome: single`）；操作面板弹窗可正常打开/关闭
  - 发现并修复 2 个真机 bug（已在 commit da744a3 修复）：① 已打开标签页存在时操作面板被 `WebContentsView` 遮挡点不到按钮；② 切换到无已打开标签页的渠道时，上一渠道标签页未被移除
  - **未验证**：抖音"从cookie创建"选公司建号；抖音"从其他登录态创建"选账号再选新公司建号；四按钮置灰规则的完整真机核对
  - **已知不相关问题**：真机验证期间复现了抖音探测层已有问题（`Douyin discovery: failed to read dsl/get response body` → `Discovery outcome: none`），发生在"新建账号"（操作4，非本次新增路径）流程中，判断为既有根因、非本次改动引入的回归，未展开排查（用户中止了相关调研）
