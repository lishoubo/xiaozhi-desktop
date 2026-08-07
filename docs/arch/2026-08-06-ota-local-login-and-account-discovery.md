# OTA 本地登录建号：流程 + 代码结构

> **范围**：仅本地已实现代码。远端 RMS 绑定见
> [RMS 酒店 OTA 绑定：目标设计](./2026-08-06-ota-remote-hotel-binding-design.md)（未实现）

---

## 0. 名词

| 名词 | 含义 |
|---|---|
| `OtaCredential` | 一次渠道登录身份 + 一个 Electron partition（登录环境，Cookie 存这里） |
| `OtaAccount` | 某个 `OtaCredential` 名下发现的一家 OTA 酒店，`(channel, otaHotelId)` 唯一 |
| partition | Electron 的隔离登录环境标识符（字符串），不是敏感数据本身；renderer 拿它做"这张账号卡片对应哪个已打开的浏览器 tab"的匹配，**这是刻意设计**，不是意外把内部字段带出去了 |

---

## 1. 全链路：用户点击 → 组件 → IPC → main → domain

```
┌─────────────────────────────── renderer ────────────────────────────────┐
│                                                                            │
│  BrowserWorkspace.svelte ── 打开 ──▶ AccountSwitcherDialog.svelte         │
│                                        │                                  │
│              ┌─────────────────────────┼──────────────────────┐          │
│              ▼                         ▼                      ▼          │
│        点已有账号卡片              「登录新渠道账号」      「从 Cookie 导入」│
│              │                         │                      │          │
└──────────────┼─────────────────────────┼──────────────────────┼──────────┘
               │ otaCredential           │ otaAccount           │ otaAccount
               │ .openExisting           │ .startLogin          │ .createFromCookie
               ▼                         ▼                      ▼
┌─────────────────────────── preload/api.ts（IPC 出口） ───────────────────┐
└──────────────┬─────────────────────────┬──────────────────────┬──────────┘
               ▼                         ▼                      ▼
┌───────────────────────── main/ipc/browser-handlers.ts ───────────────────┐
│  registerBrowserHandlers()                                               │
│    在函数体内 new LoginTabOpener(...) / new OtaAccountReadService(...)   │  ← 见 §3 问题①
│                                                                            │
│  otaCredential.openExisting handler          otaAccount.startLogin /     │
│    │                                          createFromCookie handler   │
│    ▼                                             │                       │
│  otaCredentialRepository.findById()              ▼                      │
│    │                                          loginTabOpener.open() /   │
│    ▼                                          .createFromCookie()       │
│  manager.createWithAlreadyPartition()            │                       │
│  （复用 partition，只开页面，到此为止）           ▼                       │
│                                          browser.createAndNewPartition() │
└───────────────────────────────────────────────────┼──────────────────────┘
                                                      ▼
                                    ┌─────────────────────────────────┐
                                    │  BrowserManager（下面 §2 展开）  │
                                    │  新建 partition → 创建 tab       │
                                    │  → 挂 URL/加载监听 → loadURL     │
                                    └──────────────┬────────────────────┘
                                                    │ 命中 loginUrlMatcher
                                                    │ 或 onLoadFinished
                                                    ▼
                                    triggerDiscovery(partitionName, channel, url, webContents)
                                                    │
                                                    ▼
                        DiscoverAndCreate.trigger()（account-discovery/discover-and-create.ts）
                                                    │
                        ┌───────────────┬───────────────┬──────────────────┐
                        ▼               ▼               ▼                  ▼
                  discoverCtrip   discoverDouyin   discoverMeituan   probes.get(channel)
                  （携程专用分支） （抖音专用分支） （美团专用分支）   （其余渠道，通用）
                        └───────────────┴───────────────┴──────────────────┘
                                                    ▼
                                    persistIdentifiedResult()
                                      → Credential 归并（§4 判定 A）
                                      → upsertAccount() × N（§4 判定 B）
                                                    ▼
                          otaCredentialRepository / otaAccountRepository
                          （SqliteOtaCredentialRepository / SqliteOtaAccountRepository）
                                                    ▼
                                       onAccountBound 事件 → renderer 刷新
```

---

## 2. `BrowserManager` 内部：一次登录动作具体做了什么

文件：`main/browser/browser-manager.ts`（约480行）。两个入口方法：

| 方法 | 用途 | partition |
|---|---|---|
| `createWithAlreadyPartition(partitionName, channelId, url, options?)` | 打开已有账号 | 复用 |
| `createAndNewPartition(environment, channelId, url, options)` | 登录新账号 / Cookie 导入 | 新建 |

`createAndNewPartition` 内部顺序（第161-177行）：

