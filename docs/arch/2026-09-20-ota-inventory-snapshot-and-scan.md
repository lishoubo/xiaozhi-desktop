# OTA 价量态快照与定时扫描（大纲）

**状态**：大纲。拆成 A / B 两个 change，细节待逐项讨论后写各自的 `design.md`。

---

## 1. 背景

既有链路是**被动监听**：用户在我们 app 里操作渠道后台 → CDP 旁听写请求 → 上报 RMS
（`changeType: price / roomStatus`）；携程与美团另有**回读**，改完主动读回渠道真实状态
（`changeType: inventoryReadback`），解决「相对操作算不出绝对值」。

这套链路的前提是**变更必然经过我们**。以下两类场景不成立，因此漏报：

| # | 场景 | 为什么监听抓不到 |
|---|---|---|
| 1 | 用户在其他浏览器 / 手机 / 渠道 App 里改 | 请求根本没经过我们的 CDP |
| 2 | 无人操作，渠道自行变更（订满自动关房、活动到期、渠道侧批量调整） | 不存在任何写请求 |

结论：**必须有一条主动、周期性的对账链路**，不依赖用户行为。

### 与 `add-ctrip-inventory-prob` 的关系

那个 change **未落地，建议归档**。它的两条核心决策已被后来上线的回读链路推翻：

| prob design 决策 | 现实 |
|---|---|
| 决策 1：主进程 `net.fetch` + 自拼 `Cookie:` 头 | 回读走**页面内 XHR + `withCredentials`**；理由见 `ctrip/inventory-readback-fetcher.ts` 文件头（2026-08-09 cookie 拼串事故） |
| 决策 7：新建 `InventoryProbe` + `InventoryPollDispatcher` | `InventoryReadback` 已封装「取数 + 裁剪 + 组上报体」，扫描的取数与之高度重叠 |

仍然有效、且已沉淀进代码的部分：携程两步请求契约、`"G"/"N"/"Y"` 房态映射、
`limitSale:"F"` 时房量 0 不代表没房 —— 现在都在 `ctrip/inventory-readback-payload.ts`。

---

## 2. 目标形态

```
                       ┌──────────────────────────────┐
  用户在页面翻日历 ────→│                              │
  （自然读，CDP 旁听）  │                              │
                       │   ota_inventory_snapshot     │
  回读成功 ──────────→ │   (SQLite，价量态基线快照)    │
  （已有链路，写库）    │                              │
                       └──────────────┬───────────────┘
                                      │ 比对
  定时拉取最新 ───────────────────────┤
  （每 3~5 分钟）                     ▼
                              差异 cells → 上报 RMS
                              （endpointId: inventoryScan）
```

三条写入路径共用一张表，diff 只发生在定时扫描这一条上。

---

## 3. 拆分

### Change A：快照存储与写入链路

**不含定时、不含上报。** 交付后可独立验证：手动操作 → 查库 → 数据对不对。

| 范畴 | 内容 |
|---|---|
| 存储 | `ota_inventory_snapshot` 表 + migration(v9) + repository |
| 写入路径 1 | 回读成功后写库（改 `InventoryReadbackDispatcher` 或其下游） |
| 写入路径 2 | CDP 旁听页面**自然读**端点 → 写库（机制照 `amount-save-capture.ts`，拦读不拦写） |
| 渠道范围 | 待定（见 §5 待决 2） |

### Change B：定时扫描与差异上报

依赖 A。

| 范畴 | 内容 |
|---|---|
| 取数 | **无标签页时如何取数**——本方案最大的不确定性，见 §5 待决 1 |
| 调度 | 自建定时器（全仓无可复用调度器）；`inFlight` 去重；dispose 取消 |
| diff | 按唯一键逐格比对；裁剪与 hash 策略见 §4.3 |
| 上报 | 新 `endpointId: inventoryScan`；**不带旧值**（已定） |
| 配置 | 间隔、窗口天数，落 `app-config`（已有该层） |

---

## 4. 已定的设计点

### 4.1 存裁剪后的原始 cell，不做语义转换

