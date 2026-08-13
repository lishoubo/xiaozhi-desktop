# 美团改价捕获 —— 现状、缺口与下一步

> **状态**：2026-08-12，**§3（试算上下文）与 §4（createFlag 过滤）均已实装**，单测覆盖，
> 全量 463 用例通过。**剩余的只有真机验证**，见 §6。落地时与本文的两处偏差记在 §5.1。
>
> 上一版（2026-08-11 晚）按新踩点重写，否掉了更早的「按 goodsId 缓存计算结果」方案，见 §3。
>
> 相关文档：
> - 上报体数据规格：`openspec/changes/ota-amount-change-watch/meituan-payload-spec.md`
> - 踩点原始材料：`docs/踩点/美团/改价踩点.md`、`改价踩点03.md`、`改价踩点2.md`
> - 任务清单：`openspec/changes/ota-amount-change-watch/tasks.md` T9

---

## 1. 今天完成了什么

| 项 | 状态 |
|---|---|
| 美团适配器（`channels/meituan/amount-change-adapter.ts`） | ✅ 已实装，12 个单测 |
| 注册表接入 | ✅ |
| 真机端到端 | ✅ 拦到 10+ 次改价，`poiId`/`goodsId` 解析全对 |
| `operateType` 六种取值 | ✅ 全部实测确认（规格文档 §5.2） |
| 日志被截断 / `debugger is busy` 谎报已启动 | ✅ 均已修 |
| 上报体规格文档 | ✅ 已成文 |

桌面全量 **73 文件 446 用例通过**，`lint` / `check:types` 通过。

---

## 2. 新踩点结清的三个悬案

先把昨晚列为"待确认"的几项定掉，因为它们直接决定 §3 的方案选型。

### 2.1 ✅ 块6 的「1000 倍」不是量纲问题，是用户输错了

昨晚怀疑 `priceInfos` 与 `realPriceInfos` 量纲不一致。算一遍就清楚了：

```
originalPriceInfo.salePrice = "24013"     → 240.13 元
priceInfo.salePrice         = "24011300"  → 240113 元
                                             240113 × 100 = 24011300  ✓
```

用户在「直接设置」框里把 `240.13` 输成了 `240113`。**×100 的规则在两个字段里都成立、
没有例外。** 这条从"未实测清单"里划掉。

顺带确认：**块 5、6 里 `priceInfos` 与 `realPriceInfos` 的 `priceInfo` 逐字段完全相同**，
两者不存在量纲差异，差别只在 `inWeek` 的粒度（见 2.2）和 `originalPriceInfo.baseAddRatio`。

### 2.2 ⚠️ `unifiedDatePriceInfos` 与 `realPriceInfos` 的 `inWeek` 粒度**不一样**

这是新踩点里最容易踩坑的一点，昨晚的"只取 realPriceInfos"建议因此**要反过来**。

同一个响应（`改价踩点2.md` 那次请求，日期区间 08-25~08-26）：

```
请求  calcPriceWeekModels.inWeek : [1,2,3,4,7]        ← 用户选的周次档
响应  unifiedDatePriceInfos       : [1,2,3,4,7] / [5,6]   ← 与请求同粒度
响应  realPriceInfos              : [2,3]                 ← 只有日期区间内**真实存在**的那几天
```

08-25 是周二、08-26 是周三，所以 `realPriceInfos` 给的是 `[2,3]`。块3（区间拉到 08-28）
则被拆成 `[2,3] / [4] / [5]` 三档 —— 因为区间内周四、周五的**原价本来就不同**。

| | `unifiedDatePriceInfos` / `priceInfos` | `realPriceInfos` |
|---|---|---|
| `inWeek` 粒度 | **与请求的周次档一一对应** | 按区间内实际日期 + 原价差异**再拆分** |
| 覆盖没有日期落入的周次档 | ✅ 会出现，`priceInfo: null` | ❌ 不出现 |
| 与 `updatePriceV2` 请求体对齐 | ✅ 直接对得上 | ❌ 对不上，要自己映射 |

