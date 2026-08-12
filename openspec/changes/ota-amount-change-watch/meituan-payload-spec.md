# 美团价量态改动上报体数据规格

> ## ⚠️ 2026-08-12：上报形状已大改，**本文只剩踩点原始材料的价值**
>
> **RMS 侧对接请读代码里的规格**，不要照本文实现：
>
> | 内容 | 现在在哪 |
> |---|---|
> | 美团 `changeRaw` 的结构与解读 | `apps/desktop/src/main/channels/meituan/amount-change-payload.ts` |
> | 携程 `changeRaw` | `apps/desktop/src/main/channels/ctrip/amount-change-payload.ts` |
> | 公共字段（`operationId` / `loginUserId` / `submitAt`…） | `apps/desktop/src/main/gateway/rms/rms-amount-change-gateway-mock.ts` |
>
> 三处关键变化，本文下面的正文**尚未反映**：
>
> 1. **上报体只有一个内容字段 `changeRaw`**，`requestBody` / `responseBody` 都已删除
> 2. **美团发的是 `calcPriceV2` 的试算结果，不是 `updatePriceV2` 的请求体** ——
>    后者只有「+1 元」这类相对操作，RMS 既算不出绝对价也无从校验，一个字节都不发。
>    因此 `endpointId` 恒为 `calcPriceV2`
> 3. **`operateType` 那套「增/减/乘/除/设置」RMS 侧用不到了** —— 试算结果里
>    `originalPriceInfo`（改前）与 `priceInfo`（改后）都是绝对值
>
> 本文保留是因为 §3~§5 记录了 `updatePriceV2` 请求体的完整踩点结果（两种日期形状、
> 六种 `operateType` 的实测取值），二期做房态房量或美团改接口时还要回来查。
>
> **数据来源**：2026-08-11 真机实测（门店 762662011，账号 274615733），非踩点推断。
> 标「未实测」的地方是明确的空白，不要当成已确认的事实。

---

## 1. 一句话摘要

| 项 | 结论 |
|---|---|
| endpointId | 只有 `updatePriceV2` 一个（试算 `calcPriceV2` 不单独上报，见 §6） |
| 门店定位 | `poiId` 在请求体顶层，**单值、必有**，三渠道里最可靠 |
| 房型定位 | `goodsList[].goodsBaseInfo.goodsId`（**不是** `preGoodsId`） |
| 日期结构 | **两种形状二选一**，见 §3 |
| 价格 | 藏在 6~7 层嵌套最深处，**字符串**，**一律 ×100** |
| ⚠️ 相对操作 | 请求体只说「+2 元」不说原价，绝对价要靠 `priceContext` 补 —— 见 §6 |
| ⚠️ 重复上报 | 同一端点打两遍，只有 `createFlag: true` 那次是真的 —— 见 §2.1 |

---

## 2. 顶层结构

```
requestBody
├── poiId          string   门店 ID（"762662011"）—— 直接可用，无需反查
├── partnerId      number   商家 ID（4595635）
├── currency       string   "CNY"
├── createFlag     boolean  ⚠️ **区分预检与真正执行**，见下
├── extendParam    object   实测一直是空对象 {}
└── goodsList      array    每个元素 = 一个房型，见 §3
```

`poiId` 是**字符串**，`partnerId` 是**数字** —— 同一个请求体里 ID 类型不统一，取值时注意。

### 2.1 ⚠️ createFlag：一次改价会打两遍这个端点

美团改价是三段式，②③打的是**同一个端点**，请求体 60 个字段里**只有 `createFlag` 不同**，
响应也完全一样：

```
① 用户填写    → calcPriceV2      算出最终价并展示
② 第一次发起  → updatePriceV2    createFlag: false  ← 预检，服务端要求弹窗确认
③ 用户点确认  → updatePriceV2    createFlag: true   ← 真正执行
```

**只有 `createFlag: true` 才是真的改了价。** ②的 `success: true` 只代表「校验通过、请确认」
—— 用户在弹窗点取消的话价格根本没变。

