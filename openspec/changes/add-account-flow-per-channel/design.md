# 添加账号：cookie 导入接入建号流程 技术方案

> **背景**：现有 `CookieImportDialog` 导入的 cookie 落盘后没有消费方——`LoginTabOpener.open()` 曾经悄悄做过预填，但预填对已确认的 `douyin-multi-account-nav/design.md` 决策 #3/#4（"不提供复用已登录 cookie 的入口"）是矛盾的，本次移除。改为把"是否用 cookie 建号"变成用户在"添加账号"入口显式选择的操作，携程与抖音的差异（一份 cookie 对应几个账号）体现在操作可用性和探测触发方式上，不体现在预填这种隐式行为里。
>
> **导入本身不是本次改动范围**：`cookies.import` IPC 是**全局、跨渠道**的一次性操作——用户选一个系统浏览器来源，`readCookies()` 一口气读出该浏览器里 douyin/ctrip/meituan 全部渠道的 cookie，分渠道落盘到 `cookie-imports/<channel>/`（`browser-cookie-importer.ts:595-598` 决策 1）。现有两个触发入口不变：`BrowserWorkspace.svelte` 首次引导浮层、`SettingsPage.svelte` 设置页按钮，二者都是同一个 `CookieImportDialog.svelte` 组件。本次"添加账号"面板的操作①**不是重新实现导入**，而是复用同一个 `CookieImportDialog` 组件（面板内触发第三处入口），导入完成后刷新面板内操作②的可用性判断。

---

## 1. 交互位置与入口变化

### 1.1 "添加账号"从单按钮变成操作面板

```
现状（AccountsNav.svelte）：
┌──────────────────────────────────────────┐
│ 银际酒店(包头) │ 璞禾咖啡酒店 │ [+ 添加账号] │
└──────────────────────────────────────────┘
                                    │ 点击直接走流程A（新建登录）
                                    ▼
                            新建 partition + 登录页

本次（新增操作面板）：
┌──────────────────────────────────────────┐
│ 银际酒店(包头) │ 璞禾咖啡酒店 │ [+ 添加账号] │
└──────────────────────────────────────────┘
                                    │ 点击打开操作面板
                                    ▼
                ┌───────────────────────────────┐
                │  添加账号 · 携程                │
                │  ┌───────────┐ ┌─────────────┐│
                │  │① 导入cookie│ │② 从cookie创建││ ①=打开全局 CookieImportDialog
                │  └───────────┘ └─────────────┘│ ②灰=该渠道尚无已导入cookie
                │  ┌───────────┐ ┌─────────────┐│
                │  │③从其他登录 │ │④ 新建账号    ││ 携程不渲染③
                │  │  态创建    │ │             ││ 抖音：无已建号账号时③置灰
                │  └───────────┘ └─────────────┘│
                └───────────────────────────────┘
```

**注意**：①「导入cookie」打开的是**全局**导入弹窗，一次操作会把所选浏览器里携程/抖音/美团全部渠道的 cookie 一并导入，不是只导入当前面板所在的这个渠道——用户即使在携程面板点①，抖音的 cookie 也会一起被导入。这与现有 `SettingsPage.svelte`/首次引导浮层的导入行为完全一致，面板只是提供第三个触发入口。

### 1.2 四个操作的可用性矩阵

| 操作 | 携程 | 抖音 | 可用性判断 |
|---|---|---|---|
| ① 导入 cookie | 恒可用 | 恒可用 | 无 |
| ② 从 cookie 创建 | 有已导入 cookie 才可用 | 有已导入 cookie 才可用 | `hasImportedCookies(channel)` |
| ③ 从其他登录态创建 | **不渲染** | 有 ≥1 个已建号账号才可用 | `channel === 'douyin' && listByChannel(channel).length > 0` |
| ④ 新建账号 | 恒可用 | 恒可用 | 无（现状流程A不变） |

---

## 2. 模块关系

