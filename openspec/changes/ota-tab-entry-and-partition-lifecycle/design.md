# design — OTA 标签入口与 partition 生命周期

> 事实盘点见 `tasks.md`。本文只回答「怎么做」。

## 1. 问题的实质

不是「缺一个清理函数」，而是**产出与回收不对称，且回收的触发时机挂错了事件**。

```
产出：4 条路各自独立新建，无人记账
                                                  ┌─ 谁替换了谁（真正的语义）
回收：1 条路，触发时机挂在 close(tabId) ───────────┴─ ❌ 实际挂在这里
                                                     关 tab 与生命周期无关
```

`retiredPartitions` 是个只加不减的集合，每次 `close()` 全量重扫，守卫又只问
「有没有 tab 开着」。三者叠加 → 清掉了 credential 正在用的 partition。

## 2. 三条设计主线

| 主线 | 现状 | 目标 |
|---|---|---|
| A 减少产出 | 4 条路新建 partition | 降到 3 条（只改绑定·选已有账号）|
| B 修正回收 | 守卫只看 tab；时机挂 close | 守卫看「是否被认领」；时机跟替换事件 |
| C 建立账本 | 三处散乱，`pending.json` 只写不读 | 单一事实来源，可枚举全集 |

---

## 3. 主线 A：入口收敛

### 3.1 关键发现 —— 入口 5 根本不需要新建 partition

`openExistingInFreshPartition` 的注释自述换新 partition 的**唯一目的**：

```
复用 partition → localStorage 里留着「上次选的是哪个 group」
               → 抖音直接跳过选公司页，落到上次那个门店
全新 partition → 没有选择记录，抖音必须重新问一次
```

即「要丢掉 localStorage，但要保住 cookie」。而 Electron 43 的
`clearStorageData` **支持按存储类型清理**（已核实 `electron.d.ts:20621`）：

```ts
session.clearStorageData({ storages: ['localstorage'] })   // cookie 原样保留
```

目的直接达成，不必新建 partition。这是本次**最大的产出源**（每次绑定必留一份）。

| 方案 | 每次绑定产出 | cookie | 风险 |
|---|---|---|---|
| 现状：新建 partition + 搬 cookie | +1 份 partition | 靠 `readInjectableCookies` 搬运，可能丢字段 | 搬运不完整 → 登录态失效 |
| **改为：复用 + 只清 localstorage** | **0** | **原地不动，零搬运** | 需验证抖音是否真的只依赖 localStorage |

### 3.1.1 🔴 三次误判与最终根因（2026-08-14 真机 CDP 排查）

**入口 5 最终维持「新建 partition」，本节记录为什么其余三条路都不行。**
每一条都真机试过，避免下次有人重走。

| # | 判断 | 做法 | 实测结果 |
|---|---|---|---|
| v1 | `e977c06`：复用 partition 带着 localStorage 的选店记录 | 新建 partition 甩掉它 | ✅ 有效，但**归因是错的** |
| v2 | 沿用 v1 归因 | 只删 `core:PoiSwitch:*` 键 | ❌ 日志确认 `removedCount: 1` 删掉了，页面照样跳。该键是页面落地后**抄下来的结果** |
| v3 | Service Worker 拦截导航（`fromSW=true`） | `clearStorageData` / `clearData` 两种 API 清 SW | ❌ 用 `Network.setBypassServiceWorker` 绕开 SW 后**照样跳** —— SW 只是缓存了本来就会发生的跳转 |
| v4 | 页面 JS 自己跳（`reason=scriptInitiated`） | 拦掉跳转停在 `/p/login` | ❌ 停住后该页无可见内容，它只是中转页，选公司页不在这个地址 |

**真正的根因在服务端**：`/p/login` 的页面脚本先调 `/passport/account/info/v2/`，
从响应里拿到「这个会话上次用的 `life_account_id`」，然后自己跳过去。CDP 实证：

```
① /passport/account/info/v2/?aid=303313&language=cn                      ← 无参数
② /passport/account/info/v2/?...&root_life_account_id=7202809170041505832  ← 参数来自①的响应
[导航发起] reason=scriptInitiated   全程 HTTP 200，无 302
```

