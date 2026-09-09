# 统一改价页 · 给 rms-admin 侧的反馈与需求

> **面向**：`xiaozhi-rms-workspace` 开发者
> **对应文档**：`openspec/changes/unified-price-push-ui/desktop-integration.md` **v2.0**
> **对应 desktop change**：`xiaozhi-unified-pricing-entry`
> **日期**：2026-09-09

---

## 0. 一句话

**v2 方案接受，desktop 侧拦截方案已实施完成**（代码 + 14 条新增单测，见 §4）。
需要 rms-admin 侧改的**只有 1 条需求**（§2）；另有 **1 处事实订正**（§3），
它不影响方案成立，但会影响联调顺序。

---

## 1. v2 方案：接受

| v2 的判断 | desktop 侧核实结果 |
|---|---|
| 登录态持有者是主进程，页面不该猜宿主 | ✅ 同意，且比我们原方案更干净 |
| `will-navigate` + `preventDefault` 已有 | ✅ 属实，`browser-manager.ts:572` |
| `accessToken()` 自带过期判断 + 刷新 + 并发去重 | ✅ 属实，`rms-token-provider.ts:106-127` |
| 这条链路不需要新增 IPC / 页面回调 / 新 API | ✅ 属实 |

**你们的反馈 ② 是对的，我们的 design 漏了两条路径。** 已核实实际有三处跳 `/login`：

| 位置 | 触发条件 | 形式 |
|---|---|---|
| `request.ts:75` | 无 refreshToken | `window.location.href` |
| `request.ts:93` | refresh 请求本身失败 | `window.location.href` |
| `AuthGuard.tsx:18` | store 里没有 accessToken | `<Navigate>` |

我们原先的诉求只点了第一条。已在 desktop 侧 design 中订正。

---

## 2. ⭐ 需求（唯一一条）

### 需求：只收到 `token`、没有 `refreshToken` 时，页面必须能正常建立登录态

**怎么实现由 rms-admin 侧决定**，以下只描述期望行为。

#### 当前行为

只传 `token` 时**静默失败**：登录态完全不写入，而 token 仍被从地址栏抹掉
（写入判断用「与」、清理判断用「或」）。页面随后当作未登录处理。

#### 期望行为

| 输入 | 期望 |
|---|---|
| `?token=<有效>` | 正常进页面，能发出业务请求并渲染数据 |
| `?token=<有效>`，且 localStorage 存有旧 refreshToken | 正常进页面，**且旧 refreshToken 不得被用于续期** |
| 不带 token（浏览器里直接打开） | 维持现状，跳登录页 |

#### ⚠️ 硬约束：不得使用 localStorage 里既有的 refreshToken 续期

同一台机器若曾用浏览器登录过 admin，localStorage 会残留**上一个用户**的
refreshToken。若拿它续期，会续出**另一个用户的会话**。

**这是改价页 —— 身份错了就是改错酒店的价。**
desktop 传来的 access token 是这个页面唯一可信的身份来源。

（v2 §7 已经指出这一点，此处只是确认我们理解一致、且认为它不可省。）

#### 验收标准

desktop 带一枚有效 access token 打开 `/unified-pricing?token=...`，
能看到房型 × 日期网格并正常读到数据。

---

## 3. ⭐ 事实订正：§7 的「先验拦截」做不到

### v2 §7 原文

> **在这一处落地前**：desktop 侧可先验 URL 拼装、tab 打开、partition 行为；
> 页面会因拿不到登录态跳 `/login`（**此时正好也能验 desktop 的拦截逻辑**）。

### 订正

**加粗那半句不成立。** 需求 §2 落地前，desktop 的拦截逻辑**验证不到**。

原因：`/unified-pricing` 外面套着 `AuthGuard`（`router/index.tsx:39`），
而 rms-admin 用的是 `createBrowserRouter`（`router/index.tsx:29`）：

```
需求 §2 未落地
   ↓
setTokens 不执行 → store 里没有 accessToken
   ↓
AuthGuard 用 <Navigate to="/login"> 跳转
   ↓
这是 React Router 的客户端路由切换，不是真实页面导航
   ↓
❌ desktop 的 will-navigate 收不到 —— 拦不下
```

`will-navigate` 只在真实导航时触发。三条路径里能被拦的是
`request.ts` 的那两处 `window.location.href`，`AuthGuard` 那条拦不到。

### 对方案的影响：无

需求 §2 落地后，store 里必然有 accessToken，`AuthGuard` 直接放行，
此后的失效都走 `request.ts` 那两条真导航 —— **v2 方案本身是成立的**。

### 对联调顺序的影响：有

```
需求 §2 落地  ──必须先──▶  desktop 拦截逻辑才能验证
```

⇒ v2 §8 自查表第 4 条（「传一枚已过期的 token → desktop 拦下 → 换新 token 重载」）
是这套方案的**核心路径**，它的验证**依赖需求 §2 先落地**。
排期时请把这条依赖考虑进去。

---

## 4. desktop 侧当前进度

| 项 | 状态 |
|---|---|
| 构建期 RMS web 地址（与 API 地址分离） | ✅ 已完成 |
| 内部页面固定 partition（不入账本、不被回收） | ✅ 已完成 |
| 打开入口 + URL 拼装（只带 token） | ✅ 已完成 |
| 渠道入口区分 OTA / 内部页面 | ✅ 已完成 |
| **按 v2 改为拦截方案** | ✅ **已完成** |
| ↳ 拦下登录页跳转 → 换新令牌重载 | ✅ 已实现 |
| ↳ 主进程会话也失效 → 关 tab，不留在 RMS 登录页 | ✅ 已实现 |
| ↳ 连续跳转超限 → 关 tab，防死循环 | ✅ 已实现 |
| ↳ 拦截决策链单测（拦/放行/续期/关 tab/日志不含令牌） | ✅ 11 条 |
| ↳ 守卫确实接在 `will-navigate` 上（含反向验证） | ✅ 3 条 |
| **端到端联调** | ⬜ **阻塞于需求 §2** |

desktop 侧自动化验证：**888 单测通过 / 112 文件**，lint 与类型检查无新增错误。

desktop 已确认**不传** `refreshToken`、**不传** `hotelId`，与 v2 §2 的表格一致。

---

## 5. 需要 rms 侧确认的

1. 需求 §2 的排期
2. §3 的订正是否认可 —— 若认可，建议在 `desktop-integration.md` §7
   末句去掉「此时正好也能验 desktop 的拦截逻辑」，避免后来者按它安排联调顺序

---

## 6. 相关文档

| 文档 | 位置 |
|---|---|
| desktop 侧 design / tasks / 验证记录 | `xiaozhi-desktop` 的 `openspec/changes/xiaozhi-unified-pricing-entry/` |
| 服务端接入手册 v2.0 | `openspec/changes/unified-price-push-ui/desktop-integration.md` |