```
renderer                          main                              domain
─────────                         ────                              ──────
AccountsNav.svelte
  └─ onAddAccount()
       │ 打开操作面板
       ▼
AddAccountPanel.svelte (新增)
  ├─ ① onImportCookie ────────► 打开既有 CookieImportDialog（第三处入口，逻辑不变，
  │                                跨渠道一次性导入；关闭后重新查②的可用性）
  ├─ ② onCreateFromCookie ────► ota-account:create-from-cookie (新增 IPC)
  │                                   │
  ├─ ③ onCreateFromExisting ──► ota-account:create-from-existing-session (新增 IPC)
  │     （先选已建号账号）              │
  └─ ④ onNewLogin ────────────► ota-account:start-login（既有）
                                       │
                                       ▼
                            ┌──────────────────────┐
                            │  LoginTabOpener        │
                            │  ├─ open()             │ 操作④，现状不变，去掉预填
                            │  ├─ createFromCookie() │ 操作②，新增
                            │  └─ (操作③走 handler   │
                            │      直接调 BrowserManager)
                            └──────────┬────────────┘
                                       ▼
                            ┌──────────────────────┐
                            │  BrowserManager        │
                            │  ├─ createAndNewPartition()      │ 操作②④用
                            │  └─ createWithAlreadyPartition()  │ 操作③用，
                            │      + 新增 onUrlPastLogin 参数    │ 需扩展签名
                            └──────────┬────────────┘
                                       ▼
                            ┌──────────────────────┐
                            │  DiscoverAndCreate     │──► OtaAccountRepository
                            │  .trigger()            │       (domain/ports)
                            └────────────────────────┘

cookie-import/store.ts（扩展）
  ├─ readImportedCookies()      既有
  ├─ writeImportedCookies()     既有
  ├─ hasImportedCookies()       新增：供①②可用性判断
  └─ deleteImportedCookies()    新增：携程操作②建号成功后消费
```

---

## 3. 流程：携程「从 cookie 创建」（操作②）

携程一份 cookie 对应一个账号，不经过可见登录页，直接静默判定：

```
用户点击「从cookie创建」
        │
        ▼
读取 cookie-imports/ctrip/ 已导入的 cookie
        │
        ▼
BrowserManager.createAndNewPartition(env, 'ctrip', 落地页URL, { importedCookies })
        │  不传 onUrlPastLogin / loginUrlMatcher —— 这条路径没有"等待用户登录"这一步
        ▼
静默导航到落地页完成
        │
        ▼
直接调用 DiscoverAndCreate.trigger(partitionName, 'ctrip', landingUrl, webContents)
        │
        ├─ probe.discover() 命中 single ──► 建号成功 ──► deleteImportedCookies('ctrip')
        │                                                  （cookie 已消费，操作②重新置灰）
        │
        └─ probe.discover() 未命中（cookie失效/未登录）──► 建号失败
                                                            │
                                                            ▼
                                          UI 提示"cookie 已失效，请改用「新建账号」"
                                          （cookie 文件保留，不删除）
```

**关键点**：携程分支**不使用** `loginUrlMatcher` 机制——那是"判断用户手动登录是否成功"的语义，携程这条路径没有用户交互，cookie 有效与否直接由探测结果决定。

---

## 4. 流程：抖音「从 cookie 创建」（操作②）与「从其他登录态创建」（操作③）

抖音一份登录态可能挂多个公司，两个操作在"打开页面之后"共用同一条探测触发路径，只是 partition 来源不同：

```
操作②：读取 cookie-imports/douyin/ 已导入的 cookie
         │
         ▼
      BrowserManager.createAndNewPartition(env, 'douyin', url, {
        importedCookies,
        onUrlPastLogin, loginUrlMatcher    ← 挂载，与操作④一致
      })

操作③：先弹出已建号账号列表，用户选择一个 account
         │
         ▼
      BrowserManager.createWithAlreadyPartition(account.partitionName, 'douyin', url, {
        onUrlPastLogin, loginUrlMatcher    ← 新增参数（决策见 §6.2）
      })

                    │  两条路径殊途同归
                    ▼
        打开可见页面（life.douyin.com），用户在原生页面里选择/切换公司
                    │
                    ▼
        URL 落到 /p/home?groupid=xxx，命中 loginUrlMatcher
                    │
                    ▼
        DiscoverAndCreate.trigger(partitionName, 'douyin', landingUrl, webContents)
                    │
                    ├─ single  ──► 建号成功（cookie 文件不删除，可能还要选下一个公司）
                    ├─ multiple ─► 不落库（现状行为，§6.4 说明），等用户在页面里继续选择
                    └─ 用户再切换一次公司 ──► URL 再次变化 ──► 再次 trigger()（幂等，见 discover-and-create.ts 的 inflight/bound 去重）
```

---

## 5. 后端改动清单

### 5.1 `BrowserManager.createWithAlreadyPartition` 扩展签名

```ts
// src/main/browser/browser-manager.ts
createWithAlreadyPartition(
  partitionName: string,
  channelId: string,
  url: string,
  options: Readonly<{
    onUrlPastLogin?: (partitionName: string, landingUrl: string, webContents: WebContents) => void;
    loginUrlMatcher?: LoginUrlMatcher;
  }> = {},
): BrowserTab
```
不传 `options` 时行为与现状完全一致（流程B"打开已有账号"调用方不用改）。

### 5.2 `cookie-import/store.ts` 新增

```ts
export async function hasImportedCookies(userDataDir: string, channel: ChannelId): Promise<boolean>
export async function deleteImportedCookies(userDataDir: string, channel: ChannelId): Promise<void>
```

### 5.3 `LoginTabOpener` 新增方法