这份记忆绑在**登录会话**上，清任何本地存储都动不了它。

### 3.1.2 定稿：维持新建 partition，但补上账本

`e977c06` 的做法之所以有效：注入的 cookie 与原会话**不完全等价**
（`readInjectableCookies` 搬不动 session cookie 等），抖音因此不认得「上次那家」，
只好重新问。

⚠️ **这是靠差异生效，不是我们主动控制的机制。** 抖音若改了判定方式，这条路会再次
失效 —— 届时应从 §3.1.1 的排查结论重新找入口，**不要再试一遍那四条**。该警告已写进
`OtaTabService.openExistingForBinding` 的方法注释，与代码同处一地。

代价（每次绑定留一份 partition）由本 change 的账本 + 启动清理接手，这正是当年那句
「已知代价，partition 生命周期治理另行处理」所指望的。真机验证（2026-08-15）：

```
00:10:37  Login session created → Browser tab created  915ef78a
账本      915ef78a  pending           ← 绑定时新建，已记账
          f5740df2  claimed → 5133e179（走进内蒙古）  ← 用户选完公司后的那份
```

中间产物 `915ef78a` 留在 `pending`，下次启动按孤儿回收 —— 不再是无从追溯的僵尸。

### 3.1.3 ⚠️ 酒店管理不是「1 个入口」，是 5 条路（用户提醒，已核实）

初稿把酒店管理算成入口 5、6 两条，**数漏了**。它的开 tab 请求不在酒店页发出，而是
写进跨路由意图，跳到 `/` 由浏览器工作区消费 —— 这个间接层让入口容易看漏：

```
酒店管理页 /hotels                       浏览器工作区 /
─────────────────────────                ─────────────────────────
AddOtaBindingDialog
  ├ 选已有账号 → startBinding()          ┐
  │    → hotelBindingWaiting{credentialId}├→ BindHotelDialog.onMount()
  └ 新登录账号 → startNewLogin()         │    consume() 后二选一：
       → hotelBindingWaiting{newLogin}   ┘    ├ credentialId  → openExistingInFreshPartition 🆕
                                              └ newLoginChannel → openForNewLogin          🆕
ReauthOtaAccountDialog
  ├ B 路：恢复同一账号 → startReauth()    ┐
  │    → otaReauthWaiting{credentialId}   ├→ ReauthDialog.onMount()
  │                                       ┘    → openExisting  ♻️（要的正是同一家门店）
  └ A 路：换账号 → startNewLogin()
       → **hotelBindingWaiting**{newLogin, replacingOtaHotelId}
                                          └→ 汇入上面 BindHotelDialog 那条 🆕
```

| 路径 | 起点 | 意图 | 最终调用 | partition |
|---|---|---|---|---|
| ① 绑定·选已有账号 | `AddOtaBindingDialog:118` | `hotelBindingWaiting{credentialId}` | `openExistingInFreshPartition` | 🆕 新建+搬 cookie |
| ② 绑定·新登录账号 | `AddOtaBindingDialog:129` | `hotelBindingWaiting{newLoginChannel}` | `openForNewLogin` | 🆕 新建 |
| ③ 重新登录·恢复同账号 | `ReauthOtaAccountDialog:95` | `otaReauthWaiting` | `openExisting` | ♻️ 复用 |
| ④ 重新登录·换账号 | `ReauthOtaAccountDialog:126` | **`hotelBindingWaiting`** | `openForNewLogin` | 🆕 新建 |
| ⑤ 兜底：意图两个字段都没有 | `BindHotelDialog:95` | — | 不开 tab，记 warn | — |

**两处最容易踩的坑**：

- **④ 借用的是绑定意图，不是重登意图**：`ReauthOtaAccountDialog` 同时 import 了
  两个 intent。「换账号」意味着门店要重新确认，所以走完整绑定流程，只是多带一个
  `replacingOtaHotelId`（该酒店在本渠道已有绑定，换门店必须先解绑，要在确认前拦住）。
  改动 ② 的行为会**连带影响 ④**。
