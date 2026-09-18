## Context

动机见 `proposal.md`。本节只记影响方案形状的既有事实 —— 全部已核实，不是推断。

### 踩点来源

| 文件 | 内容 |
|---|---|
| `docs/踩点/携程/日历页面-房量.md` | 日历页 6 份写 curl + 1 份读 curl |
| `docs/踩点/携程/房态房量页面-房量.md` | 批量页 6 份写 curl（**无响应体**） |
| `docs/踩点/携程/房态房量菜单.md` | 批量页开/关房 2 份，**含响应体** |
| `docs/踩点/携程/日历菜单-价量态修改踩点.md` | 含 `weekDayIndex` 真子集样本与跨门店样本 |

### 监听链路已完备 —— 本次不重建

`AmountChangeWatcher` + `AmountSaveCapture` 是渠道无关的 CDP 请求/响应配对机制，已处理好 debugger 争用、pending 超时、SPA 重复导航。携程 adapter 已监听 5 个端点，**房量相关的两个都在其中**：

```
/ebkovsroom/inventory/calendar            → setbatchroombookablestatus      （日历页）
/rateplan/batchSetRoomStatusAndQuantity   → batchUpdateRoomStatusAndQuantity（批量页）
```

`WATCH_PATHS` 也已含这两个页面路径。**本次只在既有观测结果上派生一条新链路，不动观测机制本身。**

### 回读接口已在生产验证

`rms-rpa-worker/rms_rpa_worker/adapters/ctrip/inventory.py` 已用**纯 cookie、无任何签名头**跑通两步读接口：

```
POST /ebkovsroom/api/inventory/getRcProductList     body {}        → 全量售卖房型
POST /ebkovsroom/api/inventory/getRoomInventoryInfo body {房型,日期} → 房态房量
```

`getRcProductList` 的 `roomInfos[]` **每项自带** `hotelID` / `payType` / `roomClass` / `rateCodeID` —— 正是 `getRoomInventoryInfo` 所需的六字段，按 `roomTypeID` 索引即可补齐。

### 写接口带一次性风控签名，读接口不带

| 端点 | 签名头 | 每次是否变 |
|---|---|---|
| 日历页写 | `phantom-token`（~1300 字符） | **每次全变** |
| 批量页写 | `spidertoken`（~1500 字符）、`w-payload-source` | **每次全变** |
| 两个读接口 | 无 | — |

写请求的签名本地无法构造，但**回读走的是另一组接口，不需要签名** —— 现有 desktop 代码中 `grep phantom-token|rmstoken|ebk-cid` 在 `channels/ctrip/` 命中 0。

## Goals / Non-Goals

**Goals**

- 从写请求**精确**还原 (房型 × 日期) —— 既不漏（服务端跟不到）也不多（服务端会多跟）
- 回读成功率优先于资源占用（用户刚操作过页面，标签页必然开着）
- 既有上报链路行为**一字不变**
- 可调参数集中可配，为将来服务端下发留位

**Non-Goals**

- 不在 desktop 解读房态语义（映射/归一化属于业务语义，由 RMS 做）
- 不保证覆盖 `applyAllDates: true` 的全部影响范围（见决策 4）
- 不改服务端

## Decisions

### 1. 触发模型：改动事件驱动，第五种

本仓已有四种触发模型，本次是第五种。**不塞进现有任何一个**：

| Dispatcher | 触发 | 为何不复用 |
|---|---|---|
| `HotelProbeDispatcher` | intent | 有「没有等待方就不探」的早退链 |
| `AmountChangeWatcher` | URL / 端点 | 它是**观测**，本次是观测的**下游** |
| `OtaReauthDispatcher` | credential-checked | 时机完全不同 |
| `InventoryPollDispatcher`（未实施） | 定时 | 定时不解决「改完立刻要知道」 |
| **`InventoryReadbackDispatcher`** | **改动事件** | ← 本次 |

装配形状照抄既有手法（窄回调绕开 eslint 分层禁令）：

