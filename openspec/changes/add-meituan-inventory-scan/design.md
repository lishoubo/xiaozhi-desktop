## Context

动机见 `proposal.md`。扫描机制总纲见 `add-ota-inventory-scan/design.md`（Change B，携程侧已实装并过 code review）。

**已有地基**（本次只接线，不重写）：

| 已有 | 位置 | 本次是否动 |
|---|---|---|
| 调度器（遍历、开关、抖动、fixed-delay） | `channels/inventory-scan-dispatcher.ts` | 只扩 `ScanTarget` |
| 比对纯函数 / 写入队列 / 基线表 | `inventory-snapshot/` `database/` | 否 |
| 扫描结果处理（映射→比对→上报） | `inventory-snapshot/scan-to-report.ts` | 否（按渠道查表，表由装配层给） |
| 上报服务（补身份、重试） | `services/amount-change-report-service.ts` | 否 |
| 美团回读（房量，已真机验证） | `channels/meituan/inventory-readback*.ts` | 否 |
| 美团门店发现（poiId + partnerId） | `channels/meituan/poi-infos.ts` | 复用解析，另加主进程取数 |

**美团三个读端点已由 RMS RPA 侧踩透并在生产跑过**（`xiaozhi-rms-workspace/docs/美团/RPA-房价信息.md`、`RPA-房型信息.md`），本次不重新踩点，只验证 desktop 的发起方式。

### ⚠️ 与携程的三处结构性差异

```
                    携程                          美团
账号↔门店      1:1（cookie 决定当前门店）      1:N（一个账号挂多店）
取数入参        无（body {}）                  poiId + partnerId + goodsIds + roomIds
房型 ID 空间    roomTypeID 一个空间            roomId(物理) / goodsId(售卖) 两个空间
请求步数        2                              4（见决策 2）
```

第一条推翻了 Change B 决策 2「遍历凭证，不遍历绑定酒店」的适用前提。

## Goals / Non-Goals

**Goals**

- 美团脱离被动监听盲区：用户在别处改动、渠道自行变更都能被发现
- 扫描与回读写出的同类格子落在同一 ID 空间、同一 contentHash 口径
- 美团自然读也建基线，扫描首轮即有打底

**Non-Goals**

- 抖音（未踩点）
- 单房态房量页的覆盖缺口（既有缺口，见 `add-meituan-inventory-readback/STATUS.md`）
- 房型清单分页（踩点 22 goods 单页足够，超限再议）
- 扫描结果驱动的自动跟价（只上报事实）

## Decisions

### 1. ⭐ 两类格子按渠道事实各归其位，不统一 ID 空间

**美团的房态房量挂物理房型，价格挂售卖房型** —— 这是渠道事实，不是接口组织方式带来的表象。

```
realRoomId (物理房型)                     ← 房态、房量的归属层
   └── goodsId A (不含早/预付)  ┐
   └── goodsId B (含早/到付)    ├─ 价格各自独立
   └── goodsId C (专享)         ┘
```

⚠️ `queryPriceInventoryStatusInfo` 的响应把 `goodsStatusMap` **套在 goods 下**，容易误读成「房态属于 goods」。踩点实证否定了这点：同一 `containerId` 下两个 goods 的 `goodsStatusMap` **逐字段相同**（`踩点/房价房态.md` 第 173 行与第 336 行两段，`containerId: 221352466`）。那是同一份事实的重复回显。

所以格子归属照 Change A 已定的模型（`inventory-snapshot/types.ts:84-88`），无需新决策：

| itemType | otaPhysicalRoomId | otaSaleRoomId | 来源 |
|---|---|---|---|
| `roomStatus` | `roomId` | `''` | `queryRoomStatusInfo`（见决策 3） |
| `price` | `''` | `goodsId` | `queryPriceInventoryStatusInfo.goodsPriceMap` |

**被否决的方案**：