**结论**：要把计算结果与提交请求体的 `(goodsId, inWeek 档)` 对齐，用
`unifiedDatePriceInfos` / `priceInfos` **更省事**；`realPriceInfos` 虽然七次全都有，但它
的分档是服务端按原价重算过的，直接拼回请求体会错位。

⚠️ 昨晚写的"建议只取 `realPriceInfos`，少一个分支少一类 bug"**是错的**，按那个做会把
`[2,3]` 的价格安到 `[1,2,3,4,7]` 这一档上。

### 2.3 ✅ 三段式确认；文档里 calc 与 update 周次档对不上，是**截取不全**而非真实不一致

`改价踩点03.md` 记了同一次改价的三段。对比 ① 与 ②③：

| | `weekDiff` | `calcPriceWeekModels.inWeek` |
|---|---|---|
| ① `calcPriceV2` | `true` | `[1,2,3,4,7]` |
| ②③ `updatePriceV2` | `false` | `[1,2,3,4,5,6,7]` |

看上去像「用户算完价后关掉了周末差异定价，导致 calc 与提交条件不一致」。**但这个读法是
错的** —— 关掉开关本身就会触发一次重算，只是那条 calc 没被截进文档（这份文档是三段式的
**示意**，不是完整流水）。

⚠️ 教训：把「踩点文档里没有」当成了「没有发生」。基于此得出的「calc 与 update 不保证
一致」的结论一度否掉了缓存方案（见 §3.1），实际上缓存方案是成立的。

---

## 3. 问题一：相对操作算不出最终价 —— prob 缓存最后一次计算

### 问题回顾

请求体只说「卖价 +2 元」，不说「原来多少钱」。除 `operateType: 6`（直接设置）外，
RMS 都算不出改后价格（规格文档 §6）。

### ✅ 方案：prob 维护一个覆盖式变量，提交时取最新

```
进入改价页            → AmountChangeWatcher.attach()，建 AmountSaveCapture（prob）
calcPriceV2           → 覆盖 prob 里的 lastCalc（请求体 + 响应体）
calcPriceV2（又一次） → 再覆盖
updatePriceV2         → createFlag: true 时上报，带上 lastCalc
离开页面 / 关 tab     → detach()，lastCalc 随实例丢弃
```

**为什么「取最新」就是对的** —— 因为**页面上任何影响价格的条件变更都会触发重算**，实测：

| 变更 | 证据 |
|---|---|
| 改数值 | block0→block1：`+1 元` → `+2 元` |
| 勾选房型 | block1→block2：房型数 1 → 2 |
| 改日期区间 | block2→block3：08-26 → 08-28，`[5,6]` 档从 `null` 变出价 |
| 开关周末差异定价 | 同理会重算（`weekDiff` 是计算入参） |

所以最新那条 calc 天然与提交体同条件，**不需要比对，不需要 TTL，不需要按 goodsId 分桶**
—— 每条 calc 请求本来就带着当前页面上**全量**的 `goodsList`（block2 那次同时含两个房型），
不存在「A 的结果被 B 覆盖」。

> 一次踩点会话里连续 7 条 calc 的演进见 §2 的分析脚本输出。用户从 `+2` 又改回 `+1`
> （block3→block4）这种反复，最新那条自然就是最终意图，无需额外规则。

### 3.1 曾考虑但否掉的方案

| 方案 | 为什么否掉 |
|---|---|
| 按 `goodsId` 缓存 + 逐字段比对 calc 与 update 是否等价 | 等于在 desktop 里复刻美团的定价语义，违背「忠实透传、不解读」；而条件变更必然重算，这个比对本就多余 |
| calc 全量逐条旁路上报，由 RMS 按内容全等配对 | 一次改价发十几条，产生大量永远配不上的中间态记录，还要处理孤儿记录的保留期。用一个页面级变量就能解决的事 |