```ts
// src/main/features/ota-account/login-tab-opener.ts
class LoginTabOpener {
  open(...)              // 操作④，现状方法，去掉预填 cookie 逻辑
  createFromCookie(environment, channel, url): Promise<BrowserTab>  // 操作②，新增
}
```
`createFromCookie` 内部按 `channel === 'ctrip'` 与 `channel === 'douyin'` 走 §3/§4 两条不同分支——差异只在"是否挂 `onUrlPastLogin`/`loginUrlMatcher`"和"成功后是否删除 cookie"，复用同一个 `browser.createAndNewPartition` 调用。

### 5.4 新增 IPC

```ts
// shared/ipc-channels.ts 追加
otaAccount: {
  hasImportedCookies: 'ota-account:has-imported-cookies',        // 供②可用性判断（①导入本身不经此IPC，复用既有 cookies.import）
  createFromCookie: 'ota-account:create-from-cookie',             // 操作②
  createFromExistingSession: 'ota-account:create-from-existing-session', // 操作③，仅抖音允许调用
}
```
`createFromExistingSession` handler 收到非抖音渠道时直接拒绝（`throw new Error('该渠道不支持从其他登录态创建账号')`），不在 main 层再做一次隐藏的渠道分支判断——UI 层已经不渲染③，这里是防御性兜底。

---

## 6. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 可用性判断放 renderer 侧，打开面板时现查，不由 main 主动推送状态 | 只有两个布尔条件，查询成本低，不需要额外的状态同步机制 |
| 2 | `createWithAlreadyPartition` 加可选参数而不是新开一个方法 | 现有调用方（流程B）不传参数时行为不变，避免拆分成两个几乎重复的方法 |
| 3 | 携程②不复用 `loginUrlMatcher`，直接静默判定 | `loginUrlMatcher` 语义是"等待用户登录交互"，携程②没有用户交互这一步，语义不匹配 |
| 4 | 抖音②③共用同一条"挂回调等待用户选公司"路径 | 两者的差异只是 partition 来源（新建注入 cookie / 复用已有账号），落地后逻辑完全一致 |
| 5 | 携程②成功后删除 cookie 文件；抖音②不删除 | 携程一份 cookie 一次性用途，删除后操作②自然重新置灰；抖音一份 cookie 可能反复选公司建多个账号 |
| 6 | `multiple` 探测结果继续不落库、不做选择 UI | `douyin-multi-account-nav/design.md` §5 已标记为已知缺口，不在本次范围内，用户在渠道原生页面里手动切换公司即可绕过 |

---

## 7. 边界情况

| 场景 | 处理 |
|---|---|
| 携程操作②，cookie 已失效 | 探测未命中 single，建号失败，提示"cookie 已失效，请改用「新建账号」"，cookie 文件保留 |
| 携程操作②，探测成功 | 删除 `cookie-imports/ctrip/`，操作②重新置灰 |
| 抖音操作②③，用户中途关闭标签页未选公司 | 不建号，不产生副作用，`inflight`/`bound` 状态在下次打开时重新开始 |
| 抖音操作③，选中的账号 partition 已被清理 | 落地到登录页，等同登录失效场景，用户在页面内重新登录覆盖同一 partition（与 `douyin-multi-account-nav/design.md` §5 已有边界一致） |
| 携程调用 `createFromExistingSession` IPC（异常路径，UI 本不应触发） | handler 直接抛错拒绝 |
| 操作面板打开时两个可用性查询都返回否 | ①④恒可用，②③置灰/不渲染，不是空态，用户至少能新建账号 |

---

## 8. 本期不做

- `multiple` 探测结果的选择确认 UI（沿用 `douyin-multi-account-nav/design.md` 已知缺口）
- 登录失效自动检测（沿用该文档 §8）
- cookie 导入文件的管理入口（查看/手动删除）
- 携程"从其他登录态创建"（一份登录态只对应一个账号，无复用意义，不提供）

---

## 9. 风险 / 权衡

| 风险/权衡 | 应对 |
|---|---|
| 携程②静默导航无可见登录页，用户看不到失败过程 | 探测失败后用文案明确提示，引导改走④ |
| `createWithAlreadyPartition` 新增可选回调，若遗漏挂载会导致操作③打开页面后无任何反馈 | 与操作④保持一致的模型：IPC 调用本身只负责"打开"，后续状态变化统一靠既有 `onAccountBound` 事件通知 renderer 刷新列表 |
| 携程②成功后立即删除 cookie 文件，无法找回 | 仅在探测**成功**后才删除，失败/未触发时文件保留，不存在因失败丢失的场景 |

## Migration Plan

不涉及数据库 schema 变更（复用现有 `OtaAccount`/`channelContext` 字段）。纯功能新增/重构，无迁移脚本。回滚：还原 `AccountsNav.svelte`、`LoginTabOpener`、`browser-manager.ts`、`cookie-import/store.ts` 相关改动即可，不涉及不可逆数据变更。
