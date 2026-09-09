## Context

动机见 `proposal.md`。以下是决定实现形态的既有事实，全部回核过代码：

| # | 事实 | 出处 |
|---|---|---|
| 1 | RMS 只有**一个** origin 常量，指向 API；无 web 页面地址 | `main/staff-auth/rms-endpoint.ts:12` |
| 2 | dev 下 API 在 `:8080`，rms-admin dev server 在 `:5173`；pre/online 由 nginx 同源托管 | `app-env-profiles.mjs:57,68,80`、rms `scripts/nginx/rms.conf:19` |
| 3 | `RmsTokenProvider` 只暴露 `accessToken(): Promise<string>`，**拿不到 token 对** | `rms-token-provider.ts:29` |
| 4 | `StaffTokenStore` 在 app-scope 内联构造后未留在 scope 上，外部够不着 | `composition/app-scope.ts:135-140` |
| 5 | desktop **没有「当前酒店」概念**：`currentHotelId` 全仓仅出现在一处注释 | `rms-auth-client.ts:92`（注释）、`packages/api/src/contracts.ts:68`（字段定义，无消费方） |
| 6 | 全仓无 `/hotels/{id}/select` 调用，无 `selectHotel`/`switchHotel` | grep 全仓无命中 |
| 7 | `OtaTabService` 是 OTA 标签页唯一开口，四条路都 `register` + 新建 partition | `main/ota-tab/ota-tab-service.ts:51-149` |
| 8 | ⭐ 登录判定/门店探测/改价监听三者**都以 registry 投影出的 Map 为准**，查不到即 return | `login-detector.ts:80-84`、`amount-change-watcher.ts:69-71` |
| 9 | ⭐ 孤儿回收的安全判据是**段数恰为 5** + 环境段相等，不是白名单 | `partition-cleanup.ts:137-145` |
| 10 | `toChannelId` 无白名单，只校验 `/^[a-z0-9][a-z0-9-]*$/` 与长度 | `main/ids.ts:27,44-47` |
| 11 | renderer 拿不到任何 token，preload 未暴露 | `preload/namespaces/staff-auth.ts:11-27` |
| 12 | 点渠道图标只切栏位，不开 tab；开 tab 在账号切换弹窗里 | `browser-ota-tabs.svelte.ts:201-208` |
| 13 | 加载失败日志刻意不记 URL（防 token 落盘）；URL 上限 2048 | `browser-manager.ts:251-258`、`shared/browser.ts:10` |

⭐ 第 8 条是本设计的支点：**不注册即不生效**，无需写任何空实现或加判断。
⭐ 第 9 条是一个陷阱，见决策 4。

**页面侧既有行为**（rms-admin，本次不改）：

```ts
// UnifiedPricingLayout.tsx:138
if (token && refreshToken) { setTokens(token, refreshToken) }   // 短路与
// :145  但清理是「或」
if (params.has('token') || params.has('refreshToken')) { /* 从地址栏抹掉 */ }
// utils/request.ts:71-75  401 且无 refreshToken
if (!refreshToken) { window.location.href = '/login' }
```

⇒ 只传 `token` 当前是**静默失败**：登录态不写入，token 还照样被抹掉。

## Goals / Non-Goals

**Goals**

- 渠道管理里点一下就能用统一改价页，不再切系统、不再登一次
- 这条链路与 OTA 链路彻底隔离，互不影响
- 令牌暴露面尽可能小

**Non-Goals**

- 不做「当前酒店」的本地表示与切换（事实 5/6；页面顶栏自带切换器，够用）
- 不做通用的「内部页面框架」——目前只有一个页面，抽象等到第二个出现
- 不做**页面自己**的令牌续期；续期由主进程做、desktop 重载页面（决策 1 方案 E）
- 不改 rms-admin（诉求见文末）

## Decisions

### 决策 1：只传 accessToken，不传 refreshToken

**理由**：在 desktop 里能打开这个 tab ⟺ 已登录 —— 入口在登录后的主界面里，且令牌由主
进程给（无有效会话时 `accessToken()` 直接抛 `RmsSessionMissingError`，`rms-token-provider.ts:108`，
根本拼不出 URL）。页面「自己判断登录态、自己续期、失效跳 `/login`」那一套是为**浏览器**
场景设计的：那里页面是登录态的持有者。desktop 里持有者是主进程，页面只是显示层。

