# 添加账号：cookie 导入接入建号流程 技术方案

> **背景**：现有 `CookieImportDialog` 导入的 cookie 落盘后没有消费方——`LoginTabOpener.open()` 曾经悄悄做过预填，但预填对已确认的 `douyin-multi-account-nav/design.md` 决策 #3/#4（"不提供复用已登录 cookie 的入口"）是矛盾的，本次移除。改为把"是否用 cookie 建号"变成用户显式选择的操作，携程与抖音的差异（一份 cookie 对应几个账号）体现在操作可用性和探测触发方式上，不体现在预填这种隐式行为里。
>
> **导入本身不是本次改动范围**：`cookies.import` IPC 是**全局、跨渠道**的一次性操作——用户选一个系统浏览器来源，`readCookies()` 一口气读出该浏览器里 douyin/ctrip/meituan 全部渠道的 cookie，分渠道落盘到 `cookie-imports/<channel>/`（`browser-cookie-importer.ts:595-598` 决策 1）。触发入口不变：`BrowserWorkspace.svelte` 首次引导浮层、`SettingsPage.svelte` 设置页入口，二者都是同一个 `CookieImportDialog.svelte` 组件。
>
> **§1-§9 是上一轮（"添加账号四操作面板"）方案，已实现并部分真机验证，本文档保留作为历史记录。§10 起是本轮修订**——四操作面板在真机验证中暴露"用户看不到已导入哪些渠道的 cookie、导入时间"的可用性问题，改为把①②③迁移到设置页"已登录 Cookie 列表"，添加账号面板收敛为单一"新建账号"（原④）。阅读时以 §10 为准，§1-§9 中与 §10 冲突的部分（四操作面板结构、携程 cookie 消费策略）以 §10 为准。

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

---

## 10. 本轮修订：cookie 列表页替代添加账号面板的①②③

### 10.1 交互结构变化

```
设置页（SettingsPage.svelte）：
┌──────────────────────────────────────────────┐
│ Cookie          [已登录 Cookie 列表]           │  原按钮位置改为打开新弹窗
└──────────────────────────────────────────────┘
                        │ 点击打开
                        ▼
        ┌───────────────────────────────────────┐
        │  已登录 Cookie 列表      [导入 Cookie]  │  右上角＝既有 CookieImportDialog
        ├───────────────────────────────────────┤
        │  携程        导入于 2026-08-03 14:20    │
        │                          [登录账号]     │  ← createFromCookie
        ├───────────────────────────────────────┤
        │  抖音        导入于 2026-08-04 09:11    │
        │              [登录账号] [从其他账号登录] │  ← 后者仅抖音，createFromExistingSession
        ├───────────────────────────────────────┤
        │  美团        导入于 2026-08-05 10:02    │
        │                          [登录账号]     │
        └───────────────────────────────────────┘
        没有已导入 cookie 的渠道不出现在列表里（不展示空行）

添加账号（AccountsNav.svelte → AddAccountPanel.svelte）：
┌──────────────────────────────────────────┐
│ 银际酒店(包头) │ 璞禾咖啡酒店 │ [+ 添加账号] │
└──────────────────────────────────────────┘
                                    │ 点击
                                    ▼
                          直接走新建登录（原④）
                    不再弹出四宫格操作面板——面板本身可以
                    简化为直接触发 onNewLogin，不需要 Dialog
```

**"登录账号"行为**（所有渠道一致，抖音也不例外）：调用既有 `createFromCookie(channelId, environment, url)`，注入该渠道已导入的 cookie，打开一个新 partition 标签页跳转到内置浏览器；新 partition 是**未绑定**状态，用户在页面里自行完成登录确认/选门店/选公司，随后走既有的 `onUrlPastLogin`/`loginUrlMatcher` → 探测 → 建号链路（§3/§4 描述的携程/抖音分支逻辑不变，只是触发入口从"添加账号面板②"改为"cookie 列表页登录账号"）。

