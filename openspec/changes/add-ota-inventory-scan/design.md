## Context

动机见 `proposal.md`。总纲见 `docs/arch/2026-09-20-ota-inventory-snapshot-and-scan.md`。

**Change A 已交付的地基**（本次只接线，不重写）：

| 已有 | 位置 |
|---|---|
| 基线表 + repository（含 `findByHotelAndDateRange` 一次读一批） | `database/ota-inventory-snapshot-repository.ts` |
| 写入队列（投递即返回、按格子键去重、分批让出） | `inventory-snapshot/snapshot-write-queue.ts` |
| 比对纯函数（`changed` / `added` 分开） | `inventory-snapshot/snapshot-diff.ts` |
| 携程行→格子映射 | `inventory-snapshot/ctrip-cells.ts` |
| 上报服务（补身份、归一 `masterHotelId`、重试 1 次） | `services/amount-change-report-service.ts` |
| 失效四形态判据 | `channels/ctrip/inventory-readback.ts` |
| 运行期配置 | `main/app-config/` |

**Change A 的真机实证**（直接影响本次选型）：

| 实证 | 对本次的意义 |
|---|---|
| 页面里发的请求**会被自己的 CDP 监听拦到**（两次投递相隔 2ms，格子键逐字符相同） | 取数若走页面，会触发一次重复写入 —— 这是选主进程取数的第三条理由 |
| 写入 200 行耗时 3ms | 扫描一轮写几百行，不构成阻塞 |
| 读端点只有一个：日历页与批量页**共用** `getRoomInventoryInfo` | 取数只需实现一个端点 |

## Goals / Non-Goals

**Goals**

- 取数不依赖标签页是否打开、是否聚焦
- 单轮扫描不与自身叠加；失败不中断循环
- 首次扫描只建基线，不给服务端灌全量
- 失效可感知（进错误监控），不静默

**Non-Goals**

- 面向用户的重新登录引导（UI 层，另开 change）
- 美团 / 抖音（携程契约已踩透，其余留后续）
- 多时间段窗口（配置形状已预留，本次仍只用 `days`）
- 扫描结果驱动的自动跟价（本次只上报事实）

## Decisions

### 1. ⚠️ 取数走 `session.fetch`，不借标签页、不新建浏览器

**这一条推翻了立项时设想的三层降级方案**（先找已开标签 → 再启隐藏浏览器 → 最后裸 HTTP）。

Electron 的 `Session` 对象由 `session.fromPartition(name)` 得到，**不依赖任何 webContents**，
且自带该 partition 的 cookie jar：

```
OtaCredential.partitionName
        ↓  SessionFactory.sessionForAccount(partitionName)     ← 已存在
   Session（该账号的 cookie jar，与标签页无关）
        ↓  session.fetch(url, { credentials: 'include' })      ← 已有先例
   Chromium 网络栈自动带上该 jar 里匹配该域的 cookie
```

官方定义：「Sends a request, **similarly to how `fetch()` works in the renderer, using
Chrome's network stack**」—— 与页面里 `withCredentials: true` 是**同一套 cookie 机制**，
只是发起方从渲染进程换成主进程。仓库已有用法：`server-client/trpc-client.ts:34`。

| 方案 | 结论 |
|---|---|
| **A `session.fetch`** | **采用**。不依赖标签页；不手拼 cookie；不被自己的 CDP 拦到 |
| B 找已开的标签页发 | 要处理「没开」「开了但焦点不在」「开了但在别的门店」；且会被自己拦到 → 重复写入 |
| C 后台常驻隐藏标签页 | 要过 `OtaTabService` 唯一开口；内存常驻；partition 生命周期；同样会被拦到 |
| D 手拼 `Cookie:` 头 | 2026-08-09 事故同类风险（结构化 JSON 整串塞进头 → 200 + 登录页 HTML → 解析炸）。**仅作降级备选** |

三条理由，第三条是 Change A 新得到的：

1. 不依赖标签页 —— 正是本能力的前提
2. 不碰 cookie 字符串 —— 避开整类事故
3. **不被自己的 CDP 监听拦到** —— 走页面的方案都会触发一次重复写入（Change A 实证）

⚠️ **两个必须真机验证的点，不可推断**：

