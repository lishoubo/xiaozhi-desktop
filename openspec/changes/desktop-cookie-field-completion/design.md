## Context

动机见 `proposal.md`。这里只记设计要用到的现状与实测事实。

### 现状链路

```
IPC hotel-management:confirm-*
        │  只带 credentialId，没有 webContents
        ▼
HotelManagementService.confirmBinding / confirmReauth / confirmBackfillHotel
        │  deps.readCookieSnapshot(credential.partitionName)
        ▼
app-scope.ts:89  readCookieSnapshot          ← 全仓唯一采集点
        │  sessionFactory.sessionForAccount(partitionName).cookies.get({})
        │  .map(c => ({ domain, name, value }))     ← 只留 3 个字段
        ▼
RmsOtaAccountGatewayHttp  →  POST/PUT /api/v1/app/ota-accounts
```

### 实测事实（Electron 43.2.0 / Chrome 150，真实抖音登录态，同一 partition）

| 对比项 | `session.cookies.get({})` | CDP `Network.getAllCookies` |
|---|---|---|
| 总条数 | 38 | 38 |
| **分区 cookie** | **0** | **13** |
| 会话 cookie | 1 (3%) | 1 (3%) |
| 最长有效期 | 365 天 | 365 天 |
| `sameSite` 值域 | `no_restriction` / `unspecified` | `None` / `null` |
| 同名重复 | 14 组 ×2 | 14 组 ×2 |

两条路**总数相同**，这是理解本次改动的关键：分区与非分区的同名 cookie，Electron API
两条都返回了，只是结构里没有 `partitionKey` 字段可供区分。服务端按
`(name, domain, path, partitionKey)` 去重后，这 14 组各塌缩成 1 条 —— **不是没采到，
是采到了但分不清，等于丢**。

CDP 独有的 13 条分区 cookie 全是登录票据：`sessionid_ls`、`sid_tt_ls`、`uid_tt_ls`、
`has_biz_token_ls`、`sid_ucp_v1_ls`、`is_hit_partitioned_cookie_canary` 等。

另一个反直觉的点：会话 cookie 占比与最长有效期两项，Electron API 的数据**本来就是好的**。
服务端看到「44/44 全是会话 cookie、无长期有效期」，不是采集能力问题，是我们没上送
`expirationDate`，接收方只能按会话 cookie 处理。

### 约束

| 来源 | 约束 |
|---|---|
| `desktop-main-layering` | `services/` 不得直接开 tab、不得 import `browser/`；OTA 标签页唯一开口是 `ota-tab/` |
| 同上 | `ipc/` 只做边界，不得 import `electron` |
| 同上 | 只有 `composition/` 能 import 实现类，其余各层依赖窄接口 |
| `amount-save-capture.ts:144` | `webContents.debugger` **独占**；`HotelProbe` 也会 attach，抢占会让绑定流程失败 |

## Goals / Non-Goals

**Goals:**

- 上送快照满足 `specs/ota-cookie-snapshot/spec.md` 的全部要求
- 采集降级路径与主路径**共用同一套字段映射与省略规则**，两条路产出的条目形状只差 `partitionKey`
- 采集失败不影响绑定 / 重新登录 / 补门店三条业务流程

**Non-Goals:**

- 不改本地 credential 存储结构、不改探测链路、不改 `bindExtra` 等其余上送字段
- 不为 cookie 采集新建窗口或后台常驻 debugger 会话
- 不做 cookie 内容的语义解读（哪条是登录票据由服务端判断）
- 不追求 `ttwid` 达到 2 条（见 Open Questions）

## Decisions

### 决策 1：采集方式走 CDP，Electron API 降级兜底

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 只用 `session.cookies.get()` | 改动 30 行，无 debugger 冲突 | **分区 cookie 恒为 0**，验收项「CHIPS ≥10 条」永远不过，掉线大概率不缓解 | ✗ |
| 只用 CDP | 快照完整 | debugger 被探测占用时整条业务流程失败 | ✗ |
| **CDP 主 + Electron API 降级** | 常态拿到完整快照；冲突时退化而非失败 | 两条采集路径需共用映射逻辑 | ✓ **采用** |