**"从其他账号登录"**（仅抖音出现）：调用既有 `createFromExistingSession(accountId)`，即原操作③，逻辑完全不变，只是入口从面板里的"从其他登录态创建"按钮 + 二级列表，改为 cookie 列表页抖音那一行旁边的独立按钮 + 同样的二级列表（复用 `AddAccountPanel.svelte` 里 `pickingExistingAccount` 分支的 UI，迁移到新组件）。

### 10.2 携程 cookie 消费策略变更

§3 描述的携程流程图第 120 行「`deleteImportedCookies('ctrip')`（cookie 已消费，操作②重新置灰）」**本轮废止**。新行为：探测成功后 cookie 文件保留，列表页该行不消失，允许用户用同一份 cookie 再次点"登录账号"重新走一遍登录/建号（例如同一携程账号名下有多家门店，需要分别探测多次的场景）。

对应地，§6 决策表第 5 行、§7 边界情况表"携程操作②，探测成功"、§9 风险表第 3 行全部失效，`deleteImportedCookies` 函数与其唯一调用点一并删除，不保留死代码。

### 10.3 模块与接口改动

```
renderer                                  main
─────────                                 ────
SettingsPage.svelte
  └─ Cookie 行按钮 ──────────► 打开 CookieLoginListDialog.svelte（新增）

CookieLoginListDialog.svelte（新增）
  ├─ onMount ─────────────────► cookies.listImportedChannels（新增 IPC）
  ├─ 导入 Cookie ──────────────► 既有 CookieImportDialog（逻辑不变）
  │                                完成后重新查 listImportedChannels 刷新列表
  ├─ 登录账号 ─────────────────► ota-account:create-from-cookie（既有，复用）
  └─ 从其他账号登录（仅抖音） ──► ota-account:create-from-existing-session（既有，复用）
                                    （先展示 listByChannel 已建号账号供选择，
                                     UI 从 AddAccountPanel.svelte 迁移）

AddAccountPanel.svelte（精简）
  └─ 唯一操作：newLogin ───────► ota-account:start-login（既有，不变）
      删除：hasCookie/checkingCookie/pickingExistingAccount/supportsExistingSession
      删除：CookieImportDialog 引用、createFromCookie()、createFromExistingSession()

cookie-import/store.ts
  ├─ readImportedCookies()          既有，不变
  ├─ writeImportedCookies()         既有，不变
  ├─ listImportedChannels()         新增：列出所有已导入渠道 + importedAt，供列表页
  ├─ hasImportedCookies()           删除（无调用点，AddAccountPanel 不再需要置灰判断）
  └─ deleteImportedCookies()        删除（无调用点，携程分支不再消费 cookie）

login-tab-opener.ts
  └─ createFromCookie() 携程分支    去掉探测成功后调用 deleteImportedCookies 的一步
```

```ts
// src/main/cookie-import/store.ts 新增签名
export type ImportedChannelSummary = Readonly<{
  channel: ChannelId;
  importedAt: string;
}>;

export async function listImportedChannels(
  userDataDir: string,
): Promise<readonly ImportedChannelSummary[]>
```
实现：遍历 `<userData>/cookie-imports/` 下的子目录，对每个存在 `manifest.json` 的目录读出 `{ channel: dirName, importedAt: manifest.importedAt }`；无目录或全部读取失败时返回空数组，不抛错（与 `readImportedCookies` 对不存在场景返回 `null` 的既有风格一致）。

```ts
// shared/ipc-channels.ts 变更
cookies: {
  import: 'cookies:import',                          // 既有，不变
  listImportedChannels: 'cookies:list-imported-channels', // 新增
}
otaAccount: {
  // hasImportedCookies 删除
  createFromCookie: 'ota-account:create-from-cookie',             // 既有，复用
  createFromExistingSession: 'ota-account:create-from-existing-session', // 既有，复用
}
```

### 10.4 美团渠道风险状态更新

`cookie-login-account-discovery/design-meituan.md` 第 87 行标注的风险"`poiInfos` 接口本次未做真机验证"已由用户真机验证通过（`me.meituan.com` 同源 XHR 探测在 URL 命中 `/ebooking/merchant/ebIframe` 时机可正常取到门店数据），本次同步更新该文档，风险状态改为已验证，不再是本变更或既有已知缺口的阻塞项。