- **③ 必须保持复用**：重新登录要的正是**同一家门店**，与绑定的诉求相反 ——
  §3.1 的「清 PoiSwitch」**绝不能加到这条路上**，否则重登后落到选店页，
  `expectedChannelAccountId` 的身份核对会因为没进到门店页而失败。

**结论**：需要改的只有 ①（新建+搬 cookie → 复用+删 PoiSwitch 键）。
② 和 ④ 是「新登录」，本来就该开干净 partition，不动；③ 不动；⑤ 是错误分支。

### 3.4 ✅ 已由 `reauth-intent-and-legacy-binding` 承接（2026-08-15 完成）

> 本节是当时留下的起点，**结论已在那个 change 里落地**，此处保留只为记录来龙去脉。
>
> | 当时的问题 | 最终结论 |
> |---|---|
> | 第 8 条路是绑定还是特殊重登？ | **绑定** —— 它以 `confirmBinding` 收尾、产出一条新绑定；重登的产出是 `ReauthOutcomeDto`，两者根本不是一个东西 |
> | 选 A（加 origin）还是 B（独立 kind）？ | 实际做成了**按已知信息分三条路**，比原来设想的更彻底：新增 `reauth-by-hotel` intent 与独立 dispatcher（判据是**订阅方是否相同** —— 探测与否不同，就该是两个 kind） |
> | `replacingOtaHotelId` 要不要进 intent？ | **不进**，主进程零消费方，进了只是契约膨胀 |
> | 8 条路里有没有漏带 intent 的？ | **没有**，逐条核实过 |
>
> ⚠️ 那一轮还踩到本节没预见的坑：新流程若照抄第 7 条路用 `openExisting`，抖音会
> 直落上次那家门店导致核对失败。教训见该 change `tasks.md` 的「中途推翻的三处」C。

<details>
<summary>当时的原始记录（已过时，仅存档）</summary>

#### 已核实的事实

`main/ota-tab/intent.ts` 现在是个判别联合，只有两个 `kind`：

```ts
BindHotelIntent  { kind: 'bind-hotel';  requestId }
ReauthOtaIntent  { kind: 'reauth-ota';  requestId; expectedChannelAccountId }
```

而**真实的打开路径有 8 条**（§3.2），其中带 intent 的只有绑定与重登相关几条，
第 1、2、3、4 条路不带 intent（不带就不探测门店 —— 探测会操作用户正在看的页面）。

#### 关键分界：`replacingOtaHotelId` 现在完全活在 renderer

已 grep 确认，它只出现在三处，**从没进过主进程的 `OtaTabIntent`**：

```
cross-route-intents.ts        意图字段声明
ReauthOtaAccountDialog.svelte 换账号时写入
BindHotelDialog.svelte        读出来做 requiresUnbindBeforeBinding 判断
```

所以第 8 条路的区分信息**渲染进程有、主进程没有** —— 而日志由主进程打，
这正是它与第 6 条路在日志上分不开的原因。

#### 明天要先回答的问题（顺序很重要）

1. 🔴 **第 8 条路到底是「一次绑定」还是「一次特殊的重新登录」？**
   这个判断直接决定下面选 A 还是 B，先答它：
   - 从用户视角：它是「重新登录」对话框里的一个选项
   - 从流程视角：它确实要重新确认门店，走完整绑定是对的
   - 从代码视角：目前与第 6 条路完全同形

2. 据此选方案：

   | | A：加 `origin` 标记 | B：升成独立 `kind` |
   |---|---|---|
   | 形状 | `{ kind: 'bind-hotel', requestId, origin: 'add-binding' \| 'reauth-switch-account' }` | 新增 `SwitchAccountIntent` |
   | 下游 | 无需改分支，只多一个日志字段 | `HotelProbeDispatcher` 等订阅方要处理新 kind |
   | 适合 | 「同一件事，来源不同」 | 「本来就是两件事」 |