与既有两份 payload 文件同一原则：desktop 忠实透传、不解读语义。逐字段建模等于在客户端
复刻渠道的房态语义，渠道加字段就静默丢弃。

代价：diff 时必须有一层裁剪/白名单，否则渠道返回的无关字段（内部时间戳、字段顺序）会被
算成差异。**这是「不解读语义」唯一必须让步的地方**，让步到什么程度待 §5 讨论。

### 4.2 复用回读的上报模型

服务端按 `(source, endpointId)` 分派 Translator，`changeType` 只进日志、不参与分流。
所以：

- `changeType` **沿用 `inventoryReadback`**，不新增值 —— 扫描报的同样是「渠道实际是什么」
- `endpointId` 用新值（`inventoryScan` 或类似），让服务端单独分派
- `changeRaw` 外层结构与回读同构，只换 `trigger`：

```json
{
  "trigger": { "kind": "scheduledScan", "scanId": "…", "scannedAt": "…" },
  "probedAt": "…",
  "truncated": false,
  "cells": [ /* 只含有差异的格子 */ ]
}
```

**不带 `previous` 旧值**（已定）。

### 4.3 表结构方向（字段待细化）

```
ota_inventory_snapshot
  source                 ctrip / meituan
  ota_hotel_id           ⚠️ 携程必须是归一后的 masterHotelId
                            不可用 cells[].hotelID（预付/现付两个 ID）
  ota_physical_room_id   美团 roomId
  ota_sale_room_id       携程 roomTypeID
  item_type              price / roomStatus（美团可能要三类）
  item_date              2026-10-20
  item_data              裁剪后的原始 cell JSON
  content_hash           diff 比这个，不比 JSON 字符串
  observed_at / updated_at / source_of_truth（readback / page-read / scan）
```

唯一键方向：`(source, ota_hotel_id, ota_sale_room_id, ota_physical_room_id, item_type, item_date)`

### 4.4 首次扫描不上报，只建基线

自然读只覆盖用户实际翻到的天数与房型，不是全窗口。所以第一轮扫描时库里大部分格子是空的。

**规则：库里无基线的格子只写库、不上报。** 否则首次扫描会给服务端灌一遍全量。

### 4.5 日期窗口第一版只做 `windowDays`

区间 list（`[1.1-1.2, 3.1-3.10]`）留到后续。配置类型设计成可扩展的联合形状，后加不动结构。
理由：跨年、相对/绝对日期、区间合并去重是独立的一块，不影响架构验证。

---

## 5. 待决事项（按优先级）

### 待决 1 ⚠️ 无标签页时如何取数 —— 决定 Change B 能否成立

回读能工作是因为它跟在用户操作后面，那一刻标签页必然开着。定时扫描没有这个前提。

| 方案 | 代价 |
|---|---|
| A 主进程 `net.fetch` + 自拼 cookie | 2026-08-09 事故同类风险；美团签名头（`mtgsig` 等）能否在主进程复现**未踩点** |
| B 后台常驻隐藏 tab | 要过 `OtaTabService` 唯一开口；内存；partition 生命周期 |
| C 只在标签页开着时扫 | 与需求动机直接冲突（场景 1、2 恰恰是用户不在 app 里的时候），基本不成立 |

倾向 B，待确认。美团签名头能否主进程复现需要单独踩一次点 —— 可在 Change A 期间并行进行，
不阻塞 A。

### 待决 2 第一期渠道范围

只携程，还是携程 + 美团。携程契约已踩透（`inventory-readback-payload.ts`）；美团扫描取数
（无 trigger、全房型全日期）与回读形状差别更大，且与待决 1 的签名头问题耦合。

### ~~待决 3 `item_type` 是否要拆~~ —— 已定（2026-09-20）：拆两类

**`item_type ∈ { roomStatus, price }`，房态与房量不再细分。**

真实读模型实证（美团 fixture `tests/fixtures/meituan/query-room-status-info.json`）：

```
roomStatusMap["2026-09-19"] = {
  date, containerId, shareType,
  roomStatus, limitType, remainCount, limitRemain, usedCount, invSwitch
}                                    ← 房态与房量同在一行，无任何价格字段
```

