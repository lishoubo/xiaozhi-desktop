# 美团房量回读 —— 设计

踩点材料：`docs/踩点/美团/房价房量日历-房量.md`、`docs/踩点/美团/批量改房态房量.md`、
`docs/踩点/美团/批量改房量房态-房量.md`

对标实现：`channels/ctrip/inventory-readback*.ts`、`channels/ctrip/room-change-targets.ts`

---

## 1. 触发与边界

### 决策 1.1 只认 `inventory-update` 一个端点

美团 `amountChangeAdapter` 管五个端点。回读只对 `INVENTORY_ENDPOINT_ID`（`inventory-update`）
生效，其余一律 `{ kind: 'skipped' }`：

| 端点 | 回读？ | 理由 |
|---|---|---|
| `inventory-update` | ✅ | 房量相对操作，本 change 的目标 |
| `inventory-status-switch` | ❌ | 纯房态，无房量语义 |
| `roomstatus/submitaudit`（关房） | ❌ | 同上 |
| `calcPriceV2` / `updatePriceV2` | ❌ | 改价链路，`calcPriceV2` 已提供改后价 |

⚠️ `inventory-update` 一次请求里**房态与房量并存**（`invSwitch` + `countType`）。
纯房态操作（`countType: 1020`，见 `批量改房态房量.md`）也会触发回读 —— **这是刻意的**，
不按 `countType` 分流：回读读回的是整行状态，房态操作时读回来的房量正是「没变」的事实，
对服务端同样有效。按 `countType` 猜「这次改的是不是房量」会引入一个易错判断，
而它的失效方式是**静默漏报**。

### 决策 1.2 同步写入，不做门控、不做延迟

携程批量页写接口是异步的（`rcode:200` 只代表受理，实测立刻回读拿到改前值），
解法是 `batch-task-gate.ts` 拦页面对 `queryMainTaskInfoForDisplay` 的轮询。

**美团是同步的**（用户确认）。且美团页面在保存后**不发任何任务轮询请求**
（`批量改房量房态-房量.md` 结尾记录：「批量修改之后，没有触发主动读取」），
即使想做门控也无对象可拦。

因此：
- **不实现** `batch-task-gate` 的对等物
- **不设** `delayMs` 配置项 —— 携程那个是「留位，真机确认读到旧值再调」，
  美团既然同步就不该留一个永远为 0 的旋钮

✅ **2026-09-18 真机实证，前提成立**：写请求 `countType:1620, limitChangeValue:1`
（纯相对操作，报文里没有任何地方出现 19），回读拿到 `limitRemain: 19`，全程 109ms。

⚠️ 将来若发现读到旧值，那是这个前提被推翻，应回到本节重新设计门控，
**不是**加一个固定延迟绕过去。

---

## 2. 从写请求还原 (房型 × 日期)

入参是既有 `parse` 产出的 `changeRaw`（美团量态路径是**原样透传请求体**，无裁剪），
与携程同一理由：`isSuccessful` 已判过、房型取不到时 `parse` 已返回 `null`。

### 报文结构（三层数组，比携程深）

```json
{
  "poiId": "1834077877",
  "partnerId": 4824962,
  "modifyInventoryModelList": [            // ← 数组①：每个元素一组房型
    {
      "modifyInventorySubjectsModel": {
        "dayRoomIdList": [493882496],      // ← 日租房型（要）
        "hourRoomIdList": [],              // ← 钟点房（不要，见决策 2.3）
        "goodsIdList": []
      },
      "unifiedOperateInvDateModel": {
        "modifyDates": [                   // ← 数组②：多日期段，闭区间
          {"startDate":"2026-09-09","endDate":"2026-10-08"},
          {"startDate":"2026-08-27","endDate":"2026-08-28"}
        ],
        "modifyParamByEffectWeeks": [      // ← 数组③：每档一组星期 + 一组参数
          {"effectWeek":[1,2,3,4,7], "updateInventoryUnifyInvUnitParam":{"invSwitch":1,...}},
          {"effectWeek":[5,6],       "updateInventoryUnifyInvUnitParam":{"invSwitch":0,...}}
        ]
      }
    }
  ]
}
```

### 决策 2.1 全部房型共用同一组日期，逐 model 汇总即可