| # | 待验 | 失败则 |
|---|---|---|
| 1 | `credentials: 'include'` 对**第三方域**是否真的带 cookie（仓库现有用法只打自家 RMS，同源） | 降级方案 D |
| 2 | 携程认不认这个请求 —— 页面里发天然带 `Referer`/`Origin`/`UA`，`session.fetch` 要自己补 | 补齐请求头后重试；仍不行则降级 B |

已知线索：携程这两个**读**接口**无签名头**（`docs/携程/调研-修改价格.md:395` 实证），
比写接口宽松。

⚠️ **标签页开/关两种状态都要验**（用户提出）：cookie jar 是否已加载、是否受页面刷新态影响，
两种状态可能不同。见 tasks 验证节。

### 2. 扫描范围：遍历凭证，不遍历绑定酒店

```
OtaCredentialRepository.listByChannel('ctrip')    ← 已存在，无需扩接口
        ↓ 每个凭证
   partitionName  → session          （取数用）
   credentialExtra.masterHotelId     （归一用，见 Change A 决策 5）
```

**不查 `ota_hotel` 表**：`getRoomInventoryInfo` 的门店上下文**完全由 cookie 决定**
（第一步请求体是 `{}`），一个凭证天然对应它当前所在的那家店。遍历绑定酒店反而要处理
「绑了但凭证已失效」「凭证当前不在这家店」两种对不上的情况。

⚠️ `masterHotelId` 取不到时**跳过该账号**（与 Change A 决策 5 同口径：宁可少一轮，
不写脏基线）。

### 3. 调度：fixed-delay 自我重排

```
setInterval  ├─5min─┼─5min─┼─5min─┤   ❌ 上轮没跑完就叠加，并发打同一账号
自我重排     ├─run──┤ 5min ├─run──┤   ✅ 采用
                    ▲ 上一轮完全结束后才计时
```

```ts
async function loop() {
  if (disposed) return;
  try { await runOneScan(); }              // 本轮全部账号扫完
  catch (error) { logger.warn(...); }      // 失败不中断循环
  finally { if (!disposed) timer = setTimeout(loop, idleMs); }
}
```

顺带**不需要 `inFlight` 去重** —— `add-ctrip-inventory-prob` 决策 8 需要它，正是因为那份
用了 `setInterval`。dispose 只需 `clearTimeout` + 置位。

⚠️ **首轮延迟一个间隔再跑**，不在启动时立刻扫：启动期要跑迁移、登录、凭证发现，
不与它们抢。

### 4. ⚠️ 「空闲才扫」：本期只做最小判据

立项设想是「应用空闲 1 分钟才刷」。本期只实现**一条**：

```
距上次用户写操作 < N 分钟 → 跳过本轮
```

理由：用户正在改价时扫描，取到的可能是改了一半的中间态，且与回读抢同一批数据。
其余判据（事件循环延迟、有无 in-flight 回读）**不做** —— 主进程本来就闲，
而 in-flight 回读的窗口只有几百毫秒，跳过一整轮的代价大于收益。

「上次写操作时刻」由既有改价监听提供（窄回调注入），不新增状态来源。

### 5. 比对与上报

```
❸ 取完整批（await，数秒）
        ↓
   ❷ 读基线 + diff + 写入  ← ⚠️ 这三步之间不得 await（spec 要求）
        ↓ changed（added 只写不报）
   ❹ 上报
```

**`added` 只写不报**是硬规则（Change A 的 `snapshot-diff` 已实现并单测）：基线天然稀疏，
把「没读过」当成「渠道新增了」会在首次扫描时把整个窗口灌给服务端。

**上报体**照回读的形状，只换 `trigger`：

```json
{
  "trigger": { "kind": "scheduledScan", "scanId": "…", "scannedAt": "…" },
  "probedAt": "…",
  "truncated": false,
  "cells": [ /* 只含有差异的格子 */ ]
}
```

| 字段 | 取值 |
|---|---|
| `changeType` | **沿用 `inventoryReadback`** —— 服务端按 `(source, endpointId)` 分派，`changeType` 只进日志 |
| `endpointId` | 新值 `inventoryScan`，让服务端单独分派 Translator |
| 旧值 | **不带**（已定） |

⚠️ 复用 `AmountChangeReportService.report(observed, partitionName)` —— 它已做齐补身份、
归一 `masterHotelId`、重试 1 次，无一行新逻辑。