| 方案 | 为什么不做 |
|---|---|
| 把房态翻成 goodsId 空间 | 一份事实变 N 行，且与回读写的格子撞不上唯一键 |
| 把价格聚合到 roomId 空间 | 多对一要定合并规则 = 在客户端复刻美团的定价语义 |
| 回读改用 `queryPriceInventoryStatusInfo` | 已真机验证并提交的稳定路径，无理由动 |

### 2. 三步请求

> 📌 **2026-09-21 修订**：原为四步，第一步 `poiInfos` 用于「校验门店属于本账号」。
> 门店清单改为随登录记录（决策 4）之后，那层校验的前提消失（换账号时 `pois` 会跟着
> 更新），且它会让 **N 家门店每轮重复发 N 次同样的账号级请求**，已删。

```
①  POST  /product/goods/queryListAndTag               { poiId, partnerId, filterType:1,
                                                        needDraftGoods:true, offsetGoodsId:0 }
         → realRoomRelations[]
             ├── realRoomId  ─────────────────┐
             └── logicRoomRelations[]         │ 这层关系是③的房态归属依据
                   └── goodsList[].goodsId ───┘
         → goodsIds[]（过滤后）+ roomIds[]（realRoomId 去重）

②  POST  /product/goods/queryPriceInventoryStatusInfo { startDate, endDate, poiId,
                                                        partnerId, goodsIds[], roomIds[] }
         → data[].goodsPriceMap[date]   → price 格（goodsId）
         ⚠️ 同响应的 goodsStatusMap 刻意不读，理由见决策 3

③  POST  /product/goods/queryRoomStatusInfo           { roomIds[], startDate, endDate,
                                                        poiId, partnerId }
         → data[].roomStatusMap[date]   → roomStatus 格（roomId）
         ⚠️ 与回读同一端点、同一响应形状
```

①是②③的组参前提，②③之间无依赖但**串行发**（账号数量级个位数，不抢并发）。

**②③都失败才算本门店失败**；单边失败记 warn 并写入另一边的格子 —— 价格与房态是两类独立事实，一类读不到不该让另一类也丢。

### 3. ⚠️ 房态专门再调一次 `queryRoomStatusInfo`，不复用③的 `goodsStatusMap`

③的响应里其实带房态，不读它是**有意的**：两者字段集不同。

```
④ queryRoomStatusInfo   date containerId shareType roomStatus limitType remainCount limitRemain usedCount invSwitch
③ goodsStatusMap        date containerId shareType roomStatus limitType             limitRemain           invSwitch
                                                                        ↑ 缺           ↑ 缺
```

（左为 `tests/fixtures/meituan/query-room-status-info.json`，右为 `踩点/房价房态.md:174-182`）

若扫描用③的子集字段、回读用④的全集字段，同一格的 `contentHash` 在两条路径上必然不同 —— **每轮扫描都把回读刚写的格子判成有差异**，误报不会停。

| 方案 | 请求数 | 代价 |
|---|---|---|
| **④ 单独调**（采用） | 每店 +1 | 一次请求；两条路径彻底同构 |
| 读③的子集，contentHash 取交集 | 每店 +0 | 回读的 `remainCount`/`usedCount` 变成不参与比对的死字段，房量变化报不出来 |
| 读③的子集，两套 contentHash | 每店 +0 | 同一 itemType 两套口径，正是 `types.ts:160-165` 警告的形状 |

⚠️ RPA 侧读③的 `goodsStatusMap` 而不加请求，是因为它有 `BASIC_INFO_SYNC` 全量打底且**不做逐格比对**。desktop 的基线要支撑 diff，口径一致比省一次请求重要。

### 3.1 ④被回读与扫描共用，抽出端点知识层

④在两条路径上出现，但**发起方式与产出都不同**，能共用的只有中间那段。

```
                回读（既有，已上线）              扫描（本次）
发起      页面内 XHR（executeJavaScript）    主进程 session.fetch
入参来源  用户写请求报文                    ②查来的房型清单
范围      本次改动命中的房型 × 日期          全店房型 × 整个窗口
产出      上报体（直接发 RMS）               原始行（交给调度层比对基线）
失败      不重试不落盘                       写基线、进 GlitchTip
          └──────────┬──────────────────────────────┘
                     ▼ 共用的只有这一段
            URL / 请求体形状 / 响应怎么展平
```