3. **`replacingOtaHotelId` 要不要一并进 intent？**
   倾向**不进**：intent 表达「为什么打开这个 tab」，不表达业务约束；而且
   「已有活跃绑定就不能换门店」的权威在**远端 RMS**（提交时会被拒），
   本地拦只是提前告知，属于 UI 职责。除非明天发现主进程也需要它做校验。

4. 顺带看一眼：8 条路里**该带 intent 而没带**的有没有？
   （`createFromCookie` 曾经就是漏带 intent 的那个，见 `e977c06` 的「顺带两处」）

</details>

---

### 3.2 收敛后的入口表

共 **8 条路**（浏览器工作区 4 + 酒店管理 4，§3.1.3）：

| # | 来源 | 入口 | 现状 | 目标 |
|---|---|---|---|---|
| 1 | 浏览器 | 已登录列表 → 登录新渠道账号 | 🆕 新建 | 🆕 不变（新账号要干净环境） |
| 2 | 浏览器 | 已登录列表 → 从 Cookie 导入 | 🆕 新建 | 🆕 不变（导入的就是新登录态） |
| 3 | 浏览器 | 已登录列表 → 点某个账号 | ♻️ 复用 | ♻️ 不变 |
| 4 | 浏览器 | 标签区 `+` | ♻️ 复用 | ♻️ 不变（✅ 本来就对，见下） |
| 5 | 酒店 | 绑定 · 选已有账号 | 🆕 新建+搬 cookie | ♻️ **复用 + 删 PoiSwitch 键** ← 唯一要改的 |
| 6 | 酒店 | 绑定 · 新登录账号 | 🆕 新建 | 🆕 不变 |
| 7 | 酒店 | 重新登录 · 恢复同账号 | ♻️ 复用 | ♻️ 不变（**要的正是同一门店，不可清 PoiSwitch**）|
| 8 | 酒店 | 重新登录 · 换账号（借绑定意图）| 🆕 新建 | 🆕 不变 |

**订正：入口 4 本来就没有问题。** 初稿据 `createTab()` → `openForNewLogin` 判断它会
新建 partition，是**看错了调用点** —— `createTab` 服务的是入口 1（`onNewLogin`，
`BrowserWorkspace.svelte:540`），不是标签区的 `+`。

标签区 `+` 实际走：

```
Button(aria-label="新建标签页", :496)
  → openNewTabForActiveSession(:135)
  → openExistingCredentialTab(activeCredential.credential)
  → openExisting()          ← ♻️ 复用当前账号的 partition，不新建
  且 disabled={!activeCredential}   ← 没选账号时按钮禁用
```

产品意图是「基于前面的标签再开一个 tab」（类似浏览器 Cmd+T，继承当前登录态），
现有实现与之一致，**不需要改动**。

**新建入口 4 条（1、2、5、6/8），落实 §3.1 后降到 3 条。**
**只有第 5 条要改，其余 7 条维持现状。**

### 3.3 入口定义是否明确 —— 逐条审查

不看它调了什么，只看**语义是否唯一、名字是否说清了它是谁**。结论：8 条路里
6 条定义清楚，**2 处定义有问题，1 处命名不一致**。

#### ✅ 定义清楚的（6 条）

| 路 | 语义 | 判断 |
|---|---|---|
| 1 登录新渠道账号 | 我要加一个这个渠道的新账号 | 明确 |
| 2 从 Cookie 导入 | 我有一份现成 cookie，拿它登录 | 明确 |
| 3 点某个账号 | 打开这个账号 | 明确 |
| 4 标签区 `+` | 基于当前账号再开一个 tab | 明确（`disabled` 兜住了无账号态） |
| 6 绑定·新登录账号 | 这家酒店要绑，但还没有可用账号 | 明确 |
| 7 重新登录·恢复同账号 | 这个账号掉线了，把它救回来 | 明确（有 `expectedChannelAccountId` 核对） |

#### ⚠️ 问题 1：第 5 条路的名字描述的是**手段**，不是**意图**

```
openExistingInFreshPartition   ← "打开已有账号，但换一份干净的 partition"
```