```
sessionFactory.sessionForLogin(environment, channelId)   ← 生成新 partition + session
  │
  ├─ 若传了 importedCookies：并发写入 cookie（早于加载页面）
  │
  ▼
createTab(...)  ← 私有方法，第180-232行
  │
  ├─ new WebContentsView({ webPreferences: { contextIsolation:true, sandbox:true, session:tabSession } })
  ├─ 存入内部 tabs Map
  ├─ bindTabEvents(tab)  ← 绑定 did-navigate 等事件
  ├─ activate(id)
  └─ view.webContents.loadURL(url)   ← 最后才真正加载页面
```

`onUrlPastLogin` 触发点在 `checkUrlPastLogin`（第441-453行）：`did-navigate` 事件里判断
`loginUrlMatcher.isPastLogin(url)`，命中且未触发过时调用一次，调用后置位不再重复触发。
`onLoadFinished`（携程用，见下）在页面 `loadURL` 完成后触发，不依赖 URL 匹配。

**三种触发方式，按渠道/场景分流**（`LoginTabOpener`，`main/features/ota-account/login-tab-opener.ts`）：

```
open()                     → 挂 loginUrlMatcher + onUrlPastLogin，等用户手动登录后跳转触发
createFromCookie() 携程     → 挂 onLoadFinished，页面一加载完就静默判定，不等用户交互
createFromCookie() 非携程   → 挂 loginUrlMatcher + onUrlPastLogin，同 open()，只是预注入了 cookie
```

---

## 3. 组装根：谁 new 了谁

`main/application.ts` 是唯一的 composition root，`initializeApplication()` 先建库和
`DiscoverAndCreate`，`openMainWindow()` 再建 `BrowserManager` 并注册 IPC handler：

```ts
// application.ts §initializeApplication
otaAccountRepository = new SqliteOtaAccountRepository(applicationDatabase);
otaCredentialRepository = new SqliteOtaCredentialRepository(applicationDatabase);
discoverAndCreate = new DiscoverAndCreate({
  discoverCtrip: createCtripDiscovery(log),
  discoverDouyin: createDouyinDiscovery(log),
  discoverMeituan: createMeituanDiscovery(log),
  accountRepository: otaAccountRepository,
  credentialRepository: otaCredentialRepository,
  onCredentialPartitionReplaced: (p) => browserManager?.retirePartition(p),
  onAccountBound: (channel) => mainWindow?.webContents.send(IPC_CHANNELS.otaAccount.accountBound, { channel }),
  ...
});

// application.ts §openMainWindow
browserManager = new BrowserManager(mainWindow, log);
registerBrowserHandlers({ manager: browserManager, triggerDiscovery: (...) => discoverAndCreate.trigger(...), ... });
```

```ts
// browser-handlers.ts §registerBrowserHandlers（不是 composition root，但在这里又 new 了两个对象）
const loginTabOpener = new LoginTabOpener({ userDataDir, browser: manager, loginUrlMatchers, triggerDiscovery });
const otaAccountReadService = new OtaAccountReadService(otaAccountRepository, otaCredentialRepository);
```

**⚠️ 问题①：组装不一致。** `BrowserManager`、`DiscoverAndCreate`、两个 repository 都在
`application.ts` 顶层组装；`LoginTabOpener`、`OtaAccountReadService` 却在
`registerBrowserHandlers()`（一个"注册 IPC handler"的函数）内部临时 new 出来。这两个对象
不是不需要生命周期管理——它们只是恰好没有需要清理的资源，所以现在不出错，但读代码时找不到
它们的组装位置在哪，和其余四个对象的组装方式不对称。

---

## 4. `DiscoverAndCreate.trigger()` 内部：三渠道分支 + 两个判定

`account-discovery/discover-and-create.ts`，`trigger()` 第43-148行：

```ts
if (bound.has(partitionName) || inflight.has(partitionName)) return false;   // 防重

if (isCtrip)   { result = await discoverCtrip(...);   if none→return; if multiple→放弃,return; persistIdentifiedResult(...); bound.add(...) }
if (isDouyin)  { result = await discoverDouyin(...);  if none→return;                        persistIdentifiedResult(...); bound.add(...) }
if (isMeituan) { result = await discoverMeituan(...); if none→return;                        persistIdentifiedResult(...); bound.add(...) }
if (probe)     { outcome = await probe.discover(...); switch(outcome.kind){ single→createOrUpdate; multiple→放弃,return } }
```

**⚠️ 问题②：三个渠道分支结构几乎相同**（探测 → 判 none → 判 multiple(仅携程) →
persistIdentifiedResult → bound.add），只有调用的 discover 函数和渠道特有的
multiple 处理不同。三段几乎重复的代码分别写了一遍，改一处判空/加日志逻辑要改三遍。