### 10.5 关键设计决策（本轮新增）

| # | 决策 | 理由 |
|---|---|---|
| 10 | cookie 的展示与登录入口从"添加账号面板"整体迁移到设置页独立列表页 | 面板 Dialog 尺寸有限，四按钮挤在一起看不出"已导入哪些渠道、何时导入"；列表页天然适合展示这类"已有状态的集合"，添加账号面板回归"新建"这一单一职责 |
| 11 | 携程 cookie 探测成功后不再删除，与抖音统一为"不删除" | 真实使用中同一携程账号可能挂多家门店，需要用同一份 cookie 反复触发登录/探测；一次性消费型语义在实际使用中比预期更受限 |
| 12 | "从其他账号登录"只对抖音展示，且是独立按钮而非"登录账号"点击后的二选一弹窗 | 携程一份登录态只对应一个账号，复用没有意义（§8 已定案，本轮不变）；抖音场景把两个操作分开展示，避免每次点"登录账号"都多一次"选择方式"的交互成本 |
| 13 | `hasImportedCookies` IPC 与 `deleteImportedCookies` 函数直接删除，不保留 | 均无调用点，遵循项目"删除废弃代码，不留无调用点的函数/接口"的约束 |

### 10.6 本轮不做

- cookie 列表页展示更多字段（账号标识、门店名、cookie 有效性状态）——本轮只展示渠道+导入时间，字段扩展需要额外的解析/校验能力，留待后续
- 列表页删除/清理已导入 cookie 的能力——沿用 §8 已有结论，本轮未新增

---

## 11. 真机验证后修正：「从其他账号登录」挪回浏览器工作区

§10 把「从其他账号登录」放进了 cookie 列表页（抖音那一行旁边的独立按钮）。真机验证后确认这个位置不对：这个操作的本质是"抖音账号导航栏里再加一种切换/新增门店的方式"，跟"cookie 导入管理"是两件事，放进设置页的列表弹窗里找不到、也不直观。**本节修正为**：撤回 §10.1 交互结构图里 cookie 列表页那部分的抖音专属按钮，「从其他账号登录」改名为「服务商切换」，挪回浏览器工作区的账号导航栏（`AccountsNav.svelte`），与「添加账号」并列，仅抖音渠道渲染。

### 11.1 修正后的交互结构

```
设置页 cookie 列表（CookieLoginListDialog.svelte）：
        ┌───────────────────────────────────────┐
        │  已登录 Cookie 列表      [导入 Cookie]  │
        ├───────────────────────────────────────┤
        │  携程        导入于 2026-08-03 14:20    │
        │                          [登录账号]     │
        ├───────────────────────────────────────┤
        │  抖音        导入于 2026-08-04 09:11    │
        │                          [登录账号]     │  ← 不再有"从其他账号登录"，抖音与其他渠道一致
        └───────────────────────────────────────┘

浏览器工作区账号导航栏（AccountsNav.svelte，仅抖音渠道）：
┌────────────────────────────────────────────────────────┐
│ 银泰门店(集团A) │ [+ 添加账号] │ [服务商切换]           │
└────────────────────────────────────────────────────────┘
                                        │ 点击
                                        ▼
                        列出该渠道已建号账号 → 选择其一
                        → createFromExistingSession(accountId)
                        → 复用其登录态打开页面，切换到另一门店

其他渠道账号导航栏（携程/美团…）：
┌──────────────────────────────────────────┐
│ 银际酒店(包头) │ 璞禾咖啡酒店 │ [+ 添加账号] │  ← 没有"服务商切换"
└──────────────────────────────────────────┘
```

### 11.2 模块改动