| 渠道 | 房态 + 房量 | 房价 |
|---|---|---|
| 携程 | `roomStatusResult[]` 一行含两者 | `roomPriceResult` 独立路径，**可能不覆盖全部 cell**（关房日无价） |
| 美团 | `roomStatusMap[date]` 一行含两者 | 完全另一个端点，且挂 `goodsList`（售卖房型）而非 `roomId`（物理房型） |

**拆两类而非三类**：房态与房量在两个渠道的读模型里都在同一行，拆开等于把一行 cell 劈成
两行存、diff 时再拼回来。与 `OtaChangeType` 里 `roomStatus` 不拆同一理由（那条注释：
「一个端点可能在一次请求里同时改房态和房量，拆了就必然有说不准的情况」）。

**拆的真正理由是 ID 空间不同**，不只是「不同接口」：

```
携程 roomStatus   sale=roomTypeID   physical=NULL
携程 price        sale=roomTypeID   physical=NULL
美团 roomStatus   sale=NULL         physical=roomId
美团 price        sale=goodsId      physical=NULL(或 roomId，待踩点)
```

⚠️ **约束（已定）：`ota_sale_room_id` 与 `ota_physical_room_id` 不允许同时为 NULL。**
至少一列有值，否则该行无法定位房型。落库前校验，违反即拒绝写入并告警 —— 不静默落一行
定位不了的脏数据。

⚠️ 遗留：SQLite 的 `UNIQUE` 约束里 `NULL != NULL`，可空列参与唯一键会让同一格重复插入。
需统一成空串或用生成列做键 —— 属存储细节，见 §7 线程与存储模型。

### ~~待决 4 携程 `payType` 维度会撞键~~ —— 已否决（2026-09-20）

**不需要 `payType` 维度。** 提出时把两件事混为一谈了：

| | 随预付/现付而变 | 结论 |
|---|---|---|
| `cells[].hotelID` | ✅ 是（同店两个 ID） | 这是 payload 文件警告要用 `masterHotelId` 归一的那件事 |
| `roomTypeID` | ❌ 否 | 售卖房型身份本身，与付款方式正交 |

代码实证（`ctrip/inventory-readback.ts`）：

- `seen` 集合按 **`roomTypeID` 单独去重**（:158），`payType` 不参与
- `payType` 只作为 `getRoomInventoryInfo` 的请求字段透传，不用于区分行
- `pickRoomRefs` 注释：`roomPPInfos`/`roomFGInfos` 是「同批数据按支付方式的切片，**读了会重复**」

即预付/现付是同一批房型的两个视图，不是两行独立数据。唯一键不加这一维。

### 待决 5 ⚠️ 回读结果写库的时机与路径

「靠监听读端点顺便把回读也抓到」不可靠 —— 回读是我们自己在页面里发的 XHR，**CDP 能否拦到
自己发出的请求未验证**。

倾向：回读成功后**直接写库**，不绕监听这一圈。需要确认写在哪一层
（dispatcher？service？repository 由谁注入）—— 涉及 eslint 分层禁令（`channels/` 够不着
`database/`）。

### 待决 6 diff 的裁剪粒度

见 4.1。白名单字段 vs 存前裁剪 vs hash 时排除已知噪音字段。需要真实样本支撑。

---

## 7. 模块与线程模型（Change A 的地基）

### 7.1 模块划分

```
┌─ 事件驱动（被动，用户触发才有数据）──────────────────────┐
│                                                          │
│   回读完成 ────┐                                         │
│   自然读拦截 ──┼──→ ❶ 写入队列 ───┐                      │
│   （用户自己翻页面）  投递即返回   │                      │
└───────────────────────────────────┼──────────────────────┘
                                    ▼
                              ❷ 对比和存储  ←── 两条链路的交汇点
                                    ▲    │
┌─ 定时驱动（主动）─────────────────┼────┼──────────────────┐
│                                   │    │                  │
│   定时任务 ──→ ❸ 获取数据 ────────┘    ▼ 差异             │
│   （串起三个模块）                  ❹ push 上报           │
└───────────────────────────────────────────────────────────┘
```