```
channels/meituan/
├── room-status-endpoint.ts    ⭐ ④的端点知识：URL、请求体形状、响应展平
│                                 纯函数，不认识发起方式、不认识「目标」
├── session-expiry.ts          ⭐ 失效判据（从 inventory-readback.ts 抽出）
│
├── inventory-readback.ts      ← 改为 import 上面两个；自己的收窄逻辑保留
├── inventory-scan.ts          ⭐ 四步编排；④直接用展平结果
```

```ts
export const MEITUAN_ROOM_STATUS_URL = '.../queryRoomStatusInfo';

export function buildRoomStatusRequest(args: {
  roomIds: readonly number[]; startDate: string; endDate: string;
  poiId: string; partnerId: number;
}): JsonObject;

/**
 * 响应 → 扁平行：展平 `roomStatusMap`，把 `roomBaseInfo` 的字段并进每行。
 * ⚠️ **不带任何过滤**，理由见下。
 */
export function flattenRoomStatusRows(data: readonly unknown[]): JsonObject[];
```

**⚠️ 展平层不带过滤，但过滤本身必须有 —— 两类过滤放在不同的层**

| 过滤 | 放哪 | 回读 | 扫描 | 性质 |
|---|---|---|---|---|
| 目标房型 / 目标日期集合 | `inventory-readback.ts` | ✅ | ❌ | 回读的语义边界 |
| **`roomCategory === 1`** | **`inventory-snapshot/meituan-cells.ts`** | ✅（自己那份） | ✅ | **落库口径** |

**目标集合只有回读需要**：它的产出直接就是上报体，接口只认日期区间，用户勾的日期不连续时请求范围必然比目标大 —— 多报一天等于替用户宣告了他没做的改动（服务端拿 cells 去追价）。扫描没有这回事：比对**按格子键逐格查基线**，没有基线的格子自然落进 `added`（只写不报），多读几天是 diff 的正常输入。

**⛔ 钟点房过滤是另一回事，它不是「范围」而是「同一格的两副身份」**

```
roomId 493879575 同一天返回两行：
   roomCategory 1（日租）  limitRemain 5
   roomCategory 2（钟点）  limitRemain 999
            ↓ 格子键 (source, otaHotelId, '', roomId, 'roomStatus', date) 完全相同
            ↓ 而 roomCategory 不在 SnapshotKey 里
   后写的覆盖先写的 → contentHash 每轮翻覆 → 永远报差异，且报的是假的
```

（实证见 `add-meituan-inventory-readback/STATUS.md`：同一 `roomId` 在一次验证里是钟点房、另一次是日租，"两副身份"。）

**已定：钟点房不对账，且过滤在源头 —— 与携程同构。**

```
携程  ① getRcProductList  过滤 hourRoom / advanceSale → ②入参干净 → 映射层不用管
美团  ② queryListAndTag   过滤 roomCategory === 2     → ③④入参干净 → 映射层不用管
```

②的 `logicRoomRelations[].roomBaseInfo` 里**就有 `roomCategory`**（踩点样本 `房型踩点.md:5502`），
与 `roomId` 一一对应。按它过滤时 `roomIds[]` 与 `goodsIds[]` 在同一次遍历里同时被筛掉 ——
**③的价格不需要再过滤一遍**（`goodsId` 是商品粒度，钟点房商品是独立 `goodsId`，传什么回什么）。

⚠️ **④仍需响应侧判据**：即使只传日历房的 `roomId`，响应仍会夹带该房型的钟点房那一行
（上面那个"两副身份"就是这么来的）。这是接口行为，不是设计选择。