desktop 侧按 `createFlag !== true → 不上报` 过滤，**RMS 只会收到 ③**。

> 2026-08-12 已实装（`meituan/amount-change-adapter.ts` 的 `parse`）。见到 `createFlag: false`
> 时不上报但记一条 info —— 美团将来改行为时能在日志里第一时间看见。

---

## 3. goodsList[] —— 每个房型一项

```
goodsList[i]
├── goodsBaseInfo        object   房型静态属性（26 个字段），见 §4
├── ratioConfig          object   { ratioType, ratioChange, newRatio }
├── priceRecordWay       number   8 = 改卖价 / 9 = 改低价（见 §5）
├── weekDiff             boolean  是否开了「周末差异定价」
└── 日期模型 —— 下面两个字段**二选一，不会同时出现**：
    ├── calcPriceUnifiedDateModel   形状①：统一日期
    └── calcPriceModels             形状②：分段日期
```

### 3.1 两种日期形状

**踩点文档只覆盖了①，②是真机发现的。RMS 必须两种都认。**

```
① calcPriceUnifiedDateModel: {        ② calcPriceModels: [
     dates: [                              { startDate: "2026-08-25",
       { startDate: "2026-08-11",            endDate:   "2026-08-26",
         endDate:   "2026-08-11" }           calcPriceWeekModels: [ … ] },
     ],                                    { startDate: "2026-08-27",
     calcPriceWeekModels: [ … ]              endDate:   "2026-08-28",
   }                                         calcPriceWeekModels: [ … ] }
                                          ]
   日期集中在一处                          日期跟着每一段走，可以有多段
```

②比①**多一层数组**。①相当于②只有一段的特例。

`calcPriceWeekModels` **及其以下结构两者完全一致**，差别仅在日期挂哪一层。
建议 RMS 侧先归一成 `(日期区间, inWeek, calcPriceInfo)` 三元组：

```ts
type Segment = { startDate: string; endDate: string; weekModels: WeekModel[] };

function segmentsOf(goods: MeituanGoods): Segment[] {
  if (goods.calcPriceModels) {
    return goods.calcPriceModels.map((m) => ({
      startDate: m.startDate,
      endDate: m.endDate,
      weekModels: m.calcPriceWeekModels,
    }));
  }
  const u = goods.calcPriceUnifiedDateModel;
  return u.dates.map((d) => ({
    startDate: d.startDate,
    endDate: d.endDate,
    weekModels: u.calcPriceWeekModels,   // 注意：所有日期区间共享同一份周次档
  }));
}
```

⚠️ 形状①里 `dates` 是数组而 `calcPriceWeekModels` 只有一份 —— 多个日期区间**共享**同一批
周次档。实测只见过 `dates` 长度为 1，长度 >1 时是否仍是共享语义**未实测**。

### 3.2 calcPriceWeekModels[]

```
calcPriceWeekModels[j]
├── inWeek                array   [1,2,3,4,7] —— 数字，1=周一 … 7=周日（同抖音）
├── calcPriceInfo         object  三种价格，见 §5
└── calcPriceFactorInfos  null    实测一直是 null，用途未知
```

---

## 4. goodsBaseInfo —— 只有 goodsId 有用

26 个字段全是房型**静态属性**，与本次改了什么价无关：

```
goodsId(number) goodsName preGoodsId briefGoodsName goodsStatus goodsType
sellChannel paymentType typeLimitValue priceChangeMode pricingPower
priceRecodeWay auditStatus rpCustomName maxAdultAdmissibility
priceRecordWayList noPersistent goodsSource breakFastNum goodsActivityMap
channelNos goodsTagMap switchStatus expectPriceChangeMode deductionAudit
superDealReSale canAdjustPrice
```

