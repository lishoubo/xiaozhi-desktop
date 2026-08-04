# 渠道账号二级导航 + 抖音多账号复用 partition 技术方案

> **背景**：`cookie-login-account-discovery` 已经打通"导入 cookie → 去登录 → URL 判定 → 探测门店 → 建 `OtaAccount`"整条链路（携程已验证，抖音探测代码已提交但未真机验证）。但账号建成之后**没有任何入口能再打开它**——`BrowserManager.createWithAlreadyPartition`（流程B）已经实现，却从未被任何 IPC/UI 调用（`docs/arch/2026-08-03-login-tab-flows.md` 原话："账号列表页面尚不存在，等 Task 4 探测跑通后再补"）。
>
> 本方案要解决两件事：① 在浏览器工作区里加一个"账号列表"入口，把已绑定的门店账号亮出来，点击即可用流程B打开；② 抖音场景下，一份登录态（cookie/partition）可以管理多个门店账号，这与携程"一账号一 partition"的既有假设冲突，需要单独设计数据模型和交互取舍。

---

## 1. 展示位置

### 1.1 二级导航（本期采用）

在 `BrowserWorkspace.svelte` 现有的三行 grid 布局里，**渠道图标条（第一行）下方新增一行账号列表**，原有的"浏览器控制按钮 + 已打开标签页 tablist"整体下移一行：

```
┌─────────────────────────────────────────────┐
│ 🐮 🚀  ← 渠道图标条（既有，OTA_CHANNELS）      │  62px
├─────────────────────────────────────────────┤
│ 银际酒店(包头) │ 璞禾咖啡酒店 │ [+ 添加账号]    │  40px ← 新增：账号二级导航
├─────────────────────────────────────────────┤
│ ← → ⟳  │  标签页A  标签页B  [x]                │  48px（既有，不变）
├─────────────────────────────────────────────┤
│                                               │
│              浏览器 viewport                  │
│                                               │
└─────────────────────────────────────────────┘
```

只在**当前选中渠道**（`activeChannelId`）下展示该渠道已绑定的账号；切换渠道图标时账号列表跟着重新拉取/过滤。

### 1.2 与既有"已打开标签页 tablist"的关系（必须分清，不是同一层）

| 层级 | 数据来源 | 语义 |
|---|---|---|
| 账号二级导航（新增） | `OtaAccountRepository.listByChannel(channel)` | "这个渠道下我绑定了哪些门店"——账号维度，与浏览器标签页是否打开无关 |
| 已打开标签页 tablist（既有，不变） | `tabsByChannel[activeChannelId]` | "当前这个渠道我开了几个浏览器标签页"——运行时状态，关掉标签页账号仍然存在 |

点击账号二级导航某一项，如果该账号还没有对应打开的标签页，就新开一个（流程B）；如果已经开着，直接激活那个标签页——语义和现有 `selectChannel` 对渠道 tab 的"没有就新建、有就激活"完全一致，复用同一套 `activeTabIds`/`tabsByChannel` 状态管理，只是多一层"先按账号找 partitionName，再按 partitionName 找有没有对应标签页"的间接。

---

## 2. 数据语义

### 2.1 `OtaAccount` 表结构变化（本次仅设计 schema，不动代码）

现有字段（`domain/ota-account.ts`）：

```ts
{ id, channel, otaHotelId, displayName, partitionName }
```

新增两个字段：

| 字段 | 类型 | 用途 |
|---|---|---|
| `channelContext` | `string \| null` | 渠道特定的"免登录跳转上下文"，抖音存 `groupid`；携程当前用 URL 里的门店 ID 就能直接跳转，不需要这个字段，存 `null` |
| `discoveredAt` | `number`（epoch ms） | 这条账号记录最近一次建号/更新的时间；`listByChannel` 按此字段降序排序展示（见 §6.1） |

**`channelContext` 为什么不做成通用 `extra` JSON 字段**：Java 那套 RMS 系统遇到类似问题时用了通用 `extra` 字段存任意渠道特定数据，但那是历史包袱下"加字段有迁移成本"的权宜选择。本项目本地 SQLite、迁移成本几乎为零，直接加语义明确的具名字段更符合"避免投机抽象"的项目约束——`channelContext` 现在只有抖音在用，字段名不叫 `groupid` 是因为如果以后美团/其他渠道也需要类似的"重新进入门店后台需要的非 URL 参数上下文"，这个字段可以直接复用，不需要为每个渠道各开一个字段；但也不因此提前设计成结构化的多渠道 schema——用得上再加，YAGNI。

### 2.2 抖音场景下 `otaHotelId` 与 `channelContext` 的取值来源

回顾 `cookie-login-account-discovery/design.md` 决策 9 的探测流程：URL 判定命中 `/p/home?groupid=xxx` 后，探测层两步接口调用拿到 `poiId`/`poiName`。这里 `groupid` 已经在 URL 判定阶段就能拿到（不需要额外解析），建号时一并存入：