```
channels/types.ts
   └── interface InventoryReadback {
         readback(report, webContents): Promise<ReadbackOutcome>
       }

channels/ctrip/inventory-readback.ts       createCtripInventoryReadback(logger)
channels/ctrip/inventory-readback-payload.ts   给 RMS 看的契约规格
channels/ctrip/room-change-targets.ts      内部纯函数：请求体 → (房型,日期)

channels/registry.ts
   ChannelAdapter += inventoryReadback?: InventoryReadback   ← 可选字段
   inventoryReadbacks(registry)                              ← 投影，照 amountChangeAdapters()

channels/inventory-readback-dispatcher.ts
   constructor({ readbacks, logger, report })   ← 窄回调，composition 注入
```

### 1.1 机制层 MUST NOT 认识任何渠道

⚠️ dispatcher 里**不得出现** `if (source === 'ctrip')` 这类判断。渠道差异全收在 port 的实现里，机制层只做三件事：按 `source` 取实现、调用、把结果递出去。

```ts
const readback = this.deps.readbacks.get(report.source);
if (!readback) return;                       // 该渠道没注册这个能力 → 不参与
const outcome = await readback.readback(report, wc);
```

没有回读能力的渠道**不注册**即可（照 `amountChangeAdapter` 可选字段的先例），机制层自然跳过 —— 接美团时写一份实现 + `registry.ts` 加一行，dispatcher 一个字都不用改。

**port 只有一个方法。** 「这次改动要不要回读」「回读哪些房型日期」「上报体怎么组」全部是渠道内部的事，MUST NOT 提升到接口上 —— 机制层既不消费 `ReadbackTargets`，也不认识端点名与 `changeType`。这与 `AmountChangeAdapter.parse(observed) → AmountParseResult | null` 是同一形状。

```ts
type ReadbackOutcome =
  | { kind: 'ok'; report: OtaAmountChangeObserved }   // 渠道直接给出上报体
  | { kind: 'skipped'; reason: string }               // 这次改动不需要回读
  | { kind: 'failed'; reason: ReadbackFailureReason };
```

⚠️ `skipped` 与 `failed` MUST 分开。「不需要读」与「读失败了」在日志里长得一样的话，排查时分不清是逻辑挡掉了还是真出错 —— 既有 watcher 在「监听被悄悄停掉」上吃过这个亏。

### 2. 在既有上报**之后**分叉，消费 `OtaAmountChangeObserved`

```
用户点保存
    │
  AmountSaveCapture（既有）  CDP 配对 + isSuccessful 判定
    │
  adapter.parse（既有）      → OtaAmountChangeObserved
    │
    ├─→ [既有，不动] report → RMS
    │
    └─→ [新增] readback(report, webContents) → report → RMS
```

**分叉点取在 `parse` 之后**，消费的是 `OtaAmountChangeObserved` 而非原始的 `AmountSaveObserved`。这样白捡三件事，都不必再写一遍：

| 既有环节已经做掉的 | 于是回读侧不需要 |
|---|---|
| `isSuccessful` 判定（capture 内） | 渠道拒绝的改动根本走不到这里 |
| `parse` 返回 `null`（房型取不到） | 空集合的硬错误判定 |
| `changeRaw` 已剔 `reqHead`/`cipher`/`head`/`holidyInfo` | **另写一套裁剪逻辑**（见决策 7） |

⚠️ 最后一条尤其重要：`rawRequest` 直接复用 `trigger.changeRaw`，**杜绝了两套裁剪逻辑各自演化、悄悄不一致**的隐患。

两条链路**互不阻塞**：回读失败不影响既有上报，既有上报失败也不阻止回读。

⚠️ **既有 `parse` 与 watcher 一字不动**。回读所需的「从请求体还原房型日期」是 `ctrip/` 目录下的**内部纯函数**，不挂在 `AmountChangeAdapter` 接口上 —— 那个接口的语义是「解读成上报体」，塞进去会污染它。

### 3. 从写请求还原 (房型 × 日期)

两个端点**零字段同名**，各走各的提取逻辑。