| 字段 | 说明 |
|---|---|
| `goodsId` | **数字型**，RMS 的 `ota_sale_room_type_id` 对应的就是它 |
| `preGoodsId` | ObjectId 形状的历史遗留 ID（`"64472d01da3fa7ab168924a8"`），**别用** |
| `priceRecodeWay` | 注意拼写是 `Recode` 不是 `Record`，与外层 `priceRecordWay` 是两个字段 |

⚠️ **这里没有任何当前价格字段** —— 见 §6。

---

## 5. calcPriceInfo —— 价格怎么表达

```json
"calcPriceInfo": {
  "salePrice": { "operateType": 1, "operateNum": "200" },
  "basePrice": { "operateType": 3, "operateNum": "" },
  "subPrice":  { "operateType": 3, "operateNum": "" }
}
```

### 5.1 三种价格

| 字段 | 含义 | 对应 `priceRecordWay` |
|---|---|---|
| `salePrice` | **卖价** | 8 |
| `basePrice` | **低价** | 9 |
| `subPrice` | **未实测** —— 六次真机里从未见它被改动 | — |

`priceRecordWay`（`goodsList[]` 层）与实际改的价格字段是对应的：改卖价时为 8、改低价时为 9。
可作为交叉校验，但**以 `calcPriceInfo` 里 `operateType !== 3` 的那一项为准**。

### 5.2 operateType 全表（六种均已实测）

| operateType | 操作 | 用户输入 | operateNum |
|---|---|---|---|
| 1 | **增加** | 增 2 元 | `"200"` |
| 2 | **减少** | 减 2 元 | `"200"` |
| 3 | **不改这一项** | — | `""`（空串） |
| 4 | **乘以** | ×1.01 | `"101"` |
| 5 | **除以** | ÷1.01 | `"101"` |
| 6 | **直接设置** | 设 211 元 | `"21100"` |

**两条铁律：**

1. **`operateNum` 一律 ×100 存成字符串** —— 金额和倍率都不例外。
   `"200"` = 2 元，`"21100"` = 211 元，`"101"` = 1.01 倍。
   取值：`Number(operateNum) / 100`。
2. **方向由 `operateType` 表达，没有负号** —— `1↔2`（加减）、`4↔5`（乘除）成对。
   减 2 元记的是 `"200"` 不是 `"-200"`。**把 type 2 当成 type 1 处理会让降价变涨价。**

### 5.3 RMS 侧的硬性要求

```
遇到 operateType 不在 [1,2,3,4,5,6] 内 → 跳过并告警，不要猜
遇到 operateType === 3                → 这一项没改，直接忽略
其余                                   → 按上表处理，记得 /100
```

**绝不能只读 `operateNum` 不看 `operateType`** —— 把「增加 2 元」读成「改成 2 元」、
把「乘 1.01」读成「改成 101 元」，都是会直接污染跟价的脏数据。

---

## 6. ⚠️ 最大限制：相对操作算不出绝对价

**请求体里没有任何当前价格。** `goodsBaseInfo` 的 26 个字段、`goodsList[]` 的其余字段，
全部核对过，没有一个是当前售价 / 低价 / 原价。

```
请求体只说：  "卖价 +2 元"
它不说：      "原来多少钱"
```

后果按 operateType 分：

| operateType | RMS 能算出改后价格吗 |
|---|---|
| 6（直接设置） | ✅ 能 —— `operateNum / 100` 就是最终价 |
| 1 / 2 / 4 / 5 | ❌ **不能** —— 缺基准价 |

美团服务端自己持有当前价，收到「+2」直接在库里算，不需要客户端传。这对美团合理，
对我们这种**旁听者**就是信息缺失。注意这不只是「看不到低价」——改卖价时连**卖价自己的
原值**也没有。

### ✅ 素材来源：上报体的 `priceContext` 字段（2026-08-12 已实装）

`calcPriceV2`（用户填写时页面自己会调）的响应里**同时有改后价和原价**：