「换一份干净 partition」是实现手段，且这个手段**本次就要被替换掉**（改成复用 +
删 PoiSwitch 键）。名字一改实现就作废，说明它命名的层次错了。

**定稿：`openExistingForBinding`。**

选名过程（用户否掉了第一版）：初版提的 `openExistingForStoreSelection` **被抖音带跑了**
—— 携程/美团走这条路时根本没有选店页，「选门店」对它们不成立。用户提议
`ReSelection`，方向对（更中性）但仍差一点：没说重选**什么**，且那两个渠道也不重选。

回到本质：**这条路只有一个调用方（`BindHotelDialog`），意图就是 `bind-hotel`。**
三渠道共同的语义是「为绑定而打开」；清 PoiSwitch 只是为达成它而对抖音做的适配。

| 候选 | 说的是 | 判断 |
|---|---|---|
| `openExistingInFreshPartition` | 换干净 partition | ❌ 手段层，实现一改就作废 |
| `openExistingForStoreSelection` | 要选门店 | ❌ 只有抖音有选店页 |
| `openExistingForReSelection` | 重新选 | ⚠️ 重选什么没说；携程/美团不重选 |
| **`openExistingForBinding`** | **为绑定而打开** | ✅ 三渠道成立，与 `intent: 'bind-hotel'` 对齐 |
| `openExistingWithoutSelectionMemory` | 不带上次选择记忆 | ⚠️ 准确但仍是手段层，且渠道无选择页时无意义 |

`ForBinding` 不直接表达「不带上次选择」，这一点由方法注释补上 —— 但**实现怎么改，
名字都不会过时**，这正是它优于其他候选的地方。

#### ⚠️ 问题 2：第 8 条路（重新登录·换账号）**没有自己的定义**

它借用绑定意图（`hotelBindingWaiting`），在代码里与第 6 条路完全同形，唯一区别是
多带一个 `replacingOtaHotelId`。于是：

- 从**用户视角**：这是「重新登录」对话框里的一个选项
- 从**代码视角**：这是一次「绑定」
- 从**日志视角**：与第 6 条路无法区分（都打 `Binding waiting registered`）

复用绑定流程本身是对的（换账号确实要重新确认门店），**但它缺一个能把自己认出来的
标识**。排查时看到一条绑定日志，无法判断用户是从"新增绑定"还是"重新登录→换账号"
进来的 —— 而这两条路的后续处理并不完全一样（后者要拦「已有活跃绑定」）。

建议：意图里加一个来源标记（如 `origin: 'add-binding' | 'reauth-switch-account'`），
**只用于日志与可观测性**，不改变流程分支。

> ⚠️ 这一条落在 intent 设计上，用户明确本轮先解决入口、intent 另开一轮 ——
> 故**本次只记录，不实现**。下一轮的起点见 §3.4。

#### ⚠️ 问题 3：同一个东西，三层三个名字

| 层 | 第 1/6 条路 | 第 2 条路 |
|---|---|---|
| IPC / preload | `openForNewLogin` | `openWithImportedCookie` |
| `OtaTabService` | **`open`** | **`createFromCookie`** |

`open` 这个名字什么都没说（4 个方法都是 open）；`createFromCookie` 的 `create`
指的是"建 partition"还是"建 credential"也不清楚（实际两者都不是，它只是开 tab）。

建议 service 层与 IPC 层对齐，四个方法统一成「意图式」命名：

```
open                         → openForNewLogin
createFromCookie             → openWithImportedCookie
openExistingInFreshPartition → openExistingForBinding
openExisting                 → openExisting            （不变，本来就清楚）
```

**用户决定：IPC 契约一起改**，四层命名对齐到底：

| 层 | 改前 | 改后 |
|---|---|---|
| `IPC_CHANNELS.otaTab` | `openExistingInFreshPartition` | `openExistingForBinding` |
| channel 字符串 | `'ota-tab:open-existing-in-fresh-partition'` | `'ota-tab:open-existing-for-binding'` |
| preload 命名空间 | `openExistingInFreshPartition` | `openExistingForBinding` |
| `OtaTabService` | `openExistingInFreshPartition` | `openExistingForBinding` |
| renderer store | `openExistingInFreshPartition` | `openExistingForBinding` |