```ts
createOrUpdate({
  otaHotelId: poiId,           // 既有字段，真正的门店 ID
  displayName: poiName,
  channelContext: groupid,     // 新增字段，重新进入这个门店后台时用来拼 URL
  partitionName,                // 见 §2.3，抖音场景下可能被多个账号共享
  discoveredAt: Date.now(),
})
```

### 2.3 `partitionName` 语义变化：从"一账号一份"变成"同渠道下可被多账号共享"

**携程不受影响**：携程一个 partition 只登录一个账号，`OtaAccount.partitionName` 依然是一对一。

**抖音场景**：一个手机号登录后可能挂多个"公司"，每个公司选定后对应一个 `groupid`，探测出一个门店。用户在同一个登录标签页里，理论上可以退出当前公司、切换到另一个公司，各自建出一个 `OtaAccount`——这些账号的 `partitionName` **相同**（同一份 cookie/登录态）。反过来，用户也可能退出当前手机号、换登录另一个手机号，这时必须是一个**新的** partition。

关键约束（已用调研确认，非猜测）：
- Electron 没有官方 API 能枚举"磁盘上已存在的 partition"，项目自己在 `pending-partitions-store.ts` 里已经明确否定"读磁盘目录"这条路（Chromium 内部目录布局不是公开契约）
- 浏览器登录成功后，无法从 cookie/DOM/接口反查出"这份登录态对应哪个手机号"——`rms-rpa-worker` 的 RPA 脚本里手机号只在用户主动走验证码登录时（`payload.username`）才存在，cookie 导入场景下应用层从一开始就不知道手机号

**结论**：不引入手机号或任何形式的"登录态唯一标识"字段去自动判断"这份 cookie 是不是同一个人"。新增账号统一走独立登录（§3.1），不提供"复用已登录 cookie 去发现新门店"的入口——`partitionName` 相同只是两次独立登录巧合落在同一份登录态上的自然结果，不是应用层刻意设计的复用路径。

---

## 3. 交互

### 3.1 新增账号入口

二级导航最后固定一个"+ 添加账号"按钮，点击后直接走现有的"去登录"流程（流程A，`createAndNewPartition`），新建一个全新 partition——不弹窗选择，不提供"复用已登录 cookie"的入口。

**为什么不做"复用已登录的 Cookie"选项**：探测（`discover-and-create.ts` 的 `trigger()`）这个动作本来就只服务于"这次登录到达首页"这一时刻，不服务于"同一份已登录 partition 下继续发现更多门店"——`DiscoverAndCreate` 内部按 `partitionName` 记录 `bound` 状态，一个 partition 探测成功一次后不再重复触发（性能考量，见 `cookie-login-account-discovery/design.md` 决策 8），如果要支持"复用已登录 cookie 再探测出一个新门店"，需要改变这个去重语义，超出本次改动范围。§2.3 提到的"`partitionName` 相同"是两次独立登录巧合落在同一份登录态上的自然结果，不是这里刻意设计的交互路径。

### 3.2 已绑定账号登录失效后的重新登录

账号列表某一项如果打开后 URL 判定停在登录页（说明这个 partition 的 cookie 已过期），提供"重新登录"操作——**更新的是这个 partition 本身的 cookie**，不是新建 partition、不是改某个 `OtaAccount.partitionName`。因为同一 partition 下可能挂着多个账号（抖音场景），重新登录一次，所有关联这个 partition 的账号自动一起恢复登录态，不需要逐个处理。

本期这条"检测登录失效并提示重新登录"的判定逻辑不做（见 §7 本期不做），先把"点击账号列表 → 用 `createWithAlreadyPartition` 打开标签页"这条主链路跑通。

### 3.3 查询触发

- 进入浏览器工作区、切换渠道图标：拉取该渠道账号列表并展示
- 账号列表本期不支持手动刷新按钮，跟随渠道切换自然重新拉取（数据量小，全量 IPC 查询即可，不需要分页/防抖）

---

## 4. 账号列表项展示

| 内容 | 数据来源 | 展示格式 |
|---|---|---|
| 门店名 | `OtaAccount.displayName` | 主文案，超长截断 + Tooltip 显示全名 |
| 未打开标签页时的图标 | 无 | 灰色圆点或渠道图标弱化态 |
| 已打开标签页时的图标 | 该账号是否有对应 `BrowserTab` | 与既有 tablist 高亮态视觉一致（复用 `activeTabIds` 判断逻辑） |

`displayName` 为空（探测阶段未解析出门店名的极端情况）时主文案回退为 `otaHotelId`。

---

## 5. 边界情况