| | 日历页 `setbatchroombookablestatus` | 批量页 `batchUpdateRoomStatusAndQuantity` |
|---|---|---|
| 房型 | `hotelRoomInfoDtoList[].roomTypeID`（number） | `roomProductIds[]`（**string**） |
| 门店 | ✅ 同数组的 `hotelID` | ❌ 请求体里没有 |
| 日期 | `dateItemInfoDtoList[]` 区间数组 | `dates.dateRanges[]` |
| 周次 | `weekDayIndex` 位串 | `dates.weekDays[]` 英文枚举 |
| 全选日期 | 无 | `dates.applyAllDates` 布尔 |

**决策 3.1：日历页只用 `hotelRoomInfoDtoList`，忽略 `originalRoomProductIds`。**

两者在 6 份样本里值恒等，但前者**每项自带 `hotelID`**，后者是裸 ID 数组。`日历菜单-价量态修改踩点.md:165` 有一份 6 房型跨 2 门店的样本（`122247738` 3 个 + `124241180` 3 个），只有前者能区分归属。取并集反而引入无门店归属的 ID。

**决策 3.2：房型 ID 两侧同源，回读不需要任何转换。**

写侧的 `roomTypeID` / `roomProductIds` 与读接口的 `roomTypeID` 是**同一套编号**，仅类型不同（写侧批量页是字符串，读侧是数字）。已用 `1602330530` / `1569052068` / `1569052069` 三个 ID 在读接口的真实响应里交叉验证。

**决策 3.3：不存在「全选房型」通配，但仍要防空数组。**

两个页面的请求体里都**没有任何全选标记字段**，房型恒为显式数组（跨门店 6 房型样本也是逐个列举）。

但代码仍须显式处理空数组 —— 不是因为怀疑有通配，而是**空输入不该静默变成「回读整店」或「什么都不读」**。空则记 warn 并跳过，不发请求。

### 4. 日期展开：按星期过滤，**只报用户实际改的那些天**

**决策 4.1：`weekDayIndex` / `weekDays` MUST 参与展开，与日期区间取交集。**

⚠️ **不可以「宁可多读」** —— 服务端拿 `cells` 去**追价**，多报的日期会被当成需要跟的目标跟到抖音去。用户只改了 7 天里的周六周日，若整区间报 7 天，服务端就跟 7 天 —— 这不是冗余，是**擅自扩大了用户的改动范围**。

```
dateItemInfoDtoList: [{startDate:"2026-08-31", endDate:"2026-09-06"}]   7 天
weekDayIndex: "0000110"                                                  只要周五周六
        ↓ 交集
实际生效: 2026-09-04(五), 2026-09-05(六)                                 ← 只报这 2 天
```

**两套表达都已确证，不需要补踩点**：

| 页面 | 字段 | 形式 | 证据 |
|---|---|---|---|
| 日历页 | `weekDayIndex` | 7 位串，**最左 = 周一**，`'1'` 生效 | 服务端 `RawBodyReader.weekdaysFromBitString` 已上线（注释样本 `"1111001"` → `[1,2,3,4,7]`）；`日历菜单-价量态修改踩点.md:25` 佐证（`"1111001"` 与 `"0000110"` 互补成七天） |
| 批量页 | `dates.weekDays` | 英文全大写枚举 | 服务端 `weekdaysFromNames` 已上线；真子集样本见 `改价03..md` 的 `["SATURDAY"]`、`房价维护菜单踩点.md` 的 `["FRIDAY","SATURDAY"]`，均与互补的另一半成对出现（周末差异定价的形状） |

⚠️ **空数组 / 空串 = 不过滤**（等同七天全选），与服务端 `toDayOfWeek` 的 `if (weekdays.isEmpty()) return 全部` 口径一致。`改价踩点2.md:117` 有 `"weekDays":[]` 的真实样本。

⚠️ **desktop 侧的解析 MUST 与服务端 `RawBodyReader` 同口径** —— 两边对同一份报文算出不同的日期集合，会让「服务端跟的」与「desktop 报的」对不上，且失效方式是静默错跟。

**决策 4.1.1：过滤发生在拿到 `cells` 之后，不是构造请求时。**

回读接口 `getRoomInventoryInfo` 的入参只有 `startDate` / `endDate`，**不支持星期过滤**。所以：