降级快照虽缺 `partitionKey`，但仍比现状（3 字段）好得多 —— `expires` 补上后接收方不再
把全部 cookie 当会话 cookie，这一项本身就可能显著延长登录态寿命。

### 决策 2：复用 OTA 标签页的 webContents，按 partitionName 查找

CDP 需要一个 `webContents` 才能 attach。候选：

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 新建隐藏 `BrowserWindow` | 与探测零冲突，时机不受标签页状态影响 | 多一次窗口创建；`services/` 开窗口违反分层 | ✗ |
| **复用 OTA 标签页 webContents** | 零额外开销；采集时机（绑定收尾）标签页几乎必然开着 | 需处理「已关闭」「debugger 被占」两种缺席 | ✓ **采用** |

查找键用 **`partitionName` 而非 `credentialId`**：`BrowserManager` 的 `ManagedTab` 本身就
带 `partitionName`（`browser-manager.ts:242`），而 `readCookieSnapshot` 现有签名收的正是
`partitionName` —— 用它做键，调用方签名一个字都不用改。

```
BrowserManager
  private readonly tabs = new Map<string, ManagedTab>()
                                   ManagedTab { partitionName, view.webContents, ... }
        │
        │ 新增：按 partitionName 反查 webContents
        ▼
  webContentsForPartition(partitionName): WebContents | null
```

### 决策 3：采集器落在 `browser/`，经 composition 注入

采集是浏览器基础设施能力，不是业务编排。放 `main/browser/cookie-snapshot/`，
由 composition root 组装后以窄接口注入，`services/` 只看见一个函数。

```
main/browser/cookie-snapshot/
  collect-cookie-snapshot.ts     采集编排：CDP 优先 → 失败降级 → 记日志
  cdp-source.ts                  CDP Network.getAllCookies
  electron-source.ts             session.cookies.get() + sameSite 映射
  to-snapshot-entry.ts           ★ 两条路共用的字段映射与省略规则

app-scope.ts (composition root)
  readCookieSnapshot = (partitionName) =>
      collectCookieSnapshot({ partitionName, sessionFactory,
                              webContentsForPartition, logger })
```

`to-snapshot-entry.ts` 单独抽出是有意的：省略规则（`null` 不传、`expires <= 0` 省略、
`sameSite` 未指定省略）是本次最容易写错的地方，抽成纯函数才能脱离 Electron 裸测。

### 决策 4：契约类型放宽为可选字段

```ts
// main/gateway/rms/types.ts
export type RmsCookieSnapshotEntry = Readonly<{
  name: string;
  value: string;
  domain: string;
  // 以下全部可选：缺省时 **整个 key 不出现在 JSON 里**，不是 undefined 也不是 null
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'None' | 'Lax' | 'Strict';
  expires?: number;
  /**
   * CDP 原样透传。**刻意用 unknown**：不同 Chrome 版本形态不同（对象 / 字符串），
   * 任何解析或归一化都会让浏览器不认这个分区键。这里不需要读它，只需要原样搬运。
   */
  partitionKey?: unknown;
}>;
```

`partitionKey` 用 `unknown` 而非具体对象类型，是因为**我们不该读它**。给出精确类型等于
邀请后续代码去访问 `.topLevelSite`，而那正是规范禁止的加工。

⚠️ `JSON.stringify` 会丢掉值为 `undefined` 的键，这与「省略字段」的要求正好一致 ——
但前提是**赋 `undefined` 而非 `null`**。映射函数必须用条件展开：

```ts
...(cookie.sameSite ? { sameSite: mapSameSite(cookie.sameSite) } : {}),
```

### 决策 5：sameSite 映射表

CDP 直接给规范要求的值域，无需映射；只有降级路径需要：

| Electron 值 | 上送值 |
|---|---|
| `no_restriction` | `"None"` |
| `lax` | `"Lax"` |
| `strict` | `"Strict"` |
| `unspecified` | **省略字段** |

`unspecified` 绝不可补成 `"Lax"`：未设置（浏览器按默认策略处理）与显式 `Lax` 是两种不同
行为，补默认值会让跨站 XHR 不再携带登录态。

### 决策 6：attach 生命周期 —— 只 detach 自己 attach 的

沿用 `amount-save-capture.ts:183` 已验证的写法：