**判定 A — `persistIdentifiedResult()` 里的 Credential 归并**（第185-250行）：

```
按 partitionName 查 existing；按 channel+channelAccountId 查 identified

identified 存在且 ≠ existing  → 更新 identified 的 partition+身份，旧 partition 作废
existing 存在                 → 只更新 existing 的身份字段
都不存在                       → 新建
identified 存在且 existing 也存在但不是同一条 → 抛错（环境已关联另一身份）
```

**判定 B — `upsertAccount()`**（第252-277行）：

```
按 (channel, otaHotelId) 查
  命中 → 更新 credentialId / otaHotelName / bindExtra / discoveredAt
  未命中 → 新建
```

**防重**：`bound`/`inflight` 是 `DiscoverAndCreate` 实例内的两个 `Set<partitionName>`，
进程内存状态，重启应用即清空，不落库、不按"操作"维度隔离。

---

## 5. Repository：接口与实现对齐情况

`domain/ports/repositories.ts` 定义 → `main/database/*.ts` 实现，逐方法核对：

| 接口 | 方法 | 实现 | 调用点 |
|---|---|---|---|
| `OtaCredentialRepository` | `create` | ✅ | `discover-and-create.ts` |
| | `listByChannel` | ✅ | `browser-handlers.ts` |
| | `findById` | ✅ | `ota-account-read-service.ts`、`browser-handlers.ts` |
| | `findByPartitionName` | ✅ | `discover-and-create.ts` |
| | `findByChannelAndAccountId` | ✅ | `discover-and-create.ts` |
| | `updateIdentity` | ✅ | `discover-and-create.ts` |
| | `updatePartitionAndIdentity` | ✅ | `discover-and-create.ts` |
| `OtaAccountRepository` | `create` | ✅ | `discover-and-create.ts` |
| | `findByChannelAndHotelId` | ✅ | `discover-and-create.ts` |
| | `updateDiscovery` | ✅ | `discover-and-create.ts` |
| | `listByChannel` | ✅ | `ota-account-read-service.ts` |
| | `findById` | ✅ | `ota-account-read-service.ts` |

两个接口共12个方法，实现类逐一对齐，没有多实现、没有漏实现，也没有定义了但无调用点的
死方法。**这一层是干净的**，不是问题来源。

---

## 6. `OtaAccount` 读取路径的真实状态

写入路径（判定 B，§4）正常工作。读取路径：

```
otaAccount.listByChannel  ──▶  SelectOtherHotelPanel.svelte  ──▶  AccountsNav.svelte  ──▶  （无任何页面引用）
otaAccount.openExisting            （从未被 renderer 调用）
otaAccount.createFromExistingSession（从未被 renderer 调用，仅限抖音）
```

当前账号切换器（`AccountSwitcherDialog.svelte`）只展示 `OtaCredential`，不展示
`OtaAccount`。上面三个方法在 handler 层完整实现、类型对齐、可以正常调用，只是没有任何
renderer 代码去调用它们——不是"删掉了忘记清理"，是新账号切换器上线后这条路径整体没被
迁移过去。

---

## 7. 结论：代码结构里站得住的问题

| # | 问题 | 位置 | 表现 |
|---|---|---|---|
| ① | 组装位置不一致 | `browser-handlers.ts` 第98-107行 vs `application.ts` | `LoginTabOpener`/`OtaAccountReadService` 在非 composition-root 位置临时 new，与其余对象的组装方式不对称 |
| ② | 三渠道分支重复 | `discover-and-create.ts` `trigger()` 第63-116行 | 携程/美团/抖音三段结构相同的 if 分支，公共部分（探测→判空→归并→bound.add）没有抽出来 |
| ③ | 死代码未清理 | `SelectOtherHotelPanel.svelte`、`AccountsNav.svelte`、`otaAccount.openExisting`、`otaAccount.createFromExistingSession` | 完整实现但无调用点，读代码时无法直接判断这条路径是否还在用 |
| ④ | 防重复触发是进程级 | `discover-and-create.ts` `bound`/`inflight` Set | 非按操作维度，重启应用才重置，长期运行的进程里这个 Set 只增不减 |

**不是问题、只是容易误读的地方**：`otaAccountSchema`/`otaCredentialSchema` 把
`partitionName` 序列化给 renderer，是刻意设计——renderer 靠它做账号卡片与已打开 tab 的
匹配（`AccountSwitcherDialog.svelte`、`BrowserWorkspace.svelte`），不是内部字段误传出来。