| 层 | 过滤 | 防什么 |
|---|---|---|
| ②组参 | `roomCategory === 2` 排除，缺失保留 | 钟点房的 roomId 与 goodsId 都不进③④入参 |
| ④响应展平 | `roomCategory !== 1` 丢弃，缺失也丢 | 传进去一个 roomId、返回来两行 |
| ③响应 | 不需要 | goodsId 粒度，传什么回什么 |
| 映射层 | 不需要 | 与 `ctrip-cells.ts` 一致 |

⚠️ ②与④的缺失处置**方向相反**，有意如此：②是房型清单（一个房型一条记录，判不出类别多读一个无害），
④是同一 ID 多行（判不出类别时保留，可能把钟点房写进日历房的格子）。

⚠️ 被否决：把 `roomCategory` 并进 `SnapshotKey`。那要改 DB 唯一键并做 migration，且 `SnapshotKey` 是**渠道无关**的结构 —— 为一个渠道改公共模型，而携程/抖音有没有对应维度还未知，加了也填不了。

业务向的总结见同目录 `房型过滤说明.md`。

⚠️ 抽取时机选在本次：回读有 22 项单测守着，抽完跑一遍行为不变就说明抽对了。等两份逻辑漂了再抽，要同时改两边。

### 4. 扫描目标：遍历凭证，门店清单随登录记录

> 📌 **2026-09-21 修订**：本决策最初是「遍历凭证下**已绑定的门店**」（查 `ota_hotel`）。
> 真机发现那会让「用户登录了却什么都不扫，还得手动绑店」。已改为下述方案，
> `OtaHotelRepository.listByCredential` 与 `meituanPartnerIdOf` 随之删除。

Change B 决策 2 的理由（「门店上下文完全由 cookie 决定，一个凭证天然对应一家店」）对美团不成立。

```
携程   凭证 ──────────────► 1 个目标   otaHotelId = credentialExtra.masterHotelId
美团   凭证 ──┬── 门店 A              ⚠️ 美团没有 masterHotelId
              ├── 门店 B              取自 credentialExtra.pois（登录时探测写入）
              └── 门店 C
```

**门店清单在登录时记录**：`meituan/discovery.ts` 读完账号身份后再调一次 `poiInfos`，
把 `{ poiId, otaPartnerId, poiName }` 写进 `credentialExtra.pois`。探测到几家写几家。

⚠️ **为什么不查 `ota_hotel`**：那张表存的是**绑定关系**（用户当场确认过是哪家店），
而扫描要的是**取数入参**（这个账号能看到哪些店）。走绑定关系的话，用户登录了却没绑店
就什么都不扫 —— 而美团登录后本来就能静默取到门店清单。

```
ota_hotel                 用户确认过的绑定      ← 绑定流程写（hotel-prob.ts 那条路）
credentialExtra.pois      账号名下的门店清单    ← 登录时探测写（discovery.ts）
```

两者同源（都调 `poiInfos`）但去向不同，互不替代。`split-ota-hotel-prob-feature`
决策 3 的边界仍然成立。

⚠️ **其余三条链路的 `otaHotelId` 都从报文里取** —— 改价上报、回读、自然读，用户的操作
本身带着「他在哪家店」这个上下文。只有扫描由定时器触发、没有报文，才需要登录时记下来。

⚠️ **探测失败时保留已有清单**（`ota-credential-service.ts` 的 `keepDiscoveredPois`）：
`credentialExtra` 更新是整体替换，而探测失败返回空数组 —— 两者相乘会让一次网络抖动
抹掉已有清单，扫描静默停摆到下次**成功**登录。

⚠️ `masterHotelIdOf() === null → continue` 那一行当前会把全部美团凭证静默跳过。
按渠道分流：携程走 masterHotelId，美团走 `credentialExtra.pois`。

⏸️ 本功能上线前登录的账号需要**重新登录一次**才会有 `pois`（不做回填）。

### 5. `ScanTarget` 扩展与 `InventoryScan` 签名

美团取数需要 `partnerId`，而它是渠道专有知识。两个选择：