```
① 纯函数展开 → dates = ["2026-09-05","2026-09-06"]   ← 已是交集后的具体日期
② 发请求     → startDate=min(dates)  endDate=max(dates)
③ 拿回 cells （含区间内全部 7 天）
④ 按 dates 集合过滤 cells[].effectDate → 只留 2 天    ← 过滤在这里
```

「星期」这个概念只活在 ① 的纯函数内部，出了函数就只剩具体日期列表 —— 后续环节都不必再认识 `weekDayIndex` 是什么。

**决策 4.2：`applyAllDates: true` 裁剪到配置窗口。**

该字段在 8 份样本里全是 `false`，`true` 的语义无样本。但已知用户侧事实：

> `true` 时同时修改「即日起至 2 年」的日期，且会修改是否限量、房态等**默认值**（默认值在未设置过相关数据时生效）。

这意味着影响面是「所有**未显式设置过**的日期」—— 这个集合在客户端**根本算不出来**（要知道哪些日期被设置过，本身就得先有全量快照）。

**处置：裁剪到 `appConfig.ctripInventoryReadback.windowDays`（默认 7）。**

裁剪窗口**复用同一个配置项**，不为 `applyAllDates` 单写死 7 —— 否则将来窗口调到 14 天时这条路径会莫名其妙还是 7 天。

⚠️ **裁剪后上报的数据不是完整快照**：渠道改了 2 年，我们只报了 7 天。服务端据此判断的依据是 `changeRaw.trigger.rawRequest.applyAllDates` —— 该字段**原样保留在上报体里**，服务端自行处理（用户已确认服务端会处理，desktop 不加额外标记字段）。

### 5. 回读在标签页内发起，不走主进程

| 方案 | 结论 |
|---|---|
| A 标签页内 `executeJavaScript` + `withCredentials` | **采用** |
| B 主进程 `net.fetch` + 拼 cookie 串 | 降级备选 |

选 A 的理由：

1. **场景天然成立** —— 用户刚在这个标签页上操作过，页面必然开着。这与定时轮询「用户不开页就抓不到」的处境完全不同。
2. **绕开 cookie 装配整类风险** —— `withCredentials = true` 由浏览器自己带 cookie，不需要 `readInjectableCookies` → `toCookieHeader` 这条链。2026-08-09 线上事故正是「结构化 JSON 整串塞进 `Cookie:` 头 → 携程返回 200 + 登录页 HTML → JSON 解析炸」。方案 A 让这类事故不可能发生。
3. **本仓成熟手法** —— `executeJavaScript` 发请求有 6 处先例，`meituan/poi-infos.ts` 的 `FETCH_MEITUAN_POI_INFOS_EXPRESSION` 是现成模板（XHR + `withCredentials` + 全路径 `resolve(null)` 兜底）。

⚠️ **抽象保留可替换性**：`InventoryReadback` port 只描述「给定房型日期，返回房态房量」，**执行位置是实现细节**。将来要后台执行，换一个实现即可，dispatcher 与上报侧不动。

⚠️ 回读脚本 MUST 遵循模板的兜底约定：任何异常路径都 `resolve(null)`，绝不 reject —— `executeJavaScript` 的 reject 会变成主进程的未处理拒绝。

### 6. 批量页异步写入：拦页面自己的任务轮询，**不盲等延迟**

批量页响应是 `{ taskId, resStatus:{rcode:200}, ResponseStatus:{Ack:"Success"} }`（`房态房量菜单.md:37,96` 两份实证）。

⚠️ **`rcode: 200` 只代表受理，不代表已写库。**

**2026-09-18 真机实测坐实**：把 2 个房型 3 天设成限量 19，改完立即回读拿到 `21 / 2 / 2`（改前值），页面刷新显示 19。

⚠️ 这个错误**无法靠比对值发现** —— 增减是相对操作，不知道基数，读到 21 无从判断是改前还是改后。所以不能靠「读到旧值就重试」收敛。

#### 处置：拦 `queryMainTaskInfoForDisplay`，等到 `SUCCESS` 再回读

页面保存后自己会轮询任务状态直到完成。**拦这个响应**，不自己查：