> 上面第二条曾是 2026-08-11 的主方案，其论证建立在「calc 与 update 可能不同条件」上
> （引 `改价踩点03.md` 里 calc `weekDiff: true` / update `false`）。**该论证不成立** ——
> 那只是三段式示意文档没截全中间那次重算，把「文档里没有」当成了「没有发生」。

### 3.2 实现落点

状态放 **prob（`AmountSaveCapture`）**，不放适配器：

```
AmountChangeWatcher              分发器：订阅 tab:navigated，按渠道选适配器
  └─ Map<tabId, AmountSaveCapture>
       └─ AmountSaveCapture      prob，每 tab 一个，页面级生命周期
            │  pending    Map<requestId, PendingSave>   已有，配对请求/响应
            │  lastCalc   JsonObject | null             新增，覆盖式
            └─ AmountChangeAdapter   渠道适配器，保持纯函数
```

- prob **本来就是有状态的**（`pending` 已在维护），生命周期也正好是页面级：`detach()` 里
  `pending.clear()`，加一行 `lastCalc = null` 即可。**不用另造 sessionId/tabId**，实例本身
  就代表「这一次页面会话」。
- 适配器保持无状态，只多声明一句「`calcPriceV2` 是配对素材，不是保存事件」。三渠道共用
  一套机制，让 prob 持有状态比给每个适配器加状态更顺（且 eslint 禁止适配器反向依赖）。
- 取不到 `lastCalc` 时**照常上报**，价格字段留空 + 记 warn。理论上不该发生（不可能不触发
  计算），留兜底是为了让它一旦发生能在日志里看见，而不是静默少数据。

### 3.3 裁剪规则 —— 只剔两个，都是高置信度的

一次 calc 原样约 2.2KB（两房型 6.5KB）。现在每次改价只带**一条** calc，量级已经不敏感，
但仍剔掉两项**已证明没有信息价值**的。实测各字段占用（单房型）：

| 字段 | chars | 处置 | 理由 |
|---|---|---|---|
| `goodsBaseInfo` | 826 | **收成 `{ goodsId }`** | 26 个字段全是房型静态属性，已逐一核对；且 `updatePriceV2` 的上报体里带着完整一份，不会丢失 |
| `realPriceInfos` | 450 | **整个丢掉** | 分档与请求体对不上（§2.2），留着只会诱导 RMS 取错 —— 是**有害**字段，不只是冗余 |
| `unifiedDatePriceInfos` / `priceInfos` | 474 | ✅ 保留 | 核心：改后价 + 原价，且周次档与请求一一对应 |
| `calcPriceUnifiedDateModel` / `calcPriceModels` | 321 | ✅ 保留 | 算这个价时的条件（日期区间 + 周次档 + 操作指令），RMS 可据此自查是否与提交体一致 |
| `ratioConfig` | 59 | ✅ 保留 | 语义未知、实测恒空，但正因未知才不能剔（见下） |
| `pricePrompt` / `globalPricePrompt` | 89+ | ✅ 保留 | 同上，语义未知 |
| `weekDiff` / `priceRecordWay` | 5 | ✅ 保留 | 冗余（`inWeek` 与 `calcPriceInfo` 已表达），但省不下什么 |

裁剪后一次 calc 约 **700 chars**，两房型的最大样本从 6.5KB 降到 ~1.4KB。**剔掉的两项占
裁剪收益的 95%**，剩下的小字段一起才 150 chars 左右，不值得为它们承担判断错误的风险。

⚠️ **为什么不剔得更狠**：裁剪与「desktop 忠实透传、不解读语义」是冲突的。携程那边剔 3 个
字段剔的是**噪音**（设备指纹），这里剔的是**业务字段** —— 剔错了 RMS 侧再也看不到原始
数据，**不可恢复**。所以只剔两类**已经证明**没有信息价值的：一类在别处有完整副本
（`goodsBaseInfo`），一类已证明有害（`realPriceInfos`）。语义未知的一律留着
（`ratioConfig` 万一将来用户开了比例联动，它是唯一能看出来的地方）。