产品交互是**先选房型，再选日期** —— 日期对本次改动的所有房型共用。

`modifyInventoryModelList` 虽是数组，但各元素的 `unifiedOperateInvDateModel`
**逐字相同**，只有 `dayRoomIdList` 不同。`批量改房态房量.md` 的 3 房型样本实证：
三个元素的 `modifyDates`（`09-09~10-08` + `08-27~08-28`）与
`modifyParamByEffectWeeks`（`[1,2,3,4,7]` + `[5,6]`）完全一致，日期被复制了三遍。

所以还原逻辑就是最朴素的那个：**汇总所有 model 的房型，取日期（任一 model 的即可，
实现上遍历全部并集更省事），产出一组 (房型集, 日期集)**。不需要按 model 分别配对。

⚠️ 不要为「万一各 model 日期不同」加保护性分支：那个情况在产品上不存在，
多写一个分支就多一个判错的机会，且它的分支永远走不到、测不出。

### 决策 2.2 `effectWeek` 取所有档的**并集**

`modifyParamByEffectWeeks` 是数组，各档可以配不同星期 + 不同参数
（样本：`[1,2,3,4,7]` 开房、`[5,6]` 关房）。

回读只关心「读哪些天」，不关心各档改成什么，所以取并集。上例并集 = 全部七天 = 两个日期段全展开。

### 决策 2.3 ⚠️ `effectWeek` 是 ISO，1 = 周一 —— **这是核实的，不是猜的**

证据链（三条独立佐证）：

1. **服务端已在生产按 ISO 消费**：`AppOtaChangeIngestService.toDayOfWeek()` 用
   `DayOfWeek.of(v)`，Java 的 `java.time.DayOfWeek` 定义即 1=MONDAY。
   `RawBodyReader.weekdaysFromInts()` 只做 1-7 范围校验，**不做任何基准转换**，原样传下去。
2. **业务语义自洽**：`批量改房态房量.md` 的关房样本把 `[5,6]` 单列出来配 `invSwitch:0`（关房），
   按 ISO 即周五周六 —— 正是酒店业的 weekend 口径，与携程 `"0000110"` = 周五周六同解。
3. **desktop 侧必须与服务端同口径**：两边算出不同日期集合会让「服务端跟的」与「desktop 报的」
   对不上，且失效是**静默错跟**。

⚠️ **不可**拿改价链路的「美团 ISO 星期」结论直接套 —— 那是另一个字段。本条的依据是上面三条。

### ⚠️ 决策 2.3a 「不过滤」与「形状不符」必须分开（2026-09-18 code-review 修正）

| 输入 | 结果 |
|---|---|
| 字段缺失 / `[]` | **不过滤**（等同全选），与服务端 `List.of()` + `if (!isEmpty())` 一致 |
| `[5,6]` | 按该集合过滤 |
| 非数组 / `[0]` / `[8]` / `["x"]` / `[1.5]` | **整次放弃回读**（`extractMeituanReadbackTargets` 返回 `null`） |

初版把「全部元素非法」也当成不过滤，造成一个**不对称**：`[5,99]` 只丢坏元素、过滤照做
（1 天），而 `[0]` 反而整个区间全展开（7 天）。后者是**多读** —— 服务端拿 `cells` 去追价
会把用户没碰过的日期跟到别的渠道，正是 §2 开头「既不能漏也不能多」要防的事，且失效
**静默**（日志只有 `dateCount`，看不出该不该是这个数）。

⚠️ 也**不能**改成「非法就当空集、过滤掉所有天」 —— 那会变成静默**漏报**。

⛔ 初版注释声称「与服务端 `weekdaysFromInts` 三段式一致」是**错的**：只有 null/空数组
那一种一致。服务端对非法取值一律 `throw malformed`（javadoc 明写「越界视为报文形状不符，
不静默丢弃」），即**服务端 fail-closed、desktop fail-open，方向相反**。而这组合比单侧错
更糟：上报 A 会被服务端拒掉，上报 B（回读）却带着放大了的日期集合被照单全收。

> 教训同 `feedback_verify_mechanism_claims_in_comments`：注释里「与 X 一致」这类
> 等价性断言不会被测试证伪，必须回 X 的代码逐条核。

### 决策 2.4 只取 `dayRoomIdList`，钟点房不回读