⚠️ **❷ 是两条链路共用的同一个模块**。区别只在事件驱动那条不产生差异 —— 它在**建立基线**，
不是在对账。这一点决定了 ❷ 的接口必须同时服务两种调用。

| | 模块 | 职责 | 能否搬出 main |
|---|---|---|---|
| ❶ | 写入队列 | 投递即返回，隔离写失败 | **接缝本身** |
| ❷ | 对比和存储 | 读基线 + 比对 + upsert | ✅ 能 |
| ❸ | 获取数据 | 向渠道取当前价量态 | ❌ **不能** |
| ❹ | push | 差异上报 RMS | ✅ 能 |
| | 定时任务 | 串起 ❸→❷→❹ + 调度 | 调度留 main |

### 7.2 ⚠️ 只有 ❸ 搬不走，原因是 Electron 约束不是设计选择

```
❸ 必须 executeJavaScript(webContents)   ← Electron 对象只存在于主进程
❷ 进出都是纯数据（cells 进，差异出）    ← 可序列化，能搬
❹ 只需要 JWT 字符串 + 一个 HTTP 请求    ← 能搬
```

❹ 走的是**普通 HTTP + Bearer JWT**（`POST /api/v1/app/ota-changes`），不是 cookie、
也不依赖任何 Electron 对象。`rms-amount-change-gateway-http.ts` 文件头写明「这里没有一行
token 相关代码」，注入与刷新都在注入的 `fetch` 那层。

所以将来真要开线程，边界只能是：

```
┌─ main ─────────────┐      ┌─ worker ──────────────────┐
│  ❸ 获取数据         │ ──→  │  ❷ 对比存储 → ❹ push       │
│  （Electron 绑定）  │      │  （纯数据进，自己发 HTTP） │
└────────────────────┘      └───────────────────────────┘
```

❷ 与 ❹ 连着，差异算完直接推，中间不必回 main。

⚠️ 若真搬，token 的读取与刷新仍在 main（`staff-auth` 的 tokenStore），worker 侧要么每次
接收 token 快照，要么把刷新也搬过去 —— 这是搬线程的真实成本之一，不可忽略。

### 7.3 现在的事实：全部在 main 线程，且这不构成问题

**全仓 `grep worker_threads` 命中 0。** 现状：

```
┌─ 主进程（Node 事件循环，单线程）─────────────────────────┐
│  CDP 拦截回调 │ 回读 await 之后 │ 定时器 tick │ SQLite    │
│  ⚠️ 同一事件循环排队，永不并行                            │
└──────────────────────────────────────────────────────────┘
        ↕ IPC（跨进程）
┌─ 渲染进程（每窗口一个，独立进程）────────────────────────┐
│  Svelte UI 渲染、页面 JS、我们注入的 XHR                  │
└──────────────────────────────────────────────────────────┘
```

**「UI 会被拖慢」这个担心在这个架构下不成立**：UI 在**另一个进程**里。主进程抛异常、
写库失败，渲染进程照常画。

**「每几分钟读一次数据」几乎不产生主线程负担**，因为这件事的时间构成是：

```
一轮扫描 = 发请求等渠道响应  +  写库比对
           ├─ 2~30 秒        ├─ 毫秒级（待实测）
           └─ await 网络     └─ 同步 CPU
              ❌ 完全不占线程   ⚠️ 唯一占线程的部分
```

`await` 网络期间事件循环**一条指令都不执行**，等 30 秒与等 30 毫秒对主线程的占用同样是零。

⚠️ **真正该盯的是解析不是写库**：全量扫描的响应远大于回读，几 MB 的 `JSON.parse` 是同步
不可中断的，可达数百毫秒 —— 比写库严重一个数量级。而这段开销发生在 Electron 跨进程回传
时，**搬 worker 也躲不掉**。

### 7.4 结论：先不开线程，但把接缝留出来

| | |
|---|---|
| **现在** | ❶❷❸❹ 全在 main；❷ 同步 drain |
| **接缝** | ❶ 投递方只 `push`，不 await、不关心谁消费；❷ 进出纯数据 |
| **将来** | 实测确认瓶颈后，换 ❷ 的消费者实现即可，投递方一行不改 |