上报量不再是约束 —— 一次改价只发一条上报（calc 附在 `updatePriceV2` 的上报里），
不存在中间态记录。

---

## 4. ⚠️ 问题二：一次改价被上报两遍

### 现象与机理（已确认）

```
① 用户填写    → calcPriceV2      算出最终价并展示
② 第一次发起  → updatePriceV2    createFlag: false   ← 预检，服务端要求弹窗确认
③ 用户点确认  → updatePriceV2    createFlag: true    ← 真正执行
```

②③打**同一个端点**，请求体 60 个字段里只有 `createFlag` 不同，**响应也完全一样**
（`改价踩点03.md` 两段响应逐字段比对：仅 `traceId` 与 `data` 里的流水号不同）。
靠响应区分不了，只能看 `createFlag`。

### 为什么必须修

1. **重复跟价**：两条 `operationId` 不同，RMS 幂等挡不住。
2. **假成功**：②的 `success: true` 只代表"校验通过、请确认"。**用户在弹窗点取消，价格
   根本没改，但我们已经上报过一次了。**

### 修法

`parse()` 里 `createFlag !== true` → 返回 `null` 不上报。与抖音"只收 `save_*` 不收
`check_*`"同一类问题、同一种解法。

### 不依赖「弹窗是否必现」

曾把「是不是每次改价都会走②③两步」列为动手前必须先验的前提。**不必验** —— 按
`createFlag` 的字段值分流，两种情况都正确：

| 场景 | 行为 | 是否正确 |
|---|---|---|
| 走两段（②`false` → ③`true`） | 只上报 ③ | ✅ |
| 只发一次且为 `true` | 照常上报 | ✅ |
| 只发一次且为 `false` 却生效了 | 漏报 | 自相矛盾（`false` 的语义就是"请确认"），不构成真实风险 |

**仍然保留 info 日志**：见到 `createFlag: false` 时不上报但记一条。不是为了兜"必现"这个
不确定性，而是美团将来改行为时能在日志里第一时间看见。

---

## 5. 契约与架构影响

### 5.1 契约：一次改价仍是一条上报

calc 的内容**附在 `updatePriceV2` 的那条上报里**，不单独发。`calcPriceV2` 永远不会作为
独立上报出现，RMS 也就不存在「把试算当改价」的误判空间。

放哪：`OtaAmountChangeReport` 现在没有装它的位置。两个选择——

| 方案 | 说明 |
|---|---|
| A. 塞进 `channelExtra` | 契约零改动；但 `channelExtra` 现在是「渠道专有定位字段」的位置，塞一整份计算结果语义不太搭 |
| B. 加一个通用可选字段（如 `priceContext?: JsonObject`） | 语义清楚；抖音/携程留空即可，但要动 `shared/types/amount-change.ts` |

**倾向 A 起步** —— 只有美团需要，`channelExtra` 本来就是「渠道专有」的口袋，符合
`bind-extra.ts` 的既有套路。若将来别的渠道也出现同类需求，再升级成 B。

⚠️ 无论哪种，规格文档要写清 **calc 是「算这个价时的条件与结果」，不是第二次改价**。

> **实装偏差（2026-08-12）：A 不可用，走的是 B。** `channelExtra` 早在携程那轮就已从契约里
> 删掉了（见 commit 6560706「上报契约改为带操作人与渠道账号」），全仓已无此字段 —— 本文
> 写 A 时是记忆里的旧契约。落地为 `priceContext: JsonObject | null`（**必填、可为 null**，
> 不是 `?:` 可选 —— 三渠道都得显式表态，新接渠道漏填时编译期就会报错，不会静默漏数据）。