| 方案 | 8 小时后 | 落盘凭证寿命 | 结论 |
|---|---|---|---|
| A 传双 token | 页面自行续期，无感 | refresh 7 天 | 职责错位；长效凭证进 webview 磁盘 |
| B 只传 access | 跳 `/login`，desktop 用户**卡死** | access 8 小时 | 需页面侧配合改落点 |
| C 只传 access + 失效回调 desktop | desktop 重开 | 8 小时 | 通道复杂 |
| ~~D 只传 access + 页面提示重开~~ | 提示「请重新打开」 | 8 小时 | ❌ **已废弃**，见下 |
| **E 只传 access + desktop 拦截跳转** | 自动换新 token 重载，**无感** | 8 小时 | ✅ 选它 |

**选 E**（服务端 `desktop-integration.md` v2.0 提出，我方接受）。

### 为什么放弃 D

D 让页面显示「登录已过期，请重新打开此页」。**「显示一句提示」不是流程，是死路** ——
用户看到提示后没有下一步可做，还得自己关掉再点一次。而且它需要 rms-admin 改
`utils/request.ts` / `AuthGuard.tsx` 这些**全 admin 共用**的文件。

更关键的是：跳 `/login` 的路径**实际有三条**，D 的诉求只点了第一条 ——

| 位置 | 触发条件 | 形式 |
|---|---|---|
| `request.ts:75` | 无 refreshToken | `window.location.href` |
| `request.ts:93` | refresh 请求本身失败 | `window.location.href` |
| `AuthGuard.tsx:18` | store 里没有 accessToken | `<Navigate>`（React Router） |

只改第一条，access token 8 小时后过期照样走第二条 —— **用户还是卡死，只是晚 8 小时**。

### E 的流程

```
页面里某个请求 401
   ↓
拦截器发现没有 refreshToken（我们没传）
   ↓
window.location.href = '/login'      ← 页面照常这么做，不改
   ↓
⭐ desktop 的 will-navigate 拦下「要去 /login」→ preventDefault()
   ↓
await rmsTokens.accessToken()        ← 自带过期判断 + 自动刷新 + 并发去重
   ├─ 成功 → 用新 token 重新 loadUrl(`…?token=<新的>`)，用户无感
   └─ 抛 RmsSessionMissingError → App 整体登录态已失效
                                 → 关掉此 tab，走 App 自身的登录流程
```

⭐ **判据是「目标 URL 落到 `/login`」，不是 HTTP 状态码** —— webview 里的 XHR 401
主进程拦不到，但页面跳转拦得到。页面把「登录态没了」表达成了一次导航，这正好是
desktop 能拦的形式。

### ⚠️ E 的边界：第三条路径拦不到（已回核）

`AuthGuard` 用的是 React Router 的 `<Navigate>`（`router/index.tsx:29` 是
`createBrowserRouter`），那是**客户端路由切换，不是真实导航**，`will-navigate`
收不到。

**但这不影响 E 成立**：rms-admin 落地「只有 token 也写入登录态」之后，store 里必然
有 accessToken，`AuthGuard` 直接放行，此后的失效都走 `request.ts` 那两条真导航。

⇒ 唯一的影响是**联调顺序**：服务端那处改动必须先落地，desktop 的拦截逻辑才验得到。
服务端文档 §7 说「改动落地前正好能验拦截」，那半句不成立，已在
`server-feedback.md` §3 反馈。

⭐ 「挂机 8 小时后失效」在**改价**场景里本身不是缺陷：这页会真实修改线上售价，页面
刻意不预填价格、强制二次确认。E 只是把「失效」从「用户卡死」变成「无感续期」，
并没有把一个挂了一夜的页面变得可以直接下发改价 —— 续期后页面是重新加载的。

### 决策 2：取令牌的能力加在 `RmsTokenProvider` 上，而不是把 tokenStore 提到 scope

两条路都能拿到令牌（事实 3/4）：

| 方案 | 问题 |
|---|---|
| 把 `StaffTokenStore` 提到 app-scope | 绕开 provider 的过期判断与**并发刷新去重**，可能读到一枚刚被换掉的旧令牌 |
| **给 `RmsTokenProvider` 加方法** | 复用全部既有逻辑 ✅ |