```
data.goodsDetails[]
  ├── unifiedDatePriceInfos   对象，形状①时有；weekPriceInfos[].inWeek 与请求的周次档一一对应
  ├── priceInfos              数组，形状②时有；同上，与请求周次档对应
  └── realPriceInfos          数组，七次响应全都有

每个 weekPriceInfos[] 元素：
  ├── priceInfo         ← 改后（salePrice/basePrice/subPrice/subRatio/baseAddRatio）
  └── originalPriceInfo ← 改前
```

金额同样是**字符串 ×100**，与请求体一致（曾疑似出现 1000 倍的样本，实为用户把
`240.13` 输成 `240113`，量纲没有例外）。

⚠️ **取 `unifiedDatePriceInfos` / `priceInfos`，不要取 `realPriceInfos`**：后者的
`inWeek` 是服务端按"区间内实际存在的日期 + 原价是否相同"重新拆分过的，与
`updatePriceV2` 请求体里的周次档对不上。实测同一响应里请求档为 `[1,2,3,4,7]`，
`realPriceInfos` 给的是 `[2,3]`（区间 08-25~08-26 只含周二周三）。按 `realPriceInfos`
拼回请求体会把价格安错档。

desktop 侧的取法：改价页监听期间维护**一份**最近的 `calcPriceV2` 请求+响应，后来的覆盖
先来的；用户提交时把它放进上报体的 **`priceContext`** 字段一起发。

**取最新是安全的**，因为页面上任何影响价格的条件变更（改数值、勾选房型、改日期区间、
开关周末差异定价）都会触发一次重算 —— 最新那条 calc 天然与提交体同条件。方案与实测证据见
`openspec/changes/ota-amount-change-watch/meituan-next-steps.md` §3。

#### `priceContext` 的结构

```
priceContext                     object | null   抖音/携程恒为 null
├── endpointId    string         恒为 "calcPriceV2"
├── requestBody   object         试算请求体**原样** —— 算这个价时的**条件**
│                                （calcPriceUnifiedDateModel / calcPriceModels、
│                                  日期区间、周次档、操作指令）。响应里没有这些
└── responseData  object         试算响应的 `data`，**经过裁剪**（见下）
    ├── goodsDetails[]
    │   ├── goodsBaseInfo          ← 收成 { goodsId }
    │   ├── unifiedDatePriceInfos  ← 形状①：{ dates, weekPriceInfos[] }
    │   ├── priceInfos             ← 形状②：数组，同上
    │   ├── priceRecordWay / pricePrompt / weekDiff / ratioConfig  原样
    │   └──（realPriceInfos 已剔除）
    └── globalPricePrompt          原样

weekPriceInfos[] 每一项：
  ├── inWeek             与**请求的**周次档一一对应
  ├── priceInfo          改后（salePrice/basePrice/subPrice/subRatio/baseAddRatio）
  └── originalPriceInfo  改前
```

金额同样是**字符串 ×100**。取 `unifiedDatePriceInfos` 或 `priceInfos`（二选一，与请求的
日期形状对应）。

**RMS 侧要知道的三件事：**

1. **一次改价仍然只有一条上报**，`endpointId` 恒为 `updatePriceV2`。`priceContext` 是
   **附带的上下文**（「这个价是在什么条件下算出来的」），**不是第二次改价** —— 不会有
   独立的 `endpointId: 'calcPriceV2'` 上报。
2. **`responseData` 经过裁剪**（与 `requestBody` 的原样透传不同）：
   - `goodsBaseInfo` 只保留 `{ goodsId }` —— 完整的一份在同一条上报的 `requestBody` 里
   - `realPriceInfos` **不发** —— 它的 `inWeek` 与请求周次档对不上（见上），发出去只会诱导取错
   - 其余字段原样保留（含语义未知的 `ratioConfig` / `pricePrompt`）
3. **`priceContext` 可能为 null**。理论上不该发生（不试算就没法提交），但为 null 时
   `requestBody` 的相对操作仍然有效，只是算不出绝对价 —— 按本节开头的老规矩处理即可。
   desktop 侧遇到这种情况会记一条 warn。

下面这些是**在找到上述解法之前**考虑过的退路，保留备查：