不现在开的理由：代价是实打实的（结构化克隆、双连接 `SQLITE_BUSY`、跨线程调试、全仓第一个
worker 无先例），收益待实测。

⚠️ **实测方案（写进 Change A 验证项）**：写库耗时打进日志（行数 + 耗时 + 事务内外），
真机跑一段时间后拉日志分析，用数据决定要不要搬 —— 不靠估算。

### 7.5 队列（❶）：投递即返回

```
回读完成 ─┐
自然读   ─┼──→ [ 待写队列 ] ──→ 单一消费者串行 drain ──→ SQLite
定时取数 ─┘        ▲                      │
              投递即返回            失败：吞掉 + 记日志，不回传
```

拿到三件事：拦截侧零阻塞、写失败被隔离（拦截链路根本不知道写失败了，更不会因此中断监听）、
写入天然串行。

⚠️ **命名不要叫「写线程」**，叫 `SnapshotWriteQueue` —— 否则下一个人会以为真有并发去加锁。

⚠️ 队列要按格子键 `(source, hotelId, roomId, itemType, date)` **去重合并**，同一格只保留
最新一份：既防渠道返回膨胀吃光内存，又顺带起合并写的作用。

### 7.6 调度（定时任务）：fixed-delay 自我重排

按「跑完歇 N 分钟再开下一轮，实际间隔会大于 N」的语义 —— 即 **fixed-delay**：

```
setInterval  ├─5min─┼─5min─┼─5min─┤   ❌ 上轮没跑完就叠加，并发打同一账号
自我重排     ├─run──┤ 5min ├─run──┤ 5min ├─run─   ✅ 采用
                    ▲ 上一轮完全结束后才开始计时
```

```ts
async function loop() {
  if (disposed) return;
  try { await runOneScan(); }              // 本轮全部账号扫完
  catch (e) { log(e); }                    // 失败不中断循环
  finally { if (!disposed) timer = setTimeout(loop, idleMs); }
}
```

顺带**不需要 `inFlight` 去重** —— `add-ctrip-inventory-prob` 决策 8 需要它，正是因为那份
用了 `setInterval`。dispose 只需 `clearTimeout` + 置位。

⚠️ **「空闲才刷」的判据待定**。候选：距上次用户写操作 > N 分钟（最贴近意图：用户正在改价时
不打扰）、无 in-flight 回读（必要条件）。倾向两者组合，阈值待定。

### 7.7 一致性：不追求严格一致，取完整批再一次性比对

**已定：不做严格一致性设计**，拦住大部分即可。落到实现上只需一条约束：

```
✅  ❸ 取完整批 → ❷（读基线 + 比对 + 写入，一个同步段内完成）→ ❹ 推
❌  ❸ 取一个房型 → ❷ 比一个 → ❸ 取下一个 …
```

一次性完成天然把「回读插队导致基线过期」的窗口压到最小，**不需要额外的版本号、时间戳护栏
或锁**。而边取边比会把窗口拉长到整轮扫描时长（几十秒），那才会把用户自己的改动误报成
外部变更。

这条约束同时是 ❷ 可搬 worker 的前提：一次吃一批、吐一批，才是个可搬走的模块。

### 7.8 ⚠️ `ota_hotel_id` 必须取凭证里的登录酒店，不取接口返回值

**已定。** 与既有上报链路同一规则，代码里已有实现：

```
resolveOtaHotelId()                       // services/amount-change-report-service.ts:130
  credentialExtra.masterHotelId   ← 取这个（登录酒店）
        ↓ 覆盖
  observed.otaHotelId             ← 报文/接口返回的，丢弃
```

携程同一家酒店的**预付与现付是两个不同的 hotelID**，接口返回的是本次操作那一侧。
回读 payload 文件因此主动留空串，注释写着「⛔ 绝不能拿回读响应里的 `hotelID` 填 ——
那是「门店 × 售卖模式」层」。

**踩过的坑**：`ota_hotel_id` 值不对 → upsert 撞不上唯一键 → INSERT 新行 → 同一房型两行。

⚠️ **归一不能在写入点做**：两条事件路径都在 `channels/`，被 eslint 禁止 import
`database/`，拿不到凭证。