### 6. 失效处置：判据复用，出口走 GlitchTip

携程失效**不保证**返回错误码（四形态：body code / 200+登录页 HTML / 授权失败体 / 401），
判据已在 `ctrip/inventory-readback.ts`，**抽出复用，不重写一套**。

⚠️ **403 ≠ 401**：403 是身份认了但没权限，重登解决不了，归成失效会掩盖真因。

| 处置 | 做法 |
|---|---|
| 本轮该账号 | 跳过：不写基线、不上报变更 |
| 记录 | `logger.warn` + `reportError`（GlitchTip，既有 `ErrorReporter` 已注入） |
| 其余账号 | 照常扫描 —— 一个账号失效不影响别人 |
| 用户可见的重登引导 | **不在本次**（UI 层，另开 change） |

GlitchTip 这条现成，不必等新 change 就有「不用问业户要日志就知道谁失效了」。

### 7. 窗口对齐 15 天（Change A 遗留 11.2）

自然读实测一次返 **15 天**（携程页面自己的范围），而 `window.days` 默认 7 —— 8~15 天的
基线永远不会被比对，只占库。

**改默认值为 15**：携程反正一次就返这么多，扫描按 15 天取，请求次数一样、覆盖面翻倍。

⚠️ 只改默认值，不动 `window` 的联合形状（多时间段仍是将来加分支）。

### 8. 装配

```
app-scope      InventoryScanDispatcher        ← 跨窗口，生命周期长于任何窗口
                 ├─ listCredentials    窄回调 → OtaCredentialRepository
                 ├─ sessionFor         窄回调 → SessionFactory.sessionForAccount
                 ├─ readBaseline/write 窄回调 → repository / SnapshotWriteQueue
                 ├─ report             窄回调 → AmountChangeReportService
                 └─ lastWriteAt        窄回调 → 改价监听（决策 4 的空闲判据）
```

⚠️ `channels/` 禁 import `database/` `services/` `inventory-snapshot/`（后者是 Change A
新加的禁令），全部走 composition 注入的窄回调 —— 与既有 `report` / `notify` 同一手法。

⚠️ 调度器建在 **app-scope**：窗口关闭不该停掉对账。window-scope 只在需要时接投递方。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **`session.fetch` 对第三方域不带 cookie** —— 整个方案的前提 | 决策 1 的待验 1，**第一个任务就验**；失败降级手拼 `Cookie:` 头（`readInjectableCookies` 已存在） |
| 携程拒绝主进程发起的请求（缺 `Referer`/`UA`） | 待验 2；补齐请求头；仍不行降级方案 B（借标签页），接受「只在开页时扫」并回写 spec |
| 周期性外部请求触发渠道风控 | 读接口本就是页面高频调用的同一批；间隔可配置；**默认只在开发环境启用**，观察后再定（参考 `2d8794f` 同类处理） |
| 扫描与用户操作抢同一批数据，误报 | 决策 4 的空闲判据 + 决策 5 的「取完再比」 |
| 定时器泄漏导致退出后仍在扫 | dispose 置位 + `clearTimeout`；in-flight 结果丢弃 |
| 首轮把全窗口当变更灌给服务端 | `added` 只写不报（Change A 已实现并单测） |

## Migration Plan

纯新增。基线表与队列已在 Change A 交付，本次不改表结构。

| 阶段 | 内容 | 回滚 |
|---|---|---|
| 1 | ⚠️ **`session.fetch` 连通性验证**（阻塞后续） | 无代码 |
| 2 | 取数层 + 失效判据抽取复用 | 纯新增文件 |
| 3 | 调度器 + 比对接线 | 不注册即不扫 |
| 4 | 上报接线 | 摘掉 report 回调即只写基线不上报 |
| 5 | 真机验证（含标签页开/关两种状态） | 同上 |

**开关**：默认**只在开发环境启用**，避免未验证的周期性外部请求进正式包。

## Open Questions

- **`idleMs` 与「距上次写操作」阈值的最终默认值** —— 待真机观察取数耗时与渠道响应稳定性。
  不影响 spec 与任务拆分（两者都要求可配置）。
- **一轮扫多少账号并发** —— 本期串行（账号数量级是个位数，串行足够且不会撞风控）。
  若真机发现串行一轮过长再议。