| 场景 | 处理 |
|---|---|
| 渠道下没有任何绑定账号 | 二级导航只显示"+ 添加账号"，不展示空态占位文案（区别于表格类页面的空态，这里只是一条更短的操作栏） |
| 同一渠道下账号数量很多（如 10+ 门店） | 二级导航横向滚动（复用既有 tablist 的 `overflow-x-auto`），本期不做搜索/筛选 |
| 点击账号但该账号的 partition 已被清理（极端情况：磁盘目录被外部工具删除） | `createWithAlreadyPartition` 打开标签页后落地到登录页，等同于"登录失效"场景，用户重新登录覆盖同一 partition |
| 携程账号列表 | 展示逻辑与抖音完全一致（`channelContext` 为 `null`，不影响展示），实际上这个列表很少有超过 1 行 |
| 探测到 `multiple`（携程多店、决策2 提到但 Task 6/7 未实现的分支） | 与本次改动无关，`multiple` 结果目前仍不落库，账号列表看不到这些"待认领"的探测结果——这是既有的已知缺口（`verification.md` §3.2），不在本方案范围内 |

---

## 6. 后端（main 进程）

### 6.1 `OtaAccountRepository` 新增方法

```ts
// domain/ports/repositories.ts
interface OtaAccountRepository {
  create(input: OtaAccountCreateInput): void;
  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaAccount | null;
  updatePartitionName(id: OtaAccountId, partitionName: string): void;
  listByChannel(channel: ChannelId): readonly OtaAccount[];  // 新增
}
```

`SqliteOtaAccountRepository` 实现：`SELECT * FROM ota_account WHERE channel = ? ORDER BY discovered_at DESC`。

### 6.2 新增 IPC channel

```ts
// shared/ipc-channels.ts
otaAccount: {
  startLogin: 'ota-account:start-login',       // 既有，流程A
  listByChannel: 'ota-account:list-by-channel', // 新增
  openExisting: 'ota-account:open-existing',    // 新增，流程B 的 IPC 包装
}
```

`openExisting(accountId)` handler 内部：查 `OtaAccountRepository` 拿到 `partitionName`/`channel`/`channelContext` → 拼 URL（抖音场景 `channelContext` 非空时拼 `https://life.douyin.com/p/home?groupid=${channelContext}`，携程场景直接用渠道默认 URL）→ 调 `BrowserManager.createWithAlreadyPartition`。

---

## 7. 前端（renderer）实现

### 7.1 文件结构（目标态）

```
src/renderer/
├── components/browser/
│   ├── BrowserWorkspace.svelte        # 修改：grid 行数从 3 行变 4 行，插入 AccountsNav
│   └── AccountsNav.svelte             # 新增：账号二级导航（列表 + 添加账号按钮，点击直接触发登录流程）
```

### 7.2 `AccountsNav.svelte` 关键状态（示意，非最终实现）

```ts
let accounts = $state<OtaAccount[]>([]);

async function loadAccounts(channelId: string): Promise<void> {
  accounts = await window.hotelButler.otaAccount.listByChannel(channelId);
}

async function openAccount(account: OtaAccount): Promise<void> {
  const existingTabId = findTabIdByPartition(account.partitionName); // 查 tabsByChannel
  if (existingTabId) {
    await window.hotelButler.browser.activate(existingTabId);
  } else {
    const tab = await window.hotelButler.otaAccount.openExisting(account.id);
    // 与既有 createTab 一样接入 updateTab/activeTabIds
  }
}
```

`findTabIdByPartition` 需要 `BrowserTab` 类型携带 `partitionName`（目前 `BrowserTab` 是否已有这个字段需要在实现阶段确认，如果没有需要顺带补上，本方案不展开）。

---

## 8. 本期不做

- 登录失效自动检测与提示（§3.2 已说明，先靠用户手动发现"打开后落到登录页"再自己点重新登录）
- 账号列表的搜索/筛选/排序自定义（本期固定按 `discoveredAt` 降序）
- 删除/解绑账号的入口
- 多门店探测结果（`multiple`）的确认 UI（属于 `cookie-login-account-discovery` 既有范围外的缺口，不在本方案处理）
- 美团渠道（探测本身未实现，账号列表天然为空，UI 不特殊处理）

---

## 9. 评审确认项

| # | 决定 |
|---|---|
| 1 | 二级导航位置：`BrowserWorkspace.svelte` 渠道图标条正下方，独立一行，不与已打开标签页 tablist 合并 |
| 2 | `OtaAccount` 新增 `channelContext`（渠道特定跳转上下文，抖音存 groupid）+ `discoveredAt`（`listByChannel` 排序用） |
| 3 | 不引入手机号或任何登录态唯一标识；不提供"复用已登录 cookie 去发现新门店"的入口，`partitionName` 相同只是两次独立登录巧合落在同一份登录态上的自然结果 |
| 4 | 新增账号统一走"重新登录"（`createAndNewPartition`，新建 partition），不提供复用已登录 cookie 的入口——探测本来就只服务于"这次登录到达首页"这一时刻（见 §3.1） |
| 5 | 已绑定账号登录失效后走"重新登录覆盖同一 partition"，不新建 partition，同 partition 下所有账号一起恢复 |
| 6 | 本次只写方案设计 schema，不动 `domain/ota-account.ts`、不写 migration、不实现 IPC/UI 代码 |