与服务端 `MeituanInventoryUpdateTranslator` 同口径（类注释：「`hourRoomIdList`（钟点房）
**不处理**：本链路只跟日历房」）。

某个 model 只有 `hourRoomIdList` 时，该 model **跳过**（不是整次 skip）——
服务端同样是 `continue`。所有 model 都跳过则整次 `skipped`。

### 决策 2.5 空集合显式挡掉

房型或日期为空 → 不回读，**不得退化为「回读全部房型」**，也不得发空请求让它静默成功。
照携程 `finish()` 的写法。

⚠️ 判据必须覆盖空值本身：`if (ids.length && dates.length)` 这类写法让空值绕过判据、
最终发出空报文而平台回 200 —— 护栏自己成了哑弹。

---

## 3. 回读请求

### 端点

```
POST https://me.meituan.com/api/gw/v1/product/goods/queryRoomStatusInfo
{"roomIds":[493879575],"startDate":"2026-09-18","endDate":"2026-09-21",
 "poiId":"1834077877","partnerId":4824962}
```

### 决策 3.1 `poiId` / `partnerId` 从**触发报文**取，不从凭证取

两者在写请求体顶层都有，而 `changeRaw` 是原样透传的 —— 同源同值，天然一致。

⚠️ **不要**从 `credentialExtra.partnerId` 取：`gateway/rms/types.ts:56` 明确记载
「美团**门店级** `partnerId` ≠ desktop `credentialExtra.partnerId`（账号级），那是另一个值」。
从触发报文取直接绕开这个歧义。

### 决策 3.2 日期区间按 min~max 发，**拿回来再按目标集合筛**

与携程完全同理：接口只认 `startDate`/`endDate` 区间，**不支持星期过滤**。

⚠️ 这一步最容易写漏且单测可能全绿。漏了等于「多读」，而服务端拿 `cells` 去**追价** ——
多报的日期会被跟到抖音，那不是冗余，是**擅自扩大用户的改动范围**。

### 决策 3.3 在页面内发，不在主进程

照携程 `inventory-readback-fetcher.ts`，XHR + `withCredentials`，浏览器自带 cookie。
所有异常路径 `resolve(null)`，绝不 reject。

美团的 fetcher **可复用携程那份的结构**，但失效判据不同（见决策 4），
因此新写一份 `meituan/inventory-readback-fetcher.ts` 而非跨渠道抽象 ——
两个渠道各自的失效形态是**渠道自己的事**，提取公共 fetcher 会把判据挤到调用方。

---

## 4. 响应判读

```json
{"code": 10000, "error": null, "traceId": "...", "success": true,
 "data": [{"roomBaseInfo": {"roomId":493882496,"roomName":"云享三人间",
                            "roomCategory":1,"containerId":372062584},
           "roomStatusMap": {"2026-09-19": {"date":"2026-09-19","roomStatus":1,
                                            "limitType":1,"remainCount":1,
                                            "limitRemain":5,"usedCount":0,
                                            "invSwitch":1,"containerId":372062584,
                                            "shareType":1}}}]}
```

### 决策 4.1 ⚠️ 成功码是 `10000`，不是 200 也不是 0

与携程（200）、抖音（`BaseResp.StatusCode === 0`）都不同。判据按端点钉死，不做形状自辨。
辅以 `success === true`。

### 决策 4.2 ⚠️⚠️ 同一个 `roomId` 返回**两条**，必须按 `roomCategory === 1` 过滤

这是回读响应里最容易漏的一点，踩点文档未明说，从样本比对得出：

| roomId | roomName | roomCategory | containerId | limitType | limitRemain |
|---|---|---|---|---|---|
| 493879575 | 云憩大床房 | **1** 日租 | 372062583 | 1 | 1 |
| 493879575 | 云憩大床房 | **2** 钟点 | 392353398 | 2 | 999 |

实证：`房价房量日历-房量.md` 的「钟点房设置房量」样本用
`"dayRoomIdList":[], "hourRoomIdList":[493879575]` —— **roomId 与日租那条完全相同**，
证实同一 id 兼具两副身份，房量各自独立。

不过滤的后果：同一房型同一天报出两行互相矛盾的数据（一行限量 1、一行不限 999），
服务端拿去追价即灾难。

