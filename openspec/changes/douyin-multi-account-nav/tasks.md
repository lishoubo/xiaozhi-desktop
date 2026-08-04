## 1. Domain：模型扩展

- [ ] 1.1 修改 `domain/ota-account.ts`：`OtaAccount`/`OtaAccountCreateInput` 新增 `channelContext: string | null`、`discoveredAt: number`（epoch ms）两个字段（design.md §2.1）
- [ ] 1.2 修改 `domain/ports/repositories.ts`：`OtaAccountRepository` 新增 `listByChannel(channel: ChannelId): readonly OtaAccount[]` 方法签名（design.md §6.1）
- [ ] 1.3 为 1.1 编写裸 vitest 单测：`channelContext`/`discoveredAt` 的默认值与校验（不 mock 任何框架依赖）

## 2. main/database：持久化扩展

- [ ] 2.1 新增 SQLite migration（version 5）：`ota_account` 表新增 `channel_context TEXT`、`discovered_at INTEGER NOT NULL` 两列；已有历史数据的 `discovered_at` 用 `created_at` 回填初始值（`ALTER TABLE` + `UPDATE`，不能让老数据的这一列是 NULL，`listByChannel` 排序依赖它）
- [ ] 2.2 修改 `SqliteOtaAccountRepository`：`create`/`findByChannelAndHotelId`/`updatePartitionName` 的 `SELECT_COLUMNS`、INSERT 语句同步带上新增两列；新增 `listByChannel(channel)` 实现（`SELECT ... WHERE channel = ? ORDER BY discovered_at DESC`）
- [ ] 2.3 为 2.2 编写测试：`listByChannel` 返回按 `discoveredAt` 降序、跨渠道过滤正确；`create` 正确写入 `channelContext`/`discoveredAt`；已有测试数据（`channelContext`/`discoveredAt` 新增前的用例）同步更新

## 3. main/account-discovery：探测层写入新字段

- [ ] 3.1 修改 `discover-and-create.ts`：`createOrUpdate` 调用处补上 `channelContext`、`discoveredAt: Date.now()`（design.md §2.2）；抖音场景 `channelContext` 取值为 URL 判定阶段已解析出的 `groupid`（`DouyinDiscoveryProbe.discover()` 的 `groupId` 变量，需要作为返回值的一部分透传给 `discover-and-create.ts`，当前 `DiscoveryOutcome`/`DiscoveredOtaHotel` 里没有这个字段，需要新增）；携程场景 `channelContext` 恒为 `null`
- [ ] 3.2 为 3.1 编写/更新测试：`discover-and-create.test.ts` 覆盖 `channelContext` 透传；`douyin-discovery.test.ts`（待 4.5c 补齐时一并覆盖）确认 `groupId` 出现在 `DiscoveryOutcome` 里

## 4. main/browser：`BrowserTab` 携带 partitionName（如缺失）

- [ ] 4.1 确认 `BrowserTab` 类型是否已有 `partitionName` 字段；没有则补上（design.md §7.2 提到 `AccountsNav.svelte` 的 `findTabIdByPartition` 依赖它按 partition 反查已打开的标签页）
- [ ] 4.2 若 4.1 有改动，同步更新 `shared/browser.ts` 类型定义与相关单测

## 5. IPC 与 preload

- [ ] 5.1 新增 `shared/ipc-channels.ts`：`otaAccount.listByChannel`、`otaAccount.openExisting`（design.md §6.2）
- [ ] 5.2 新增 `main/ipc/` handler：`listByChannel(channel)` 直接代理 repository；`openExisting(accountId)` 内部查 `OtaAccountRepository` 拿 `partitionName`/`channel`/`channelContext` → 按渠道拼落地 URL（抖音 `channelContext` 非空时拼 `https://life.douyin.com/p/home?groupid=${channelContext}`，携程用渠道默认 URL）→ 调 `BrowserManager.createWithAlreadyPartition`（design.md §6.2）
- [ ] 5.3 更新 `preload/api.ts`：暴露 `otaAccount.listByChannel`、`otaAccount.openExisting`
- [ ] 5.4 为 5.2 编写单测：`openExisting` 对抖音/携程分别拼出正确 URL；`listByChannel` 透传 repository 结果

## 6. renderer：账号二级导航

- [ ] 6.1 新增 `components/browser/AccountsNav.svelte`：渠道图标条下方新增一行，展示当前 `activeChannelId` 的账号列表（design.md §1.1、§4）；`displayName` 为空时回退展示 `otaHotelId`；已打开标签页的账号视觉高亮（复用 `activeTabIds` 判断逻辑）
- [ ] 6.2 修改 `BrowserWorkspace.svelte`：grid 布局从 3 行改 4 行，插入 `AccountsNav`；切换渠道图标时账号列表跟着重新拉取（design.md §3.3）
- [ ] 6.3 `AccountsNav` 点击账号项：已有对应打开的标签页则激活，否则调 `otaAccount.openExisting` 新开（design.md §7.2 `openAccount` 逻辑）
- [ ] 6.4 "+ 添加账号"按钮直接调用现有登录入口（`otaAccount.startLogin`，走 `createAndNewPartition`），不新增弹窗组件（design.md §3.1）
- [ ] 6.5 边界情况实现：渠道下无绑定账号时二级导航只显示"+ 添加账号"（design.md §5）；账号数量多时横向滚动（复用既有 tablist 的 `overflow-x-auto`）
- [ ] 6.6 组件测试覆盖：账号列表展示（含 `displayName` 回退）、点击已打开标签页激活 vs 新开、"添加账号"触发登录入口、空态展示

## 7. 收尾

- [ ] 7.1 全量运行受影响模块的测试（domain、main/database、main/account-discovery、main/browser、main/ipc、renderer 组件）
- [ ] 7.2 人工验证：① 携程已有账号能在二级导航打开；② 抖音两次独立登录落在同一手机号/公司时，两条记录 `partitionName` 自然相同、`otaHotelId` 不同；③ 已打开标签页再点账号项能正确激活而非重复打开，产出 verification.md
- [ ] 7.3 走 code-review 通道（独立 pass，不与 verification 合并）