channel 字符串是**进程间约定，不是持久化数据**，改名无迁移成本（主进程与渲染进程
同版本发布）。`open` / `createFromCookie` 同理，IPC 侧本就叫
`openForNewLogin` / `openWithImportedCookie`，这次是 service 层向 IPC 层对齐。

改动是纯重命名，无行为变化，但让「4 个开口 = 4 种意图」这件事在代码里成立
——这正是 `ota-tab-service.ts` 顶部注释自称的设计（「四个方法对应四种打开意图」），
现在名字没兑现它。

#### 小结：本次入口相关的改动

| # | 改动 | 类型 |
|---|---|---|
| 1 | 第 5 条路：新建 partition → 复用 + 删 PoiSwitch 键（仅抖音） | 行为 |
| 2 | `openExistingInFreshPartition` → `openExistingForBinding`（含 IPC 契约） | 重命名 |
| 3 | `open` / `createFromCookie` → 与 IPC 层对齐的意图式命名 | 重命名 |
| 4 | ~~第 8 条路加来源标记~~ | **留给 intent 轮次** |

---

## 4. 主线 B：回收的正确形态

### 4.1 生命周期状态机

```
                    ┌──────────────────────────────────────┐
                    │                                      │
   open/import      ▼          discovery 成功              │
  ─────────────→ pending ──────────────────────→ claimed ──┘ 同账号再登录
                    │                              │        （旧的被替换）
                    │ 用户放弃/探测失败              │
                    │ （tab 关闭且长期未认领）        │ 被替换
                    ▼                              ▼
                 orphaned ──────────────────→ retired
                                                   │
                                          守卫全部通过
                                                   ▼
                                                cleared
```

**关键：`retired` 是「被谁替换」这个事件产生的，不是「关了个 tab」。**

### 4.2 清理守卫（三条，全部通过才清）

| 守卫 | 判据 | 现状 |
|---|---|---|
| G1 无标签占用 | 没有 tab 的 `partitionName` 等于它 | ✅ 已有 |
| **G2 未被认领** | **没有 credential 的 `partitionName` 指向它** | ❌ **缺失 = P0 bug** |
| G3 非保留分区 | 不是 `server-api` / `rms-api` 等基础设施 partition | ❌ 缺失（现在靠调用方自觉） |

G2 是本次事故的直接原因。装配上可行（已核实）：`BrowserManager` 在 window scope
构造，`otaCredentialRepository` 在 app scope，照 `setPartitionRetirer` 的现有套路
注入窄回调即可 —— `BrowserManager` 仍然不认识仓储。

```ts
// browser-manager.ts —— 只认一个窄函数，不认识 credential 是什么
type PartitionClaimCheck = (partitionName: string) => boolean;

private async clearRetiredPartitionWhenUnused(name: string): Promise<void> {
  if (this.tabs.values().some((t) => t.partitionName === name)) return;   // G1
  if (this.isPartitionClaimed(name)) {                                   // G2 🆕
    // 被认领说明它已经是某条 credential 的登录态 —— 退休标记本身就是错的，
    // 撤掉，否则它会永远留在集合里，被之后每一次 close() 重扫。
    this.retiredPartitions.delete(name);
    this.logger.warn('Retire cancelled: partition is claimed by a credential');
    return;
  }
  await this.sessionFactory.clearAccountSession(name);
  this.retiredPartitions.delete(name);
}
```

### 4.3 触发时机：去掉 close() 里的全量重扫

```ts
// 现状 —— 每关一个 tab 就把整个集合重扫一遍
close(tabId) {
  for (const p of this.retiredPartitions) void this.clearRetiredPartitionWhenUnused(p);
}
```

改为**只重试与本次关闭相关的那一个**：tab 关闭唯一新增的信息是「这个 tab 的
partition 现在没人用了」，与集合里其他条目无关。

```ts
close(tabId) {
  const { partitionName } = tab;
  if (this.retiredPartitions.has(partitionName)) {
    void this.clearRetiredPartitionWhenUnused(partitionName).catch(() => {});
  }
}
```