`roomCategory` 缺失时 **丢弃该行**（不是保留）—— 与决策 2.5 同一原则：
宁可漏读也不能把钟点房数据混进日历房，后者会真实影响下发。

### 决策 4.3 `roomStatusMap` 是**以日期为 key 的对象**，不是数组

携程 `roomStatusResult` 是扁平数组（房型数 × 天数），美团是嵌套 map。
展平时把 `roomId` / `roomName` / `roomCategory` 并进每个 cell，让 `cells` 保持扁平
—— 与携程上报体形状一致，服务端两边可以同构处理。

### 决策 4.4 房量字段**整行透传，不解读**

一格里有 `remainCount` / `limitRemain` / `usedCount` / `limitType` / `invSwitch` / `shareType`。

✅ **2026-09-18 真机实证：`limitRemain` 就是用户设的那个值**（三组，覆盖相对与绝对
两种写路径）：

| 用户操作 | 写请求 | 回读 `limitRemain` |
|---|---|---|
| 房量 +1（结果 19） | `countType:1620` 相对 | **19** |
| 周末 19 / 平时 17 | `countType:1520` 两档 | 周五 **19**、周四 **17** |
| 2 房型各设 18 | `countType:1520` | **18 / 18** |

同格 `remainCount` 为 1~2、`usedCount` 为 0，显然是不同语义（推测 `remainCount`=物理剩余、
`usedCount`=已售，**未实证**）。

⚠️ 三组都是「无预留房、`usedCount:0`、`limitType:1`」的干净场景，**有已售或有预留房时
三字段如何分配尚无样本**。

`limitType:2`（不限量）时 `limitRemain` 是 998/999 这类**哨兵值**，不是真实房量。

⛔ **即便已实证，本 change 仍不得出现「取 `limitRemain` 当房量」这类代码** —— 结论只写
进给服务端的文档，客户端一旦开始解读语义，美团改字段时就会静默错报。

### 决策 4.5 登录失效判据 —— **必须回真实响应取特征，不得猜**

携程的四形态（HTML 登录页标记、`invalid_grant`、`code ∈ {401,300,-1}`）是**携程的**，
不可套用。美团的失效形态**当前无样本**。

本 change 的处置：
- HTTP 401 → `COOKIE_EXPIRED`；HTTP 403 → `FORBIDDEN`（两者必须分开：403 是身份认了但没权限，
  重登解决不了，归成 `COOKIE_EXPIRED` 会触发一轮无意义的重新登录）
- `code !== 10000` → `PARSE_ERROR`（**不猜**哪个 code 代表失效）

### ⚠️ 「200 + 登录页 HTML」这一形态**刻意不做**，也不打算补

携程有这条判据，是因为它继承自 `rms-rpa-worker` —— 那是**后台无人值守**跑的，cookie 放
几天不用，失效是常态，所以需要精细区分。

desktop 这条路的语境完全不同：回读发生在**用户刚操作成功的那个标签页**里，上一秒才保存
成功（`isSuccessful` 已判过）、下一秒登录失效的场景基本不存在。

而且即使发生了也无事可做 —— 回读**不重试、不落盘**，判成 `COOKIE_EXPIRED` 还是
`PARSE_ERROR` 对行为没有任何影响，只是日志上一个词的差别。

为一个几乎不发生、且发生了也不改变行为的分支，去猜美团登录页的特征，收益为负：猜错会
恒假、单测全绿、线上照样落 `PARSE_ERROR`，还在代码里留下一段「看起来已处理」的假象。

> fetcher 仍把非 JSON 的原始文本回传（而非吞成 null）。将来真有需要，补一个分支即可，
> 不用改结构。

---

## 5. 上报体

```json
{
  "source": "meituan",
  "changeType": "inventoryReadback",
  "endpointId": "queryRoomStatusInfo",
  "endpointUrl": "https://me.meituan.com/api/gw/v1/product/goods/queryRoomStatusInfo",
  "otaHotelId": "",
  "changeRaw": {
    "trigger": {"endpointId": "inventory-update", "observedAt": "...", "rawRequest": {...}},
    "probedAt": "...",
    "truncated": false,
    "cells": [{"roomId":493882496,"roomName":"云享三人间","roomCategory":1,
               "date":"2026-09-19","roomStatus":1,"limitType":1,
               "remainCount":1,"limitRemain":5,"usedCount":0,"invSwitch":1,...}]
  }
}
```