```
CookieLoginListDialog.svelte
  └─ 删除：existingAccountsChannel/existingAccounts 状态、
           showExistingAccounts()/loginWithExistingSession() 方法、
           DOUYIN_CHANNEL_ID 专属分支——所有渠道统一只有"登录账号"

AccountsNav.svelte
  ├─ 恢复 channel/activeTabId prop（channel 判断 channel.id === 'douyin'；
  │   activeTabId 透传给 SelectOtherHotelPanel 做 hide/restore）
  ├─ 新增 onSelectOtherHotel prop：(account) => Promise<boolean>
  └─ 仅抖音渲染 <SelectOtherHotelPanel channelId={channel.id} {activeTabId} onSelect={onSelectOtherHotel} />

SelectOtherHotelPanel.svelte（新增，从 CookieLoginListDialog 迁移二级列表 UI）
  ├─ 复用 AddAccountPanel.svelte 已修复过的 hide/restore 模式（commit da744a3/9530197）：
  │   打开 Dialog 前 browser.hide() 让路给 WebContentsView 遮挡问题；
  │   关闭时如果没有成功创建新标签才 activate 恢复之前的 activeTabId
  └─ 打开时 otaAccount.listByChannel(channelId) → 选择账号 → onSelect(account)

BrowserWorkspace.svelte
  └─ 新增 selectOtherHotel(account)：调用既有 otaAccount.createFromExistingSession(account.id)，
     成功后 updateTab + activate + syncBounds（与 createTab 同一套状态更新模式，
     不需要 §10 引入的跨路由 pending-tab-activation——本来就在浏览器工作区内，
     不涉及路由跳转）
```

`otaAccount.createFromExistingSession` 这个 main 层方法与 IPC 本身不变（§10.3 已实现，仅调用方从 `CookieLoginListDialog` 换成 `AccountsNav`/`SelectOtherHotelPanel`）。

### 11.3 决策

| # | 决策 | 理由 |
|---|---|---|
| 14 | 「服务商切换」放浏览器工作区账号导航栏而非 cookie 列表页 | 用户真机验证反馈：这个操作是"给抖音账号导航栏加一种新增门店的方式"，跟 cookie 列表页"管理已导入的登录态"是不同语境；放前者与"添加账号"并列，用户在需要新增门店时能就近看到，不需要跳转到设置页 |
| 15 | 按钮文案从"从其他账号登录"改为"服务商切换" | 更贴近用户操作意图（选另一家已登录门店），避免"账号登录"这个措辞和"添加账号"混淆 |
| 16 | 不复用 §10 的 `pending-tab-activation` 跨路由信号 | 该机制是为 cookie 列表页（`/settings` 路由）跳转到浏览器工作区（`/` 路由）而设计的；「服务商切换」本身就在浏览器工作区内触发，走既有的 `updateTab`/`activate`/`syncBounds` 组件内状态更新即可，跨路由信号在这里不适用 |

---

## 12. 首次引导浮层导入完成后自动跳转查看结果

真机测试反馈：`BrowserWorkspace.svelte` 首次进入应用时右下角"导入已有浏览器 Cookie"引导浮层，导入完成后只是关闭浮层（`finishCookiePrompt`），用户回到空的浏览器工作区，看不到刚导入了什么、也不知道下一步该做什么。改为导入完成后自动跳转到设置页（`/settings`）并自动打开"已登录 Cookie 列表"弹窗，让用户直接确认导入结果、可以立即点"登录账号"。

### 12.1 跨路由信号

```
新增 pending-cookie-list-open.ts（与 §10 的 pending-tab-activation.ts 同一模式，
但语义不同故不复用同一文件——一个传"待激活标签"，一个传"待打开弹窗"这个布尔意图）
  ├─ requestCookieListAutoOpen(): void   写入意图
  └─ consumeCookieListAutoOpen(): boolean 读取即清空

BrowserWorkspace.svelte
  └─ 新增 finishCookiePromptAndReviewImports()：
     finishCookiePrompt() → requestCookieListAutoOpen() → push('/settings')
     替换首次引导浮层里 CookieImportDialog 的 onComplete（原来是 finishCookiePrompt）

CookieLoginListDialog.svelte
  └─ onMount 里 consumeCookieListAutoOpen() 为真时自动调用 openDialog()
```

### 12.2 决策