```
保存 → 响应 { taskId }        ← adapter 在 isSuccessful 时登记
         ↓
页面自己轮询 queryMainTaskInfoForDisplay
         ↓  拦到 status: SUCCESS
      发起回读
```

⚠️ **自己查这条路走不通**：该端点带 `spidertoken`（~1500 字符）与 `w-payload-source`，每次都变、本地无法构造，请求体还要 `cipher`（对 taskId 的签名）。而回读用的两个接口是纯 cookie 无签名的，两者不可混为一谈。拦页面自己的请求完全绕开签名。

⚠️ **也不能用固定延迟兜底**：实测任务耗时约 1.2 秒，但这不是常数 —— 盲等设短了照样读旧值，设长了用户可能已关页面。

#### 三个必须处理的点

**① 旁听端点要在 `isSuccessful` 之前分流**

`queryMainTaskInfoForDisplay` 的响应信封（`resStatus.rcode`）与改价新模块**同构**。不分流会落进形状自辨，被判成一次成功的改价并产出上报体。为此给 `AmountChangeAdapter` 加了 `isAuxiliaryEndpoint` / `onAuxiliaryResponse`。

**② 只认明确的 `SUCCESS`**

已证实取值只有 `CREATING` / `SUCCESS`，**失败态无样本**。判据取「只有 SUCCESS 才放行」而非「不是 CREATING 就放行」—— 后者会把未知失败态当成功，回读到没真正生效的数据。

**③ `SUCCESS` 可能先于等待到达（竞态）**

回读侧要先走完既有上报链路（实测约 400ms）才开始等，而页面轮询是并行的。没有「已完成」记录的话，先到的 `SUCCESS` 会因没人在等被丢弃，随后一路等到超时。

⚠️ 症状是**批量页永远回读不到**，而日志上只有一条超时 warn，看不出是竞态。

#### 超时放弃，不回读

等不到完成 = 不知道渠道写完没有，此时回读的值同样无法判断新旧。宁可不报，也不报一份可能是旧值的数据（服务端会照着跟错价）。上限 30 秒。

#### 日历页不受影响

同步写入（`{code:200, message:"房量设置成功。"}`），响应无 `taskId`，`takeTask` 返回 `null` 直接回读。

#### `delayMs` 配置项保留但未使用

留着不动（用户 2026-09-18 决定）。异步问题已由门控解决，这个配置项当前没有消费方。

### 7. 上报：复用既有端点，新增 changeType + endpointId

服务端 `AppChangeTranslatorRegistry` 按 `(source, endpointId)` 分派，Translator 由 Spring 注入 `List<AppChangeTranslator>` —— **加一个端点只需新增一个 `@Component`，不改任何现有代码**。`changeType` 在服务端只进日志，不参与分流。

```ts
{
  operationId,                              // ⭐ 独立，不与触发它的改价上报去重
  source: 'ctrip',
  changeType: 'inventoryReadback',          // ⭐ 新值
  endpointId: 'getRoomInventoryInfo',       // ⭐ 回读端点，非触发它的写端点
  endpointUrl: '<回读接口完整 URL>',
  otaHotelId,                               // 见决策 8
  channelAccountId, channelAccountName,
  changeRaw: {
    trigger: {
      endpointId: 'batchUpdateRoomStatusAndQuantity',  // 谁触发的
      observedAt: '<写请求被拦到的时刻>',
      rawRequest: { /* 裁剪后的写请求，见下 */ },
    },
    probedAt: '<回读完成时刻>',
    cells: [ /* 携程回读行，原样 */ ],
  },
  submitAt,
}
```

**`endpointId` 用回读端点而非写端点**：写端点已在既有上报里出现，复用会让服务端两个 Translator 抢同一个键。

**`rawRequest` 直接复用 `trigger.changeRaw`，MUST NOT 另写裁剪。**

既有 `parse` 产出的 `changeRaw` 已经是裁剪好的请求体（剔了 `reqHead` / `cipher` / `head` / `holidyInfo`，其余原样保留，含 `roomQuantityLimitType` / `remainRoomQuantityType` / `roomStatus` / `weekDayIndex` / `applyAllDates`）。