现成的 `accessToken(): Promise<string>` **就是要的东西**——它已经保证「返回的令牌当前
可用，必要时先刷新」。决策 1 既然不要 refresh token，就**不需要新增任何方法**，直接用它。

⇒ 事实 3 记录的「拿不到 token 对」在决策 1 之下不再是障碍。这是只传单 token 的额外收益：
`main/staff-auth/` 一行不用改。

### 决策 3：绕开 `OtaTabService`，新开一条窄链路

`OtaTabService` 每条路都做两件对内部页面有害的事（事实 7）：

```
sessionForLogin        → 每次点击新建一份 partition，且 partition 永不删除
rememberPendingPartition → 写 pending 账本记录，因无探测而永不转 claimed
```

第二条最脏：`pending` 刻意不设数量上限（它是「认领链路故障」的信号），混入一批永不认领
的记录会让该信号失效。

而**登录判定 / 门店探测 / cookie 采集 / 改价监听都不会误挂**（事实 8）—— 只要不在
`channels/registry.ts` 注册。这是现成的逃生口，不需要写空实现。

| 方案 | 判断 |
|---|---|
| 给 `OtaTabService` 加第四种 intent | ❌ 那三种 intent 全是绑定/重认语义，塞进去会让「这个开口管什么」失焦 |
| `shell.openExternal` | ❌ 丢到系统浏览器：token 进外部浏览器历史，且失去「应用内工作区」的产品语义 |
| 自建 `WebContentsView` 管理器 | ❌ 要复刻 bounds/可见性/让位那一整套（已有零尺寸事故的踩坑记录） |
| **复用 `BrowserManager` + 固定 partition** | ✅ 通用基础设施（bounds、MAX_TABS、popup 节流、失败态）全复用，只跳过 OTA 语义那两行 |

```
renderer 点击「小智平台」
   │
   ├─ IPC  internalPage.open()          新通道，无入参
   │
main/ipc/internal-page-handlers.ts       ← 放 ipc/，不放 services/
   │                                        （eslint 禁 services→browser）
   ├─ rmsTokens.accessToken()           必要时自动刷新
   ├─ 拼 URL：<webOrigin>/unified-pricing?token=…
   └─ browserManager.createWithAlreadyPartition(
          INTERNAL_PAGE_PARTITION, 'xiaozhi', url)
   │
renderer  browserOtaTabs.adopt(tab)      ← 必须复用，否则重演零尺寸事故
```

**装配**：参照 `registerBrowserHandlers`（`window-scope.ts:187`）直接注入 `browserManager`，
不要参照 `registerOtaTabHandlers`。

### 决策 4：⚠️ partition 命名必须是 4 段，不能是 5 段

孤儿回收的安全判据是**段数恰为 5** + 环境段相等（事实 9），不是白名单：

```ts
segments.length === 5 && segments[2] === APP_ENVIRONMENT   // partition-cleanup.ts:139-144
```

| 候选命名 | 段数 | 后果 |
|---|---|---|
| `persist:xiaozhi:<env>:internal:pricing` | 5 | 💥 **被判为 OTA 孤儿，每次启动清空** |
| `persist:xiaozhi:<env>:internal` | 4 | ✅ 段数不足，天然排除 |

选 4 段 `persist:xiaozhi:<env>:internal`。与既有基础设施 partition（`:server-api` / `:rms-api`，
段数 3）同一手法 —— 那两个也是靠段数不足被挡在外面（`partition-cleanup.ts:126`）。

保留 `<env>` 段以满足环境隔离要求。新增 `SessionFactory.sessionForInternalPage()`，与
`sessionForRmsApi()` 并列 —— partition 字符串只允许出现在这个文件里。

**这条必须有测试守住**：命名改动会静默导致用户数据被清。

### 决策 5：渠道入口加 `kind` 分流，不硬塞进 OTA 列表

`OTA_CHANNELS` 是「id → 展示信息」字典，被酒店卡片、重认弹窗、cookie 列表用 `.find()`
反查。直接塞 `xiaozhi` 进去，它会出现在那些**只应列 OTA 账号**的地方。但完全不加又不行：
`activeChannel` 靠 `OTA_CHANNELS.find()` 求得，缺了它右上角显示「未选择渠道」（`BrowserWorkspace.svelte:56,575`）。