| # | 决策 | 理由 |
|---|---|---|
| 17 | 新建独立的 `pending-cookie-list-open.ts`，不复用 `pending-tab-activation.ts` | 两者语义不同（一个传具体的 `BrowserTab` 数据，一个传布尔意图），混进同一文件会让调用方难以判断该读哪个字段；保持每个跨路由信号模块职责单一 |
| 18 | 只有首次引导浮层的导入触发自动打开，设置页/添加账号面板等其他 `CookieImportDialog` 触发点不触发 | 首次引导是唯一"用户对导入结果一无所知"的场景；设置页内的"导入 Cookie"按钮本身已经在 cookie 列表弹窗里，导入完成后 `refreshList()` 直接刷新当前弹窗即可，不需要额外的自动打开逻辑 |

---

## 13. 根因修复：抖音探测 `dsl/get` 响应体间歇性读取失败

真机测试本轮改动时，两次干净数据环境测试都在**首次**尝试抖音"登录账号"时探测失败（`Douyin discovery: failed to read dsl/get response body`），重试后才成功。这个现象此前（`cookie-login-account-discovery` 变更、`add-account-flow-per-channel` 上一轮真机验证）都出现过，但被判定为"既有根因、非本次改动引入，未展开排查"——命中率不低到值得排查一次。

### 13.1 根因

`src/main/account-discovery/douyin-discovery.ts` 的 `DslGetResponseCapture` 只监听 CDP 的 `Network.responseReceived` 事件，命中 `dsl/get` 请求后立即调用 `Network.getResponseBody`：

```ts
// 修复前
if (method !== 'Network.responseReceived') return;
if (!isCdpResponseReceivedParams(params)) return;
if (!params.response.url.includes(DSL_GET_PATH)) return;
...
void this.fetchAndResolveBody(params.requestId);   // 立即取 body
```

CDP 协议里 `Network.responseReceived` 只代表**响应头**已到达，响应体可能仍在流式接收中——`Network.getResponseBody` 必须等对应请求真正加载完成（`Network.loadingFinished`）后调用才能保证成功，过早调用会抛 "No resource with given identifier found" 一类错误。这正是日志里 `failed to read dsl/get response body` 的成因，命中率取决于响应体大小和当时的网络时序，所以是间歇性的。

### 13.2 修复

拆成两阶段：`responseReceived` 命中时只记录 `pendingRequestId`，真正调用 `Network.getResponseBody` 推迟到该 `requestId` 对应的 `loadingFinished` 事件：

```ts
// 修复后
if (method === 'Network.responseReceived') {
  ...
  this.pendingRequestId = params.requestId;   // 只记录，不取 body
  return;
}
if (method === 'Network.loadingFinished') {
  if (params.requestId !== this.pendingRequestId) return;
  this.pendingRequestId = null;
  void this.fetchAndResolveBody(params.requestId);   // 加载完成后再取
}
```

不改变探测触发方式、URL 判定、门店信息解析逻辑，只修正"何时取响应体"这一处时序。

### 13.3 未覆盖的验证

尝试为 `DslGetResponseCapture` 的事件时序补充单测（mock `webContents.debugger`），因 `discover()` 内部 `clickPoiManageMenu` 的异步轮询与事件 mock 存在时序耦合，测试超时未能跑通；排查这个测试基础设施问题的投入产出比过低，用户明确要求停止投入，改为**只依赖真机验证**作为这次修复的证据。后续如果要补自动化测试，建议先把 `DslGetResponseCapture` 从 `DouyinDiscoveryProbe.discover()` 里解耦出来单独可测（当前它是 `discover()` 内部的一个局部类，测试必须驱动完整探测流程才能触达）。

---

## Migration Plan

不涉及数据库 schema 变更（复用现有 `OtaAccount`/`channelContext` 字段）。纯功能新增/重构，无迁移脚本。回滚：还原 `AccountsNav.svelte`、`AddAccountPanel.svelte`、`SettingsPage.svelte`、`CookieLoginListDialog.svelte`、`SelectOtherHotelPanel.svelte`、`BrowserWorkspace.svelte`、`cookie-import/store.ts`、`login-tab-opener.ts`、`pending-tab-activation.ts`、`pending-cookie-list-open.ts` 相关改动即可，不涉及不可逆数据变更。