| | 给 `ScanTarget` 加具名字段 | **加渠道专有上下文袋** |
|---|---|---|
| 形状 | `partnerId?: string` | `channelExtra: JsonObject` |
| 加抖音时 | 再加一个可选字段 | 不动 |
| 类型安全 | 调度层看得见渠道字段 | 渠道自己解，调度层不认识 |

**采用后者** —— 与既有 `bindExtra` / `credentialExtra` 同一手法，且调度层「不认识任何渠道」的性质得以保持。

```ts
export type ScanTarget = Readonly<{
  channel: ChannelId;
  partitionName: string;
  /** 归一后的门店 ID。携程取凭证 masterHotelId；美团取绑定的 poiId。 */
  otaHotelId: string;
  /**
   * 渠道专有的取数上下文。**调度层原样透传，不解读**。
   * 美团：`{ otaPartnerId }`（来自 `ota_hotel.bind_extra`）。携程：`{}`。
   */
  channelExtra: JsonObject;
}>;

export interface InventoryScan {
  scan(
    partitionName: string,
    windowDays: number,
    channelExtra: JsonObject,   // ← 新增第三参
  ): Promise<InventoryScanOutcome>;
}
```

⚠️ 携程实现忽略第三参即可，无行为变化，但**签名变更要同步改携程的实现与测试**。

### 6. 分流标记：两类行合成一个 rows 数组

`InventoryScanOutcome.rows` 是扁平数组，③④两类行要能被映射侧分开 —— 照携程 `__snapshotKind` 的既有手法：

```ts
// channels/meituan/inventory-scan.ts
export const MEITUAN_SCAN_KIND_MARKER = '__snapshotKind';   // 'price' | 'roomStatus'
```

⚠️ 与 `inventory-snapshot/meituan-cells.ts` 里的同名常量**必须逐字符相同但不能 import**（eslint 禁止 `channels/` 依赖 `inventory-snapshot/`）。照携程的先例，由一条跨模块断言测试钉住 —— 不一致时价格格子会静默消失，日志上看不出任何异常。

### 7. contentHash 字段集

口径照 `ctrip-cells.ts`：`itemData` 宽（整行原样，便于排查），`contentHash` 窄（只取事实字段，避开回显参数与渠道内部字段）。

| itemType | 参与 hash 的字段 | 不参与 |
|---|---|---|
| `roomStatus` | `roomStatus` `limitType` `limitRemain` `remainCount` `usedCount` `invSwitch` | `containerId`（渠道内部）`shareType`（未验语义）`date`（已在 key 里） |
| `price` | `originPrice` `salePrice` `basePrice` `subRatio` | `subPrice`（= salePrice × subRatio，冗余）`date` |

⚠️ **顺序即拼接顺序，不得改动**（改了会让全部既有基线 hash 失效，下一轮把整个窗口判成变更）。加字段追加到末尾。

⚠️ **金额不转换单位**：渠道给的是「分」的字符串，原样存。转成数字或元等于在客户端复刻渠道语义，`ctrip-cells.ts` 已记过这个教训。

### 8. 自然读基线接线

美团 adapter 当前无 `isReadEndpoint` / `onReadResponse`，一格基线都没有。本次补上，拦③④两个端点。

```
用户翻价量态日历 → 页面自己发 ③/④ → CDP 拦到 → onReadResponse → 同一个 mapper → 基线
```

⚠️ **必须与扫描共用同一个 mapper**（`types.ts:160-165`）。两处注册都要加：

```
composition/app-scope.ts    mappers Map     ← 扫描链
composition/window-scope.ts snapshotMappers ← 自然读链
```

漏一处的失效方式：两条路径写出不同格子，扫描反复报差异。

⚠️ 自然读拦到的③响应**含 `goodsStatusMap`**，但按决策 3 只取 `goodsPriceMap`。映射侧对③只产 price 格。

### 9. 取数走 `session.fetch`（待验证）

照 Change B 决策 1，走主进程 `session.fetch` 而非页面 —— 不依赖标签页、不碰 cookie 字符串、不被自己的 CDP 拦到。

### 9.1 ✅ 连通性已真机验证通过（2026-09-21）