```ts
export type WorkspaceEntry = Readonly<{
  id: string;
  name: string;
  shortName: string;
  iconUrl: string;
  kind: 'ota' | 'internal';     // ⭐ 新增
  url?: string;                  // internal 的 URL 由主进程拼（含 token），renderer 不持有
}>;
```

- `kind: 'internal'` 的条目：不进 `BINDABLE_CHANNEL_IDS`、不进账号切换弹窗、不被历史
  绑定记录反查
- 点击行为分流（事实 12）：OTA 走 `selectChannel`（切栏位），internal **直接开 tab**

渠道 id 用 `xiaozhi`，`toChannelId` 无需改动（事实 10）。

### 决策 6：web 地址与 API 地址分开固化，未配置时回落 API 地址

事实 1/2：dev 下两者不同端口，pre/online 恰好同源。同源是**部署形态的巧合**，不是可依赖
的约束（nginx 配置随时可能拆分）。

新增 `__RMS_WEB_ORIGIN__`，与 `__RMS_ORIGIN__` 并列，取值优先级照搬现有模式：

```
XIAOZHI_RMS_WEB_URL  >  profile.rmsWebOrigin  >  profile.rmsOrigin（回落）
```

回落到 API 地址是刻意的：pre/online 同源是常态，强制每个环境重复填一遍徒增出错面。
dev 的 profile 显式填 `http://localhost:5173`。

HTTPS 强制校验同等作用于它 —— 它同样承载访问令牌。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| ⚠️ **partition 命名写成 5 段 → 用户数据每次启动被清** | 决策 4；必须有测试断言该名字不被 `isOtaLoginPartition` 命中 |
| token 进 URL，可能落进日志/导航历史 | 页面立刻 `replaceState` 抹掉；`browser-manager.ts:251-258` 本就不记 URL；**新链路的日志同样不得记 URL** |
| URL 2048 上限（事实 13） | 单个 JWT 约 300-600 字节，只传一个绰绰有余；这也是不传 refresh 的次要收益 |
| 页面 8 小时后失效 | 决策 1 方案 E：desktop 拦下跳转、换新 token 重载，用户无感 |
| ⚠️ 拦截判据过宽会误伤正常导航 | 只对**内部页面的 tab**、且目标落到 `/login` 时生效；其余导航一律放行 |
| ⚠️ 续期后仍跳 `/login`（死循环风险） | 同一 tab 连续拦截设上限，超限则关 tab 走 App 登录，不无限重载 |
| rms-admin 未配合前无法端到端联调 | desktop 可独立验 URL 拼装、tab 打开、partition 行为；**但拦截逻辑验不到**（见决策 1 边界），页面渲染待对方 |
| 与 OTA tab 共用 MAX_TABS=12 配额 | 内部页面固定 partition，重复点击应复用已有 tab 而非叠开（tasks 覆盖） |

## 对 rms-admin 的诉求（外部依赖，本次不实施）

**只有一条**，全文见 `server-feedback.md` §2。

> 需求：`/unified-pricing` 在只收到 `token`、没有 `refreshToken` 时，必须能正常建立
> 登录态；且**不得使用 localStorage 里既有的 refreshToken 续期**（可能是上一个用户
> 残留的，会续出别人的会话 —— 这是改价页，身份错了就是改错酒店的价）。

采用决策 1 方案 E 后，原先的第 2 项诉求（改 `request.ts` 的跳转落点）**已撤销**：
页面照常跳 `/login`，由 desktop 拦截。rms-admin 不必区分宿主，也不必动全 admin 共用
的文件。

在这条需求落地前，desktop 的表现是：tab 能打开，页面因拿不到登录态跳 `/login`，
且这一跳走的是 `AuthGuard` 的客户端路由 —— **拦不到**，所以此阶段验不了拦截逻辑
（见决策 1 边界）。

## Open Questions

- 重复点击「小智平台」时，是复用已有 tab 还是允许开多个？~~倾向复用~~ → **已实现为
  复用**（改价页开多个没有意义，且各自的 token 过期时刻不同会造成困惑）。