| 思路 | 问题 |
|---|---|
| 用 RMS 台账里的价当基准 | 台账价与美团实际价可能不同步，算出来会错 |
| 改价后再抓一次列表接口 | 违背「绝不碰用户页面」前提；且是异步任务，刚保存可能还没生效 |
| 额外拦截页面的价格**查询**接口，记下当前价 | 需要新踩点；要处理「查了但用户没保存」的情况 |
| RMS 只对 type 6 跟价，其余仅记录 | 最保守，覆盖面小 |

**在方案定下来之前，RMS 侧不应假装能算出相对操作的最终价。**

---

## 7. 响应体与成功判定

```json
{ "code": 10000,
  "error": null,
  "traceId": "6463719156137136738",
  "data": "hotel_sc_dealing__update_price_and_relation_4595635_762662011_9770997257047075",
  "success": true }
```

desktop 侧判定成功的条件：`code === 10000` **且** `success === true`（保守口径，两个都要真）。
**只有判定成功的改价才会上报**，渠道拒绝的不发。

⚠️ 两点：

1. `data` 是**异步任务串**（`hotel_sc_dealing__update_price_and_relation_<partnerId>_<poiId>_<seq>`），
   与携程的 `taskId` 同性质 —— 成功只代表**受理**成功，**不代表价格已生效**。
2. **失败响应形状未实测**（截至 2026-08-11），但风险有限：`10000` 是美团网关的**成功码**
   （`账号信息.md` 里 `getDetail` 同码），业务失败时它与 `success` 几乎必然一起变，两个
   都要求为真的判定**不会把失败当成功**。唯一的残留风险是「网关成功但业务拒绝」
   （`code: 10000` + `success: true` + `error` 带拒绝原因）这种形状 —— 目前纯属推测，
   七次实测 `error` 全为 `null`；即便存在，代价也只是多报一次。

---

## 8. 与其他两个渠道的差异速查

| 维度 | 抖音 | 携程 | 美团 |
|---|---|---|---|
| 门店 ID | 无，靠 product_id 反查 | 老模块有 / 新模块无 | ✅ `poiId` 顶层单值 |
| 一次几家店 | 一家 | 可能多家 | 一家 |
| 价格类型 | 数字 | 数字 | **字符串，×100** |
| 价格表达 | 绝对值 | 绝对值 | **增/减/乘/除/设置六选一** |
| 能算出最终价 | ✅ | ✅ | 靠 `priceContext` 补（§6） |
| 周次表达 | `[1..7]` 数字 | 位串 / 英文枚举 | `[1..7]` 数字 |
| 噪音字段剔除 | 不剔 | 剔 3 个 | 不剔（风控参数在 query 上） |
| 异步任务 | 否 | 是（taskId） | 是（data 任务串） |

---

## 9. 完整样例（2026-08-11 真机，仅脱敏 operationId）

形状①、两个房型、周末差异定价（平日 vs 周末两档）。`goodsBaseInfo` 省略了与解析无关的
静态字段，实际上报是**原样带着**的。