| 方案 | 说明 |
|---|---|
| **A. composition 注入的回调补齐** | 投递方给 `partitionName`，回调查凭证补 `masterHotelId`。与既有 `report(observed, partitionName)` 同一手法 —— **倾向这个，不发明新机制** |
| B. ❷ 自己查 | ❷ 在 app-scope 够得着 repository，但多一个依赖 |

⚠️ **`masterHotelId` 取不到时：拒绝写入 + warn**，不照既有上报那样退回报文原值。
理由：存进错的 `ota_hotel_id` 会**永久污染基线**，且下次归一正确时会变成「另一家酒店」，
diff 直接失效。宁可少一格基线，不留脏数据。

### 7.9 多渠道多酒店扩展性

**已确认满足**：

- 表里**无任何渠道枚举约束、无渠道特化列** —— `source` 就是 TEXT，加渠道不动表结构
- 多酒店靠 `ota_hotel_id` 进唯一键天然支持，一个账号绑多店无碍
- 唯一的渠道差异是两个房型 ID 列的填法（携程用 `sale`、美团用 `physical`），
  新渠道只要满足「不得同时为 NULL」即可接入

### 7.10 存储细节（待细化）

**唯一键的 NULL 问题**（承 待决 3）：SQLite 的 `UNIQUE` 里 `NULL != NULL`，可空列参与
唯一键会让同一格反复 INSERT 新行。

| 方案 | 说明 |
|---|---|
| 空值归一成 `''` | 简单；但「无此维度」与「空字符串」语义被抹平 |
| 生成列做键 | `COALESCE(sale,'') \|\| ':' \|\| COALESCE(physical,'')` 建 UNIQUE INDEX |

**其他待定**：

- 写入分批让出：消费者每 drain 一批（如 200 行）后 `setImmediate` 让出 —— 单线程下
  「异步写」唯一有意义的形式是**分片让出**，不是包 Promise（better-sqlite3 同步 API，
  包 Promise 只推迟到下一 tick，阻塞时长一分不少）
- 一批写入包进一个 `database.transaction()`（压成一次 fsync）；⚠️ 事务内**不得出现
  `await`**，better-sqlite3 事务是同步的，跨事件循环边界行为未定义
- 保留策略 —— 窗口滚动后旧日期的行谁删、何时删（否则无限增长）
- `content_hash` 算法与参与字段（承 待决 6）
- migration v9；**倾向不加外键** —— 快照是渠道事实，不依赖本地绑定关系，加外键会让
  未绑定账号的数据落不了库

### 7.11 装配位置与分层

```
app-scope      database 单例
               SqliteOtaInventorySnapshotRepository（与既有三个同级）
               SnapshotWriteQueue（单一消费者，跨窗口共享）
    │
    │ 注入窄回调（channels/ 被 eslint 禁止 import database/）
    ▼
window-scope   InventoryReadbackDispatcher 旁边加 persist 窄回调 → 投递队列
               ReadCapture（新，自然读拦截的机制层）           → 投递队列
```

⚠️ 注入的回调签名是**「投递」而非「写入」**，天然不返回写入结果 —— 与 7.5 的隔离目标一致。

⚠️ **队列与 repository 建在 app-scope**：快照跨窗口共享，定时扫描（Change B）的生命周期
长于单个窗口。window-scope dispose 时只摘掉投递方，队列本身不停。

### 7.12 ⚠️ 待决 5 有了实证方向：CDP 能拦到自己注入的 XHR

`amount-save-capture.ts` 走 `Network.requestWillBeSent`，这是渲染进程**网络栈层面**的事件，
不区分请求由页面脚本还是 `executeJavaScript` 发起 —— 回读的 XHR 跑在页面上下文里，
**大概率会被自己的监听拦到**。

在队列去重模型下这不再是正确性问题，但仍是**浪费**：同一份数据投递两次。倾向自然读监听
**显式排除回读自己发的请求**（回读 XHR 加标记头，监听侧见到就跳过）。需真机验证。

## 8. 包结构

### 8.1 放置判据：依赖方向决定位置