### 4.4 跨重启：`retiredPartitions` 不能只活在内存里

它是 window scope 的内存 Set，重启即清空 —— 「标记了退休但当时有 tab 占用」的
partition 之后永远不会被清。退休状态必须落到主线 C 的账本里。

---

## 5. 主线 C：单一事实来源

### 5.1 现状：三处散乱，且有一处是死的

| 来源 | 内容 | 问题 |
|---|---|---|
| `ota_credential.partition_name` | 已认领的 | 只覆盖 claimed |
| `pending-partitions.json` | 待认领的 | **`listPendingPartitions` 全仓零调用方**，只写不读 |
| 磁盘 `Partitions/` 目录 | 全集 | 依赖 Chromium 未公开的目录结构 |

### 5.2 方案对比

| | A 升级 JSON 账本 | B 扫描磁盘目录 |
|---|---|---|
| 做法 | `pending-partitions.json` → `partitions.json`，**记录每个创建过的 partition，只改状态**（`cleared` 按 §5.3.1 裁剪） | 启动时扫 `<userData>/Partitions/`，与 credential 表做差集 |
| 优点 | 语义完整（含 retired）；不依赖未公开实现 | 能捡回历史遗留孤儿 |
| 缺点 | 对已存在的 11 个孤儿无能为力 | 依赖 Chromium 目录结构，与 `pending-partitions-store.ts:1-22` 明确拒绝的做法冲突 |
| 结论 | **✅ 主方案** | **仅作一次性存量清理**，不进常规路径 |

### 5.3 账本形状

```ts
type PartitionRecord = Readonly<{
  partitionName: string;
  channel: ChannelId;
  environment: 'prod' | 'dev';
  createdAt: string;
  state:
    | { kind: 'pending' }                              // 建了，还没认领
    | { kind: 'claimed'; credentialId: string }        // 某条 credential 的登录态
    | { kind: 'retired'; retiredAt: string }           // 已被替换，等清理
    | { kind: 'cleared'; clearedAt: string };          // 已清空内容（目录仍在，见 §6）
}>;
```

### 5.3.1 账本必须有上限 —— 否则只是把「目录只增不减」换成「JSON 只增不减」

初稿写「条目永不删除」，那是错的：账本本身会无限增长，重蹈它要解决的问题。

**保留策略：`cleared` 条目按「数量 + 时间」双上限裁剪，取先命中者。**

| 状态 | 保留 | 理由 |
|---|---|---|
| `pending` / `claimed` / `retired` | **不裁剪** | 是活状态，删了就是丢失事实 —— 正是现在 11 个孤儿无法追溯的原因 |
| `cleared` | 保留最近 **50 条**，且不超过 **30 天** | 只有追溯价值，不影响正确性 |

```ts
function pruneCleared(records: readonly PartitionRecord[]): readonly PartitionRecord[] {
  const alive = records.filter((r) => r.state.kind !== 'cleared');
  const cleared = records
    .filter((r) => r.state.kind === 'cleared')
    .sort((a, b) => b.state.clearedAt.localeCompare(a.state.clearedAt))
    .filter((r, i) => i < 50 && withinDays(r.state.clearedAt, 30));
  return [...alive, ...cleared];
}
```

裁剪时机跟着写操作走（每次 `add` / 状态变更后顺手做一次），不另设定时器。

⚠️ **活状态不设上限是有意的**：如果 `pending` 累积到异常数量（比如上百条），
说明认领链路出了问题，**那是需要暴露的信号，不是需要裁掉的噪音**。可以在超过阈值
时记 warn，但不删。

### 5.4 清理触发点

| 时机 | 做什么 | 理由 |
|---|---|---|
| **应用启动** | 扫账本，清所有 `retired` 且三条守卫通过的 | 启动时没有任何 tab，G1 天然满足，最安全 |
| 替换事件发生时 | 尝试清被替换的那一个 | 即时回收，失败则留给下次启动 |
| tab 关闭时 | 只重试**该 tab 的** partition（4.3） | 唯一新增的信息就是这一条 |