```json
{
  "operationId": "e918bd0e-a6dd-43d7-a510-40b6bef1469a",
  "loginUserId": 1,
  "loginUserName": "Dev Admin",
  "source": "meituan",
  "endpointUrl": "https://me.meituan.com/api/gw/v1/product/price/updatePriceV2?yodaReady=h5&…&mtgsig=…",
  "endpointId": "updatePriceV2",
  "otaHotelId": "762662011",
  "channelAccountId": "274615733",
  "channelAccountName": null,
  "requestBody": {
    "poiId": "762662011",
    "partnerId": 4595635,
    "currency": "CNY",
    "createFlag": true,
    "goodsList": [
      {
        "goodsBaseInfo": { "goodsId": 847226645, "goodsName": "I书韵I大床房（阅享静读）…" },
        "ratioConfig": { "ratioType": null, "ratioChange": false, "newRatio": null },
        "priceRecordWay": 8,
        "weekDiff": true,
        "calcPriceUnifiedDateModel": {
          "dates": [{ "startDate": "2026-08-11", "endDate": "2026-08-11" }],
          "calcPriceWeekModels": [
            { "inWeek": [1, 2, 3, 4, 7],
              "calcPriceInfo": {
                "salePrice": { "operateType": 1, "operateNum": "100" },
                "basePrice": { "operateType": 3, "operateNum": "" },
                "subPrice":  { "operateType": 3, "operateNum": "" } },
              "calcPriceFactorInfos": null },
            { "inWeek": [5, 6],
              "calcPriceInfo": {
                "salePrice": { "operateType": 1, "operateNum": "200" },
                "basePrice": { "operateType": 3, "operateNum": "" },
                "subPrice":  { "operateType": 3, "operateNum": "" } },
              "calcPriceFactorInfos": null }
          ]
        }
      },
      { "goodsBaseInfo": { "goodsId": 847317669, "goodsName": "I经济I 大床房（简约舒适）…" },
        "priceRecordWay": 8, "weekDiff": true,
        "calcPriceUnifiedDateModel": { "…与上一个房型同构…": null } }
    ],
    "extendParam": {}
  },
  "responseBody": "{\"code\":10000,\"error\":null,\"traceId\":\"6463719156137136738\",\"data\":\"hotel_sc_dealing__update_price_and_relation_4595635_762662011_9770997257047075\",\"success\":true}",
  "priceContext": {
    "endpointId": "calcPriceV2",
    "requestBody": { "…试算请求体原样，含 calcPriceUnifiedDateModel…": null },
    "responseData": {
      "goodsDetails": [
        {
          "goodsBaseInfo": { "goodsId": 847226645 },
          "priceRecordWay": 8,
          "weekDiff": true,
          "unifiedDatePriceInfos": {
            "dates": [{ "startDate": "2026-08-11", "endDate": "2026-08-11" }],
            "weekPriceInfos": [
              {
                "inWeek": [1, 2, 3, 4, 7],
                "priceInfo":         { "salePrice": "24113", "basePrice": "20978" },
                "originalPriceInfo": { "salePrice": "24013", "basePrice": "20891" }
              }
            ]
          },
          "priceInfos": null,
          "ratioConfig": { "ratioType": null, "ratioChange": false, "newRatio": null }
        }
      ],
      "globalPricePrompt": { "prompts": null }
    }
  },
  "submitAt": "2026-08-11T11:05:19.354Z"
}
```

`priceContext` 补齐了 `requestBody` 算不出的那一半：`requestBody` 说「卖价 +1 元」，
`priceContext` 说「加之前 240.13，加之后 241.13」。两者的周次档 `[1,2,3,4,7]` 一一对应。

**语义**：操作人 Dev Admin(1) 用美团账号 274615733，把门店 762662011 的 2 个房型在
2026-08-11 当天改价；开了周末差异定价，平日（周一二三四日）**卖价 +1 元**、周末（周五六）
**卖价 +2 元**。展开后是 4 条 `(房型 × 周次)` 记录。

⚠️ 注意这里是 **+1 / +2 元**，不是「改成 100 / 200 元」—— `operateType: 1` 是增加。
早期读这份日志时曾误判成设定值，是 §5.2 那张表要解决的问题。

---

## 10. 未实测清单

写明空白，避免被当成已确认的事实：

- [ ] 失败响应的形状（§7）—— 风险有限，见 §7 第 2 条
- [ ] `subPrice` 有值时长什么样、代表什么价
- [ ] `operateType` 是否存在 1~6 之外的取值
- [ ] 形状①的 `dates` 长度 >1 时，周次档是否仍为共享语义（七次实测长度均为 1）
- [ ] `calcPriceFactorInfos` / `ratioConfig.ratioType` / `secondPriceRecordWay` 的语义
- [ ] `updatePriceV2` 之外是否还有别的保存端点（房态房量尚未接入）

`createFlag` 的语义已于 2026-08-11 结清，见 §2.1。