### 5.2 机制层要加什么

`AmountSaveCapture`（prob）加两样：

```ts
const SAVE_ENDPOINTS = new Map([
  ['updatePriceV2', '/api/gw/v1/product/price/updatePriceV2'],
  ['calcPriceV2',   '/api/gw/v1/product/price/separate/calcPriceV2'],  // 新增
]);
```

1. **端点表加 `calcPriceV2`** —— 让 prob 拦得到它
2. **prob 加 `lastCalc` 字段** —— 见 §3.2

分流规则：

```
calcPriceV2                          → 覆盖 lastCalc，不上报
updatePriceV2 + createFlag !== true  → 预检，不上报（§4）
updatePriceV2 + createFlag === true  → 上报，带上 lastCalc
```

代价：`saveEndpoints` 这个名字变得名不副实（混了非保存端点）。**倾向连带改名为
`watchedEndpoints`**，三个适配器 + 机制层同步改，改动机械。

> **实装形状（2026-08-12）**：改名照做了。分流**没有**写进机制层 —— 机制层若要按
> `endpointId === 'calcPriceV2'` 分流，就等于把美团的渠道知识焊进了渠道无关的那一层。
> 改成由 `parse` 的返回值表达，机制层只按 kind 分流、不认识具体端点：
>
> ```ts
> parse(observed, context): AmountParseResult | null
>
> type AmountParseResult =
>   | { kind: 'report';  report: OtaAmountChangeObserved }   // 上报
>   | { kind: 'context'; context: JsonObject }               // 留作素材，覆盖式
> //  null                                                   // 丢弃
> ```
>
> 连带把 `parse` 的调用点从 `AmountChangeWatcher` 挪进了 `AmountSaveCapture` —— 上下文是
> **页面级**状态，而 capture 正好每 tab 一个实例、`detach()` 即会话结束；watcher 是跨 tab
> 的分发器，状态放它那儿就得自己维护 tabId→context 的映射。适配器仍然无状态（三渠道共用
> 一份实例，给它加状态会让所有 tab 串数据）。

**不为此新造抽象** —— 曾考虑给机制层加通用的「旁路端点」概念（理由是抖音 `check_*`、
携程可能也有预检），但两者不是同一类需求：抖音的 `check_*` 是**明确不该收**的，美团的
`calcPriceV2` 是**要留下来当上下文**的。CLAUDE.md：只有"确定会有第二种实现"才值得抽象。

### 5.3 `isSuccessful` 要按端点分流吗

`calcPriceV2` 的成功响应同样是 `code: 10000` + `success: true`，与 `updatePriceV2` 一致，
**当前实现直接可用**。计算失败时不该覆盖 `lastCalc`（宁可留着上一条也不要存个空结果），
所以 calc 也要过一遍 `isSuccessful`。

---

## 6. 进度与剩余

### ✅ 已完成（2026-08-12）

| 项 | 落点 |
|---|---|
| `createFlag !== true` → 不上报 + info 日志 | `meituan/amount-change-adapter.ts` |
| 端点表加 `calcPriceV2` | 同上，`WATCHED_ENDPOINTS` |
| 试算结果收成上下文（剔 `goodsBaseInfo` / `realPriceInfos`） | 同上，`toCalcContext` |
| `saveEndpoints` → `watchedEndpoints`（三渠道 + 机制层） | `channels/types.ts` 等 |
| `parse` 返回 `report` / `context` / `null` 三态 | `channels/types.ts` |
| 页面级上下文（覆盖式，`detach()` 作废） | `amount-save-capture.ts` |
| 契约加 `priceContext: JsonObject \| null` | `shared/types/amount-change.ts` |
| mock 网关打印 `priceContext`（先 stringify，避免 depth 截断） | `rms-amount-change-gateway-mock.ts` |
| 规格文档同步（§2.1 实装状态、§6 `priceContext` 结构与样例） | `meituan-payload-spec.md` |

