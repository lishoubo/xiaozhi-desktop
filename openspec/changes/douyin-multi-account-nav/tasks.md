## 1. Domain：模型扩展

- [x] 1.1 修改 `domain/ota-account.ts`：`OtaAccount`/`OtaAccountCreateInput` 新增 `channelContext: string | null`、`discoveredAt: number`（epoch ms）两个字段（design.md §2.1）
- [x] 1.2 修改 `domain/ports/repositories.ts`：`OtaAccountRepository` 新增 `listByChannel(channel: ChannelId): readonly OtaAccount[]` 方法签名（design.md §6.1）
- [x] 1.3 为 1.1 编写裸 vitest 单测：`channelContext`/`discoveredAt` 的默认值与校验（不 mock 任何框架依赖）

## 2. main/database：持久化扩展

- [x] 2.1 新增 SQLite migration（version 5）：`ota_account` 表新增 `channel_context TEXT`、`discovered_at INTEGER NOT NULL` 两列；已有历史数据的 `discovered_at` 用 `created_at` 回填初始值（`ALTER TABLE` + `UPDATE`，不能让老数据的这一列是 NULL，`listByChannel` 排序依赖它）
- [x] 2.2 修改 `SqliteOtaAccountRepository`：`create`/`findByChannelAndHotelId`/`updatePartitionName` 的 `SELECT_COLUMNS`、INSERT 语句同步带上新增两列；新增 `listByChannel(channel)` 实现（`SELECT ... WHERE channel = ? ORDER BY discovered_at DESC`）
- [x] 2.3 为 2.2 编写测试：`listByChannel` 返回按 `discoveredAt` 降序、跨渠道过滤正确；`create` 正确写入 `channelContext`/`discoveredAt`；已有测试数据（`channelContext`/`discoveredAt` 新增前的用例）同步更新

## 3. main/account-discovery：探测层写入新字段

- [x] 3.1 修改 `discover-and-create.ts`：`createOrUpdate` 调用处补上 `channelContext`、`discoveredAt: Date.now()`（design.md §2.2）；抖音场景 `channelContext` 取值为 URL 判定阶段已解析出的 `groupid`（`DouyinDiscoveryProbe.discover()` 的 `groupId` 变量，需要作为返回值的一部分透传给 `discover-and-create.ts`，当前 `DiscoveryOutcome`/`DiscoveredOtaHotel` 里没有这个字段，需要新增）；携程场景 `channelContext` 恒为 `null`
- [x] 3.2 为 3.1 编写/更新测试：`discover-and-create.test.ts` 覆盖 `channelContext` 透传；`douyin-discovery.test.ts`（待 4.5c 补齐时一并覆盖）确认 `groupId` 出现在 `DiscoveryOutcome` 里

## 4. main/browser：`BrowserTab` 携带 partitionName（如缺失）

- [x] 4.1 确认 `BrowserTab` 类型是否已有 `partitionName` 字段；没有则补上（design.md §7.2 提到 `AccountsNav.svelte` 的 `findTabIdByPartition` 依赖它按 partition 反查已打开的标签页）
- [x] 4.2 若 4.1 有改动，同步更新 `shared/browser.ts` 类型定义与相关单测

## 5. IPC 与 preload

- [x] 5.1 新增 `shared/ipc-channels.ts`：`otaAccount.listByChannel`、`otaAccount.openExisting`（design.md §6.2）
- [x] 5.2 新增 `main/ipc/` handler：`listByChannel(channel)` 直接代理 repository；`openExisting(accountId)` 内部查 `OtaAccountRepository` 拿 `partitionName`/`channel`/`channelContext` → 按渠道拼落地 URL（抖音 `channelContext` 非空时拼 `https://life.douyin.com/p/home?groupid=${channelContext}`，携程用渠道默认 URL）→ 调 `BrowserManager.createWithAlreadyPartition`（design.md §6.2）
- [x] 5.3 更新 `preload/api.ts`：暴露 `otaAccount.listByChannel`、`otaAccount.openExisting`
- [x] 5.4 为 5.2 编写单测：`openExisting` 对抖音/携程分别拼出正确 URL；`listByChannel` 透传 repository 结果

## 6. renderer：账号二级导航

- [x] 6.1 新增 `components/browser/AccountsNav.svelte`：渠道图标条下方新增一行，展示当前 `activeChannelId` 的账号列表（design.md §1.1、§4）；`displayName` 为空时回退展示 `otaHotelId`；已打开标签页的账号视觉高亮（复用 `activeTabIds` 判断逻辑）
- [x] 6.2 修改 `BrowserWorkspace.svelte`：grid 布局从 3 行改 4 行，插入 `AccountsNav`；切换渠道图标时账号列表跟着重新拉取（design.md §3.3）
- [x] 6.3 `AccountsNav` 点击账号项：已有对应打开的标签页则激活，否则调 `otaAccount.openExisting` 新开（design.md §7.2 `openAccount` 逻辑）
- [x] 6.4 "+ 添加账号"按钮直接调用现有登录入口（`otaAccount.startLogin`，走 `createAndNewPartition`），不新增弹窗组件（design.md §3.1）
- [x] 6.5 边界情况实现：渠道下无绑定账号时二级导航只显示"+ 添加账号"（design.md §5）；账号数量多时横向滚动（复用既有 tablist 的 `overflow-x-auto`）
- [x] 6.6 组件测试覆盖：账号列表展示（含 `displayName` 回退）、点击已打开标签页激活 vs 新开、"添加账号"触发登录入口、空态展示

## 7. 收尾

- [x] 7.1 全量运行受影响模块的测试（domain、main/database、main/account-discovery、main/browser、main/ipc、renderer 组件）
- [x] 7.2a 真机验证过程中发现并修复：① `channelContext` 缺失（历史数据/探测未解析出 groupid）时 `otaAccountLandingUrl` 直接抛错导致"打开账号页面失败"——改为退化到不带 groupid 的登录后台首页；② 建号成功后二级导航不自动刷新，需退出重进——新增 `onAccountBound` 事件通道推送给 renderer；③ 点渠道图标会自动新开登录标签、抢在用户选账号之前触发——去掉 `selectChannel`/`onMount`/`finishCookiePrompt` 里的自动 `createTab`，"开新标签"完全交给账号二级导航
- [ ] 7.2b **待查根因，未解决**：真机验证中西子轻奢酒店、云上酒店(包头包百店)两个抖音账号点击后落到登录页。直接读取 partition 磁盘 Cookies 数据库确认——不是 cookie 过期（`ttwid`/`passport_csrf_token` 等辅助 cookie 均未过期），而是这份 partition **从建号那一刻起就没有保存住真正的登录会话 cookie**（`sessionid`/`sid_guard` 等核心凭证完全不存在，只有 csrf token/设备标识类辅助 cookie）。已删除这两条无效数据（本地 SQLite），`Opening existing OTA account`/`Browser tab created` 诊断日志已补上（见 `1cd0970`），下次复现时优先查：① 探测建号那次登录是否真的完成了完整的手机验证码认证流程，还是在拿到 groupid 后就被 URL 判定提前判定为"已登录"触发了探测；② CDP `webContents.debugger` 拦截响应期间是否会影响该 tab 正常的 cookie 写入时机
- [ ] 7.2c 携程已有账号在二级导航打开验证；抖音两次独立登录落在同一手机号/公司时 `partitionName` 自然相同、`otaHotelId` 不同的验证；已打开标签页再点账号项正确激活而非重复打开的验证——待 7.2b 根因查清后一并产出 verification.md
- [ ] 7.3 走 code-review 通道（独立 pass，不与 verification 合并）