⚠️ 重写一套裁剪会引入「两套逻辑各自演化、悄悄不一致」的隐患，而且失效方式很隐蔽 —— 两条上报里的同一份请求体长得不一样，排查时无从判断哪个是对的。

**`cells` 原样透传，不映射**。与既有 `changeRaw` 同一口径：`"G"/"N"` 不转 `OPEN/CLOSED`、`"T"/"F"` 不转布尔。desktop 不解读语义。

**⚠️ 回读 MUST NOT 区分「这次改的是房态还是房量」。**

携程两个端点的 `changeType` 都是 `roomStatus`，而回读接口返回的行**本来就同时含房态与房量**。desktop 不去看请求体里动的是 `roomStatus` 还是 `remainRoomQuantityType`，**整行照报**。

这意味着房态信息会被报两次（一次在既有改动上报，一次在回读的 `cells` 里）—— 这是**刻意的**，去重与裁剪由服务端做：

| 谁 | 做什么 |
|---|---|
| desktop | 整行照报，不判断、不裁剪 |
| 服务端 | 按需取用，重复部分自行裁剪 |

让 desktop 判断「房态已经报过了所以这次只报房量」会引入一个易错的语义判断，而它的失效方式是**静默丢数据**；反过来多报一份的代价只是冗余。

⚠️ `freeSale` / `limitSale` MUST 保留：`limitSale:"F"` 时 `totalQuantity:0` **不代表没房**（FreeSale 不限量）。只看数字必然判错。原样透传自然带上。

### 8. `otaHotelId`：复用既有归一逻辑，绝不用回读返回值

携程有**三个**「酒店 id」，混用不报错、只会静默错价或集体不跟价：

| id | 典型值 | 用途 |
|---|---|---|
| `ota_account.ota_hotel_id` | `122244992` | **账号粒度，唯一身份依据** |
| 上报体顶层 `otaHotelId` | `122244992` | **与上一行同源同值** |
| 报文/接口里的 `hotelID` | `124241180` / `122247738` | 携程内部**门店 × 售卖模式**层 |

既有链路已在 `services/amount-change-report-service.ts` 用凭证的 `credentialExtra.masterHotelId` 覆盖报文值，拿不到时保留原值。

**本次直接复用同一段逻辑，不另写。** 回读响应里的 `hotelID` 只作为 cell 内的存档字段，**绝不参与匹配**。

⚠️ 写错的后果具体：`ota_hotel_id` 是 `uk_ota_sale` 第 4 列，值不对 → upsert 撞不上唯一键 → INSERT 新行 → 同一房型两行。

### 9. app-config：新建独立目录

本仓现有配置分两类，**都不适合承载运行期可调参数**：

| 类别 | 例子 | 为何不适合 |
|---|---|---|
| 构建期常量 | `__RMS_ORIGIN__` | Rollup 折叠成字面量，运行期改不了 |
| 模块内私有常量 | `PENDING_MAX_AGE_MS` 等十余处 | 改了要重新发版 |

⚠️ 不得改成运行时读 `process.env`。`staff-auth/rms-endpoint.ts` 的注释写明理由：打包产物是被双击启动的，父进程环境里没有那个变量，运行时读取会**静默兜底到 localhost，打出一个「看起来正常、却连着本机」的包**。

```
main/app-config/
  ├── types.ts              AppConfig 类型 + 每项语义注释
  ├── defaults.ts           内置默认值（唯一真值兜底）
  └── app-config-store.ts   读取 / 合并 / 订阅
```

**放 `main/` 下与 `channels`/`services` 平级**：它是跨模块基础设施。放 `services/` 下则 `channels/` 够不着（eslint 禁止），而回读恰恰活在 `channels/` —— 各层通过**注入**拿到它，与既有 `report`/`notify` 窄回调同一手法。

**取值优先级**（低 → 高）：`内置 defaults` → `服务端下发（缓存本地）` → `本地覆盖（调试）`

**本期只实现第一层**，第二三层只预留接口形状。服务端下发是完整链路（端点、缓存、失效、下发失败兜底、版本兼容），塞进本 change 会让回读本身的验证被配置链路的问题干扰。

第一批配置项：