单测：美团适配器 25 个、机制层 13 个（含上下文的 4 个新用例）。
桌面全量 **73 文件 463 用例通过**，`lint` / `check:types` 通过。

### ⏳ 剩余：真机验证（唯一阻塞项）

单测覆盖的是逻辑，**拦不拦得到 `calcPriceV2` 只有真机能证**。要确认的四件事：

- [ ] 试算端点路径与实际一致（`/api/gw/v1/product/price/separate/calcPriceV2`），能被拦到
- [ ] 一次改价**只上报一条**（预检那条只在日志里出现，不进 mock 网关）
- [ ] 上报体带着 `priceContext`，且里面的周次档与 `requestBody` 的对得上
- [ ] 相对操作（`operateType: 1`）能凭 `originalPriceInfo` + `priceInfo` 还原出绝对价

### 📌 仍然欠着的（不阻塞）

- [ ] 把改价页所有保存入口点一遍，确认 `updatePriceV2` 之外有无别的端点
- [ ] 顺手抓一个失败样本（改成 0 元 / 超限价），看渠道拒绝时长什么样 —— 见 §8，
      这不再是「风险最高」项

---

## 7. 未实测清单（已更新）

已结清（划掉的是本轮踩点解决的）：

- ~~`priceInfos` vs `realPriceInfos` 的量纲差异~~ → 用户输错，无量纲差异（§2.1）
- ~~`createFlag` 语义~~ → 三段式确认（§4）

仍然空白：

- [ ] **失败响应形状** —— 风险方向已修正，见 §8。当前判定不会把失败当成功，缺样本影响的
      是「渠道拒绝时会不会漏报」
- [ ] `subPrice` 有值时代表什么价（七次实测从未被改）
- [ ] `operateType` 是否存在 1~6 之外的取值
- [ ] `secondPriceRecordWay: -1`、`pricePrompt` 各字段语义
- [ ] 形状①的 `dates` 长度 >1 时，周次档是否仍为共享语义（七次实测 `dates` 长度均为 1）
- [ ] `updatePriceV2` 之外是否还有别的保存端点（房态房量尚未接入）
- ~~`calcPriceV2` 的上报量对 RMS 的压力~~ → 不再是约束：一次改价只发**一条**上报，
  calc 附在里面且已裁剪（单房型 ~0.9KB，实测最大的两房型样本 2.3KB）

---

## 8. 更正：`code: 10000` 的风险方向写反了

之前几版文档把失败样本列为「风险最高」，理由是「若美团失败时 `code` 仍为 10000、错误只在
`error` 字段，当前判定会**把失败当成功上报**」。**这个说法不成立。**

`10000` 是美团网关的**成功码**（`账号信息.md` 里 `getDetail` 也是这个码）。业务失败时它
几乎必然变成别的值，而 `success` 也会跟着变 `false` —— 当前判定要求两个同时为真，是保守
口径，**不会把失败当成功**。

真正可能漏掉的是相反方向：

| 场景 | 当前判定 | 后果 |
|---|---|---|
| 网关失败（`code !== 10000`） | 不上报 ✅ | 正确 |
| 业务失败且 `success: false` | 不上报 ✅ | 正确 |
| 「网关成功但业务拒绝」：`code: 10000` + `success: true` + `error: "限价规则…"` | **会上报** ⚠️ | 上报一次实际没生效的改价 |

第三行是唯一的真实风险，且**目前纯属推测** —— 七次实测 `error` 全为 `null`，没有任何样本
指向这种形状。即便存在，代价也只是**多报一次**，与 `createFlag` 那个问题同一量级，而不是
系统性地把失败全当成功。

**结论**：失败样本从「风险最高、必须先做」降级为「顺手抓一个」。抓它的价值是搞清楚渠道
拒绝时长什么样（`error` 字段会不会带上限价原因），不是防止误判。