不做「空闲定时清理」：收益低，且在用户操作期间动存储风险高。

---

## 6. 已知天花板：目录删不掉

`clearAccountSession` 只能 `clearStorageData` + `clearCache`，**Electron 没有删除
partition 目录的 API**（`session-factory.ts:87-91` 注释已承认）。所以：

- 「清理」的上限是**清空内容**，目录数只增不减
- 主线 A 只能把产出从 4 条路降到 3 条 —— 减产有限，**账本 + 正确回收才是主力**
- 21 个目录里 11 个孤儿，清空后仍占 11 个空目录 —— 可接受（每个空目录仅几 KB）

---

## 7. 存量修复

| 对象 | 处理 | 需用户确认 |
|---|---|---|
| 11 个孤儿 partition | 一次性扫描清空内容 | ✅ 删数据 |
| 5 个已损坏 credential（登录态被误清） | 不自动删；UI 上标记「需重新登录」，走现有 reauth 流程 | — |
| `SessionFactory.cache` 无淘汰 | tab 全关闭且非 claimed 时移除 | — |

**5 个损坏 credential 不自动删**的理由：它们的身份信息（账号 ID、名字、
`credentialExtra`）仍然有效，只是登录态没了；删掉等于让用户重新走一遍绑定，
而 reauth 流程本来就是为这个场景设计的。

---

## 8. 实施顺序

```
① P0 守卫 G2 + 撤销错误退休标记        ← 止血，改动最小，可独立验证
② 4.3 去掉 close() 全量重扫
③ 第 5 条路收敛：复用 partition + 删 PoiSwitch 键（档 B，仅抖音）
③b 入口重命名（§3.3 问题 1、3）—— 纯重命名，随 ③ 一起做
④ 主线 C 账本 + 启动清理
⑤ 存量一次性清理（需用户确认）
```

①② 是纯修复，③④ 改行为。③ 若真机验证失败（删键后抖音仍跳过选店页），退回现状（新建 partition），
不影响 ①②④ —— 误清 bug 已修、账本能追溯，问题从「丢登录态」降级为「目录偏多」。

---

## 9. 待确认问题

- [x] ~~**入口 4** 改为复用是否接受~~ → **问题不存在**：它本来就是复用（§3.2 订正）
- [x] ~~账本 `cleared` 是否永久保留~~ → **不保留**，按数量 50 + 时间 30 天双上限
      裁剪（§5.3.1）。活状态不裁，`pending` 异常堆积是要暴露的信号
- [x] ~~`openExistingInFreshPartition` 的前提是否还成立~~ → **成立**。用户澄清：
      一个抖音账号管多家门店，绑第 2 家时必须重新选店，且已多次实测「复用 partition
      会直接跳到上次那家门店，流程走不通」
- [x] ~~抖音选店记录是否只在 localStorage~~ → **是**，已实测定位到
      `core:PoiSwitch:poi_<poiId>_<uuid>`，IndexedDB 无（§3.1.1）
- [x] ~~档 A 还是档 B~~ → **档 B**（只删 `core:PoiSwitch:*` 键），失败再退档 A
- [x] ~~携程/美团是否也有同类记录~~ → **没有**（用户确认二者无选店页），
      故第 5 条路对携程/美团**直接复用 partition，不做任何清理**，删键只对抖音执行
- [x] ~~存量 11 个孤儿怎么清~~ → **直接清掉**，静默执行，不给 UI 入口
- [ ] 第 5 条路改完后 `openExistingInFreshPartition` 是否还有调用方？无则整个方法可删
- [x] ~~重命名是否本次一起做、是否碰 IPC 契约~~ → **一起改，IPC 契约也改**，
      四层（channel 字符串 / preload / service / renderer store）命名对齐
- [x] ✅ **已由 `reauth-intent-and-legacy-binding` 承接**（§3.4）：第 8 条路
      （重新登录·换账号）借用绑定意图，
      缺少可区分的来源标记，日志上与「新增绑定」无法分辨（§3.3 问题 2）