| 模块 | 依赖 | 只能放 |
|---|---|---|
| ❸ 获取数据 | `webContents`、渠道接口契约 | `channels/<渠道>/` |
| ❷ 对比和存储 | SQLite | `database/` + `inventory-snapshot/` |
| ❶ 写入队列 | 无（纯数据结构） | `inventory-snapshot/` |
| ❹ push | gateway + 凭证归一 | `services/`（复用既有） |
| 定时任务 | 串 ❸❷❹ | `channels/`（渠道无关调度层） |

### 8.2 目录

```
main/
├── channels/
│   ├── types.ts                        ← 加 InventoryScan 接口（照 InventoryReadback）
│   ├── inventory-scan-dispatcher.ts    ← 定时任务（第六种触发模型）
│   ├── inventory-read-capture.ts       ← 自然读拦截机制层（照 amount-save-capture.ts）
│   ├── ctrip/
│   │   ├── inventory-scan.ts           ← ❸ 携程取数
│   │   └── inventory-snapshot-cells.ts ← 从响应抽 cells（回读与自然读**共用**）
│   └── meituan/  （同形，第二期）
│
├── inventory-snapshot/                 ← 新目录：快照特性自身（渠道无关）
│   ├── snapshot-write-queue.ts         ← ❶ 队列（纯数据，无依赖）
│   ├── snapshot-diff.ts                ← ❷ 比对（纯函数，好单测）
│   └── types.ts                        ← SnapshotCell / SnapshotKey 等跨层契约
│
├── database/
│   └── ota-inventory-snapshot-repository.ts   ← ❷ 的存储半边（与既有三个同级）
│
└── services/
    └── （复用 amount-change-report-service）   ← ❹，无新增
```

### 8.3 四个判断的理由

**❶❷ 单开 `inventory-snapshot/`，不塞进 `channels/`**
`channels/` 被 eslint 禁止 import `database/`，队列与 diff 要跟存储协作，放进去就够不着。
且两者**渠道无关**（纯数据结构与比对逻辑），放渠道目录下是误导。先例：`calendar/`、
`error-reporting/` 都是与 `channels`/`services` 平级的跨层特性目录。

**repository 仍放 `database/`，不放 `inventory-snapshot/`**
既有 repository 多数在 `database/`，app-scope 也从那儿 import。`calendar/calendar-repository.ts`
是个不一致的先例，但**新增跟多数派走**，不扩大不一致。

**❹ 复用既有上报服务，不新建**
`AmountChangeReportService.report(observed, partitionName)` 已做齐全部所需：补
`operationId`/`submitAt`/身份、**归一 `masterHotelId`**（§7.8 正需要）、重试 1 次。
差异上报只是换 `endpointId`，无一行新逻辑。

**`inventory-snapshot-cells.ts` 放渠道目录**
从响应抽 cells 是**渠道语义**（携程读 `roomStatusResult`、美团读 `roomStatusMap`）。
回读与自然读拿到的是同一端点的响应，抽取逻辑**必须共用**，否则两条路径抽出的 cells 会漂。

### 8.4 ⚠️ eslint 要补一条

现有 `channels/` 禁令里**没有** `inventory-snapshot/`。按分层规范（boundary 必须 lint 强制，
不能只写注释），要加：

```
channels/ ─❌→ inventory-snapshot/      （同 database/，走 composition 注入窄回调）
```

否则 `channels/` 里的取数模块会直接 import 队列，绕过注入，把分层吃掉。

---

## 9. 配置（app-config）

### 9.1 现有机制已够用的部分

| 已有 | 说明 |
|---|---|
| **每次调用读一次** | `config: () => appConfig().ctripInventoryReadback`（`registry.ts`）。注释写明：构造时取一次会让服务端下发失效。**照抄即可** |
| **三层优先级链** | 内置默认值 → 服务端下发（留空）→ 本地覆盖（留空）。接下发只需 composition 多传一个 source |
| **`mergeConfig` 按 key 遍历** | 加配置组不用改它（美团那次因逐组手写被类型检查抓住） |

### 9.2 ⚠️ 不够的一处：现有形状是「两层扁平」，撑不住分渠道分酒店