**不需要降级方案。** 门店 1834077877，两轮对照：

| | 标签页**开**（11:52） | 标签页**关**（11:58） |
|---|---|---|
| partition | `05e7daf8` | `74fbe46d`（期间重新登录，**全新 cookie jar**） |
| ① poiInfos | `code 10000`，1 家门店，带 partnerId | 同 |
| ② queryListAndTag | `code 10000`，6 realRooms / 9 logicRooms / 24 goods | **逐项相同** |
| `roomCategory` | 6 日历 / 3 钟点 / **0 缺失** | **逐项相同** |

房型结构逐项相同 —— **cookie jar 不受标签页状态影响**。第二轮换了 partition 仍一致，
是比携程那次（同 partition 逐字节相同）更强的证据。

**只需那五个头**：`M-APPKEY` / `logintype=Epassport` / `locale=zh-CN` / `X-Requested-With` /
`Referer`。**无签名头、无 `mtgsig`** —— RPA 侧走页面内 `browser_post_json`，从未验证过
非页面上下文，这条是本次新得到的结论。

**✅ 不被自己的 CDP 拦到**：探针窗口内基线库零写入，决策 1 的第三条理由对美团同样成立。

### 9.2 ⭐ `roomCategory` 的实证 —— 源头过滤不是可选项

```
logicRooms 9 = category1 6（日历房）+ category2 3（钟点房）
categoryMissing 0
```

**9 个逻辑房型里 3 个是钟点房，占三分之一** —— 不是边缘情况。不过滤的话这 3 个房型
的数据会直接混进基线。`categoryMissing 0` 说明该字段在真实数据里稳定存在，不是可选字段。

同时验证了 ID 空间的规模差异：**6 物理房型 → 9 逻辑房型 → 24 售卖商品**。

### 10. 失效判据：美团内部共用，不跨渠道抽取

照 Change B 决策 8.5。美团回读已有一套判据（`code !== 10000` / 401 / 403，刻意不判 HTML 登录页），扫描**复用它**，抽成 `channels/meituan/session-expiry.ts` 同目录模块，不上升到 `channels/` 顶层。

⚠️ 但扫描的语境与回读不同，有一处要重新判断：回读发生在用户刚操作成功的标签页里（所以「200 + 登录页 HTML」可以不判），**扫描发生在用户可能几天没登录的时候** —— 这正是携程那套四形态判据的来源语境。

✅ **2026-09-21 拿到了第一个失效样本**：一个已失效的凭证返回

```
status 200   contentType application/json   bodyLength 34   code 606
```

**不是 HTML 登录页，是 200 + JSON + 业务码**。所以携程那套「200+登录页 HTML」的判据
对美团确实不需要（决策 10 原本的判断成立）。

⚠️ `606` 目前只有这一个样本，**不把它硬编码成「失效」**：既有判据 `code !== 10000
→ PARSE_ERROR` 已经覆盖，够用。等积累更多码值再决定要不要细分 —— 现在细分等于拿
一个样本去猜整张码表。

⚠️ 这次同时验证了「一个账号失效不影响其余账号」：两个凭证同一轮里一败一成。

### 11. 文件清单

```
main/
├── channels/
│   ├── types.ts                          ← InventoryScan 加第三参
│   ├── inventory-scan-dispatcher.ts      ← ScanTarget 加 channelExtra
│   ├── registry.ts                       ← scanFetcher 类型泛化 + 美团注册 inventoryScan
│   ├── ctrip/inventory-scan.ts           ← 跟随签名变更（忽略第三参）
│   └── meituan/
│       ├── inventory-scan.ts             ⭐ 四步取数
│       ├── inventory-scan-payload.ts     ⭐ 上报体规格（RMS 对接读这份）
│       ├── room-status-endpoint.ts       ⭐ ④的端点知识，回读与扫描共用（决策 3.1）
│       ├── session-expiry.ts             ← 从 inventory-readback.ts 抽出，美团内部共用
│       ├── inventory-readback.ts         ← 改为 import 上面两个，收窄逻辑保留
│       └── amount-change-adapter.ts      ← 加 isReadEndpoint / onReadResponse
│
├── inventory-snapshot/
│   └── meituan-cells.ts                  ⭐ 行→格子映射（两条路径共用）
│
├── database/ota-hotel-repository.ts      ← 加 listByCredential
├── composition/app-scope.ts              ← listTargets 按渠道分流 + mappers/reportBuilders 加美团
├── composition/window-scope.ts           ← snapshotMappers 加美团
└── app-config/defaults.ts                ← channels.meituan
```