```ts
{
  ctripInventoryReadback: {
    delayMs: 0,         // 决策 6 —— 第一期不延迟，留位；真机确认读到旧值再调
    windowDays: 7,      // 决策 4.2
    timeoutMs: 30000,   // 沿用 inventory.py 口径
  }
}
```

### 10. 失败处理与日志

**登录失效四形态**（携程失效不保证返回 HTTP 错误码）沿用 `add-ctrip-inventory-prob` design 决策 5：

| # | 形态 | 判据 |
|---|---|---|
| 1 | 200 + JSON | body `code ∈ {401, 300, -1}` |
| 2 | 200 + HTML 登录页 | 正文前 8192 字符 lowercase 含 `"islogin":false` / `htl-ebk-login-web` / `qrcodeloginswitch` 任一 |
| 3 | 200 + 授权失败体 | `{"error":"invalid_grant"}`，无 `code`、非 HTML |
| 4 | HTTP 401 | status |

⚠️ 形态 2 靠 `<title>` 和域名**判不出来** —— 登录页 title 是「携程酒店商家管理后台」这种正常文案，全文不含 `passport.ctrip.com`。

⚠️ **403 ≠ 401**：403 是身份认了但没权限，重登解决不了，归成 `COOKIE_EXPIRED` 会掩盖真因。

**`Outcome` 用 tagged union，不用空数组表失败**。Python 侧漏判形态 3 曾导致「被当成这店没数据 → 全店记录软删 → 联动房型集体不跟价」。

**回读失败不重试、不落盘**，与既有上报「失败重试 1 次后放弃」同一取舍 —— 偶发漏读是已知代价，下次用户操作会再次触发。

**日志**：句子式英文 message + 扁平对象，键名 `channel` / `triggerEndpointId` / `roomTypeCount` / `dateCount` / `cellCount` / `durationMs` / `reason` / `error: safeLogErrorDetails(error)`。

⚠️ cookie 压根不要进日志参数 —— `redactLogData` 会脱敏但**不能依赖它兜底**。

⚠️ 关键节点必须留痕，且「没触发」与「触发了但失败」的日志 MUST 可区分。既有 watcher 有过教训：「监听被悄悄停掉」与「用户没改价」在日志上长得一模一样，排查绕了几轮。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| ~~批量页异步写入会读到旧值~~ | **已解决**：拦页面自己的任务轮询，等 `SUCCESS` 再回读（决策 6）。2026-09-18 真机验证房量 18 准确读回 |
| 携程改任务状态枚举 / 改查询端点路径 | 只认明确的 `SUCCESS`，未知状态不放行；等不到就超时放弃不回读 —— 失效方向是「漏报」而非「报错值」 |
| `applyAllDates: true` 时只读 7 天，数据不完整 | `rawRequest` 里保留该字段，服务端据此处理（用户已确认） |
| 批量页无门店标识 | 回读第一步 `getRcProductList` body 是 `{}`，门店由 cookie 决定，不需要门店入参 |
| **星期过滤算错 → 服务端多跟或漏跟** | 与服务端 `RawBodyReader` 同口径实现；两套表达均有真子集样本入单测（决策 4.1） |
| 服务端未认领新 `endpointId` | 报文落 `raw_body` + `UNKNOWN_ENDPOINT`，数据不丢；desktop 可先上 |
| 回读请求打在携程上触发风控 | 与用户手工操作同频（一次改动一次回读），远低于定时轮询 |

## Open Questions

- ~~`delayMs` 是否需要大于 0~~ —— 已由决策 6 的任务门控解决，该配置项保留但当前无消费方（用户 2026-09-18 决定不动它）。
- 任务状态的**失败态**取值未知（只见过 `CREATING` / `SUCCESS`）。当前按「非 SUCCESS 一律继续等」处理，真出现失败态时表现为超时放弃 —— 安全但会多等 30 秒。拿到样本后可提前识别。
- 日历页是否存在「增加 / 减少」入口：5 份样本全是 `remainingRoomType:"Set"`（绝对赋值），`Set` 这个枚举名暗示可能有 Add/Reduce 但未踩到。**不影响方案** —— 回读拿的是事实，相对还是绝对都一样处理。