`mergeConfig` 注释明写「只深一层 —— 不做通用递归」。而目标形态需要：

```
分渠道   ctrip / meituan          ← 现靠组名硬编码（ctripXxx / meituanXxx）
分酒店   hotelId 为键的第三层      ← ❌ 深一层合并撑不住
多时间段 ranges: [...]             ← 数组，合并语义未定义
房型信息 roomTypeIds: [...]        ← 同上
```

两个具体问题：

1. **分酒店需要第三层**。`{ ctrip: { byHotel: { "122247738": {…} } } }` 这种形状，深一层
   合并会把整个 `byHotel` **整体替换** —— 下发只想改一家店，会把其他店的配置全抹掉。
2. **数组合并语义未定义**。`{...base, ...patch}` 对数组是整体替换。多时间段与房型列表
   **正该是整体替换**（不该 concat 两个时间段列表），但必须**明确写下来**，否则后来者
   会当 bug 改成 concat。

### 9.3 现在只做三件小事，不做实现

| # | 内容 | 成本 |
|---|---|---|
| 1 | 配置组按渠道**嵌套命名**，不用 `ctripXxx` 扁平前缀 | 只是起名 |
| 2 | 类型里预留 `byHotel?:` 位置 + 注释写明「暂不实现，合并语义见下」 | 一行可选字段 |
| 3 | `mergeConfig` 注释里写死**数组 = 整体替换**的约定 | 零 |

```ts
type InventoryScanConfig = Readonly<{
  /** 扫描间隔（跑完歇多久，fixed-delay 语义，见 §7.6）。 */
  idleMs: number;

  /**
   * 日期窗口。第一期只有 days；多时间段是**加一个分支**，不改字段。
   * 带 kind 的联合让消费方的 switch 被类型系统强制处理新分支，不会静默漏掉。
   */
  window: { kind: 'days'; days: number };
  //      将来：| { kind: 'ranges'; ranges: readonly { start: string; end: string }[] }

  timeoutMs: number;

  /**
   * ⚠️ 预留，第一期不实现。按酒店覆盖上面的值。
   * 合并语义：以 hotelId 为键**逐店深合并**，不是整体替换 —— 需要扩展 mergeConfig
   * 的深度，届时一并做。
   */
  byHotel?: Readonly<Record<string, Partial<Omit<InventoryScanConfig, 'byHotel'>>>>;
}>;
```

⚠️ **房型信息刻意不预留字段**。还不知道是白名单、黑名单还是优先级排序 —— 预留一个猜错的
形状比不预留更糟，后来者会照着它实现。等需求清楚再加，加字段本就不用改结构。

### 9.4 谁持有 config 引用

```
❸ 获取数据   config: () => appConfig().inventoryScan    ← 窗口、超时
定时任务     config: () => appConfig().inventoryScan    ← idleMs、空闲判据
❷ 对比存储   ❌ 不收                                     ← 纯比对，无策略
❶ 队列       ❌ 不收                                     ← 纯数据结构
```

⚠️ **别让 ❶❷ 收 config**。它们没有配置相关的决策，收了只会让后来者往里塞策略，
把纯模块污染成有状态的。

## 10. 讨论顺序

先 Change A，逐项讨论：

1. ~~**模型细化**~~ —— 待决 3（拆两类）、待决 4（否决 payType）已定；
   §4.3 表结构字段仍需逐列敲定
2. ~~**线程模型**~~ —— 见 §7。**只有一个主进程线程，UI 在另一个进程**；拦截/回读/定时
   全在主进程事件循环上。采用「投递队列 + 单一消费者」做隔离（§7.1），调度用
   fixed-delay 自我重排（§7.3）
3. ~~**包结构**~~ —— 见 §8。新目录 `inventory-snapshot/`；eslint 补一条禁令
4. ~~**配置**~~ —— 见 §9。预留 `byHotel` 与 `window` 联合；房型信息刻意不预留
5. **流程** ← 下一项 —— 三条写入路径的触发点与去重；「空闲」判据与阈值（§7.6）；
   §7.12 真机验证方案；§7.10 存储细节逐项敲定

然后再进 Change B。