### 决策 5.1 `endpointId` 用**回读端点**，不用触发它的写端点

`queryRoomStatusInfo`。用 `inventory-update` 会撞上既有
`MeituanInventoryUpdateTranslator`（它 `supports("MEITUAN", "inventory-update")`），
回读体会被按写报文的形状解析。

### 决策 5.2 `truncated` 恒 `false`

美团**没有**「应用到所有日期」选项。字段保留是为了与携程上报体同构，
服务端可以一套逻辑处理两个渠道。

### 决策 5.3 `otaHotelId` 留空串

service 层用凭证的 `masterHotelId` 覆盖（与既有改动上报同一段逻辑）。
`operationId` / `submitAt` 同样由 service 层补，于是两条上报天然拿到各自独立的 `operationId`
—— **不可互相去重**，是两个不同的事实。

---

## 6. 不做的事

| | 理由 |
|---|---|
| `batch-task-gate` 对等物 | 决策 1.2，美团同步 |
| 按 model 分别配对日期 | 决策 2.1，所有房型共用同一组日期 |
| `delayMs` / `windowDays` 配置 | 同上 + 无「应用到所有日期」 |
| 跨渠道抽象 fetcher | 决策 3.3，失效判据是渠道自己的事 |
| 解读房量语义 | 决策 4.4，交服务端 |
| 改服务端 | proposal Non-Goals 第 1 条 |
| `countType` 解码 | 回读不需要（只看房型+日期）；编码表记在 payload 规格供服务端参考 |

---

## 7. 多账号 / 多标签页并存时的 cookie 一致性

**结论：安全。** 回读必然使用「发生改动的那个标签页」自己的 cookie，不存在串台。

### 隔离链路（逐层核实）

```
BrowserManager.createTab()
  new WebContentsView({ webPreferences: { session: tabSession } })   ← ① 每 tab 一份 session
       ↓
AmountChangeWatcher.onNavigated(event)
  new AmountSaveCapture(event.webContents, …)                        ← ② 闭包捕获该 tab 的 wc
       ↓ 用户保存，capture 回调
  onReportedForReadback(report, event.webContents, event.partitionName)  ← ③ 原样传出
       ↓
InventoryReadbackDispatcher.onReported(report, webContents, …)
       ↓
readback(report, webContents) → webContents.executeJavaScript(xhr…)  ← ④ 在该 wc 里执行
```

关键在 ①：partition 命名是 `persist:xiaozhi:<env>:<channel>:<shortId>`，**shortId 在
创建登录标签页那一刻随机生成**（见 `browser/partition.ts`）—— 即「每次登录一份」，
天然是账号粒度。A 标签与 B 标签是两份互不可见的 cookie 存储。

关键在 ④：`executeJavaScript` 在哪个 `WebContentsView` 里执行，XHR 就带哪份 session 的
cookie。回读**不在主进程自行装配 cookie 串**，所以不存在「拿错账号的 cookie」这种可能 ——
这也是当初选择页面内发请求而非主进程 HTTP 的原因之一。

### ⚠️ 这个性质此前没有测试守着

链路本身正确，但正确性只靠「webContents 一路原样传递」这个隐式约定。任何一处改成
「取当前活动标签页」或「取第一个匹配渠道的标签页」都会串台，而失效方式是**静默的**：
把 A 酒店的房量报成 B 酒店的，服务端照着改另一家店的价。

已补固化测试 `amount-change-watcher.test.ts`「两个标签页各自的 partition 与 webContents
不串」，断言两条链路各自带对自己的 `webContents` 与 `partitionName`，并显式断言
**不得**出现交叉组合。

反向验证：把回读的 wc 固定成第一个、把上报的 partition 固定成第一个，两种串台方式各自
让该用例变红。

### 不受影响的两件事

- **`otaHotelId` 的归一**：上报体里留空串，由 service 层按 `partitionName` 查凭证的
  `masterHotelId` 填 —— partition 既然是账号粒度，这一步也不会错配。
- **回读请求体的 `poiId` / `partnerId`**：取自**触发报文**（决策 3.1），与这次改动同源，
  不依赖「当前是哪个账号」的外部状态。