```ts
const attachedByUs = !dbg.isAttached();
if (attachedByUs) dbg.attach('1.3');
try {
  const { cookies } = await dbg.sendCommand('Network.getAllCookies');
  return cookies;
} finally {
  if (attachedByUs && dbg.isAttached()) dbg.detach();
}
```

`isAttached()` 为 true 时**不抢占也不报错**，直接走降级 —— 占着的是探测链路，
它是用户正在等结果的前台流程。

注意本次**不需要 `Network.enable`**：`getAllCookies` 是即时查询，不订阅事件。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| debugger 被探测占用 → 拿不到分区 cookie | 降级路径兜底，业务不失败；结构化日志留痕，服务端可区分「未改造」与「本次降级」 |
| 降级发生频率未知，可能常态化 | 日志带 `degraded: true` 与原因；上线后据此判断是否需要改成「等待 debugger 释放后重试」 |
| `partitionKey` 用 `unknown`，编译期不校验形状 | 正是本意（禁止加工）；由「原样透传」的单测锁住行为 |
| 快照体积变大（3 字段 → 9 字段） | 实测 40~50 条约 7~9KB，服务端上限 1000 条 / 32000 字节，余量充足 |
| CDP 返回体量大时 `sendCommand` 超时 | 实测 38 条即时返回；异常一律走降级，不阻塞业务 |

## Migration Plan

服务端接收端已上线且向后兼容（新增字段全部可选），**无需前后端同时发布**，客户端自行排期。

回滚：本次改动全部收敛在采集与映射层，回滚 `readCookieSnapshot` 的实现即可恢复旧行为，
无数据迁移、无 schema 变更。

验证顺序：单测锁住映射与省略规则 → 真机抖音登录一次 → 通知服务端跑只读核验工具比对
`specs` 的验收项 → 观察 24 小时是否复发 `LOGIN_EXPIRED`。

## 真机验证结论（2026-09-07 补记）

证据与排查过程见 `verification.md`。两条结论要写回本文，因为它们**修正了本设计的一个前提**：

### 修正：分区 cookie 在 desktop 绑定路径下不存在

Context 里「CDP 能拿到 13 条分区 cookie」这个数据来自探针的特定浏览路径，**当时未验证
绑定流程是否产生同样的 cookie**。真机验证表明：

| | 顶级站点轨迹 | 分区 cookie |
|---|---|---|
| 探针（写 design 时的依据） | 登录重定向经过 `douyin.com` | 13 条 |
| **desktop 绑定流程** | 全程 `life.douyin.com` | **0 条** |

CHIPS 分区 cookie 只在顶级站点为 `douyin.com` 时写入，而 desktop 的落地页写死为
`life.douyin.com/p/login`（`channels/landing-url.ts`），顶级站点从未变成 `douyin.com`。

**这不改变本设计的任何决策**：走 CDP 仍是唯一能取到分区键的方式（已验证：罐子里有
13 条时 `Network.getAllCookies` 全部取到，且与浏览路径无关），只是当前绑定路径下罐子里
本来就没有。字段补齐（`expires` / `sameSite` / `path` / `secure` / `httpOnly`）已达成，
这部分才是「44/44 全是会话 cookie」的直接修复。

要不要让分区 cookie 出现，取决于服务端 RPA 在哪个顶级站点下写回并使用 cookie —— 属独立
变更（会触及已稳定的登录判定逻辑），不在本 change 范围内。

## Open Questions

- **RPA 的顶级站点上下文**：待服务端回答。若 RPA 同样在 `life.douyin.com` 下操作，则分区
  cookie 不会被携带，「CHIPS ≥10 条」这条验收项不适用于 desktop；若需要 `douyin.com` 上下文，
  则另起 change 处理落地页与登录判定。
- **`ttwid` 能否达到 2 条**：服务端 RPA 对照有 2 份（`.douyin.com` + `.bytedance.com`，值不同），
  实测只有 1 份。与上一条同源（登录路径触达的域不同），**不作为本次硬性目标**。
- **降级是否需要重试**：真机验证未出现降级（`degraded: true` 一次都没打），暂无数据支撑，
  维持「立即降级」。据线上日志频率再决定。