⭐ = 新写的文件（`room-status-endpoint.ts` / `session-expiry.ts` 是从回读抽出，行为不变）。

### 12. 服务端对接

⚠️ `inventoryScan` 端点已由携程那次引入，服务端已需为 `(ctrip, inventoryScan)` 写 Translator。美团是 `(meituan, <新端点标识>)` —— **服务端未就绪时 desktop 照发、服务端回 `PARSE_FAILED`/`SKIPPED`，那是 `code=0` 的正常响应，desktop 这侧看不出任何异常**。

所以：产出 `服务端需求.md`。

> 📌 **2026-09-21 修订**：原文是「确认就绪前先只写基线不上报（摘掉 report 回调）」。
> **已改为直接发**（用户决定）。理由：摘掉的收益不大 —— desktop 侧的日志两种做法
> 都一样看不出服务端消费得对不对，要验证得去服务端查台账，而那与 desktop 发不发无关；
> 摘掉反而要在验证上报链路时改回来重跑一轮。
>
> ✅ 真机验证了这个决定是对的：正因为发了，才暴露出服务端 Translator 未就绪
> （`rmsStatus: 'PARSE_FAILED'`）。摘掉的话这轮什么都验不出来。

⚠️ 另需核对 `change_type` 列宽 —— 美团回读那次因 `VARCHAR(16)` 装不下 17 字符的 `"inventoryReadback"` 导致 500 且数据 100% 丢失（见 `add-meituan-inventory-readback/STATUS.md`）。本次的 `changeType` 沿用 `inventoryDiff`（9 字符），但要确认那条 DDL 是否已在生产执行。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **`session.fetch` 发美团被拒** —— 整个取数路线的前提 | 决策 9，第一个任务就验；降级借标签页并回写 spec |
| 每店 4 次请求，多店账号一轮耗时长 | 串行 + fixed-delay 自我重排（不叠加）；真机观察后调 `idleMs` |
| ②的房型清单分页未处理，大店漏房型 | 踩点 22 goods 单页足够；日志记条数，明显少于后台时再补分页 |
| 两处 mapper 注册漏一处 | 决策 8；跨模块断言测试钉住 marker |
| 绑定关系过期，partnerId 对不上 | 决策 4 的①校验；对不上则跳过并记 warn |
| 周期性外部请求触发风控 | 读接口本就是页面高频调用的同一批；默认关，逐店灰度 |
| 服务端 Translator 未就绪，上报静默沉淀 | 决策 12；先只写基线 |

## Migration Plan

纯新增，不改表结构。

| 阶段 | 内容 | 回滚 |
|---|---|---|
| 1 | ⚠️ `session.fetch` 连通性验证（**阻塞后续**） | 无代码 |
| 2 | 公共形状调整（`ScanTarget` / `InventoryScan` 签名 / repository） | 携程行为不变，测试守住 |
| 3 | 美团取数 + 映射 + 自然读接线 | 不注册即不扫 |
| 4 | 上报接线 | 关渠道开关即停（`channels.meituan.enabled`） |
| 5 | 真机验证 | 关渠道开关 |

**开关**：`channels.meituan` 默认开启（受总闸约束，而总闸默认 `false`），与携程同口径。

## Open Questions

- **美团失效时返回什么形状** —— 决策 10，待真机观察，不影响任务拆分
- **②是否需要分页** —— 待真机看条数
- **一轮多店的实际耗时** —— 决定是否要把美团的 `idleMs` 单独配置
