# 携程房态监听技术方案

> 动机见 `proposal.md`。行为契约见 `specs/ota-amount-change-report/spec.md`。
> 本文只讲**怎么落地**：改哪些文件、为什么这么切。

## Context

价量态监听链路已实装三渠道改价（`ota-amount-change-watch`）。机制层与渠道无关，渠道差异全部收在 `AmountChangeAdapter` 一个接口里。本次要验证的正是这个设计：**加一类改动 = 改适配器，机制层零改动**。

现状与本次的关系：

```
browser-manager  ──tab:navigated──►  amount-change-watcher.ts   ✦ 本次不改
                                              │
                                      attach/ │ detach
                                              ▼
                                     amount-save-capture.ts     ✦ 本次不改
                                     （CDP 请求/响应配对、
                                       matchEndpoint 分发）
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   douyin/adapter      ctrip/adapter       meituan/adapter
                   +changeType         🆕 房态端点+分支      +changeType
                                       🆕 room-status-payload.ts
                                              │
                                              ▼
                              services/amount-change-report-service.ts
                                       （补 operationId/submitAt）✦ 不改
                                              │
                                              ▼
                              gateway/rms/...-gateway-http.ts
                                       +changeType 一个字段
```

踩点事实（`docs/踩点/携程/房量01.md`）：

| 项 | 值 |
|---|---|
| 页面 | `/ebkovsroom/inventory/calendar?microJump=true` |
| 端点 | `POST /ebkovsroom/api/inventory/setbatchroombookablestatus` |
| 开/关 | `roomStatus: "G"` 开房 / `"N"` 关房，**同端点同形状** |
| 房型 | `hotelRoomInfoDtoList[].roomTypeID` + 顶层 `originalRoomProductIds[]` |
| 门店 | `hotelRoomInfoDtoList[].hotelID` ✅ 有 |
| 日期 | `dateItemInfoDtoList[].startDate/endDate` |
| 周次 | `weekDayIndex: "1111111"` 位串（与改价老模块同构） |
| 噪音 | `dateItemInfoDtoList[].holidyInfo[]` 节假日字典 5 条 |

两个恰好省事的事实：

1. **页面无需放开** —— 房态页就是改价老模块的日历页，已被 `WATCH_PATHS` 的 `/ebkovsroom/inventory` 前缀覆盖。（对比抖音：房态在 `/hotel/status`，二期必须放开 `WATCH_PATHS`，否则加端点也不会 attach。）
2. **端点不冲突** —— `matchEndpoint` 是 `url.includes(fragment)` 首个命中即返回：

```
/ebkovsroom/api/inventory/batchsetroomprice            改价老模块
/ebkovsroom/api/inventory/setbatchroombookablestatus   房态      ← 互不为子串
/setRCRoomPrice                                        改价新模块
```

## Goals / Non-Goals

**Goals:**

- 携程房态（开房/关房）可被观测并上报
- 上报体自带 `changeType`，下游不必维护 `(source, endpointId) → 语义` 映射表
- `changeType` 的取值设计能容纳「一个端点同时改房态房量」（抖音）而不必再改枚举
- 机制层与 service 层零改动

**Non-Goals:**

- 携程房量 —— 本次踩点没有
- 抖音房态、美团房态房量 —— 留给后续，本次只保证枚举与模型页的切法不挡路
- rms-server 侧接收 `changeType` —— 不在本仓库范围（见 proposal「Impact」）
- 契约 `otaHotelId` 从单值改多值 —— 沿用改价那次的结论：不改，全量在 `changeRaw`

## Decisions

### 决策 1：一个 watcher、一个适配器、多个 endpointId

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 复用现有 watcher + 适配器加端点 | 机制层零改动；页面已覆盖 | 适配器内部要按端点分支 | ✅ 采用 |
| 新建 `RoomStatusWatcher` 并列 | 房态与改价代码隔离 | **两个 capture 争抢同一 tab 的 CDP debugger** | ❌ |
| 新建 `ctrip/room-status-adapter.ts` 独立适配器 | 单文件职责更纯 | `adapters` 是 `Map<ChannelId, Adapter>`，一渠道只能有一个 | ❌ |

第二个方案是硬约束不是风格问题：房态页与改价老模块页**是同一张日历页**，CDP debugger 独占，两个 capture 必有一个挂不上。`watchedEndpoints` 本来就是 Map，机制层天然支持一个适配器多端点（抖音那份注释早已预留）。

### 决策 2：`changeType` 是意向标记，不是精确分类

```ts
// shared/types/amount-change.ts
export type OtaChangeType = 'price' | 'roomStatus';
```

| 方案 | 结论 |
|---|---|
| `'price' \| 'roomStatus'`，roomStatus 含房态+房量 | ✅ 采用 |
| `'price' \| 'roomStatus' \| 'inventory'` 三值 | ❌ 抖音 `batch_save_stock_state_calendar` 一个请求体里房态房量都有，一个端点只能给一个值，必然说不准 |
| `changeType: OtaChangeType[]` 数组 | ❌ 为未来付现在的复杂度；本次携程只可能是单值 |

**契约注释必须写死这一点**：`roomStatus` 只代表「这次是量态类改动」，RMS 要知道究竟改了房态还是房量，必须读 `changeRaw`。不写清楚的失效方式很糟糕 —— RMS 按 `changeType` 分支处理，接抖音时会把请求体里的房量部分整段漏掉，且没有任何报错。

`changeType` 与 `endpointId` 是两个粒度，都要留：

```
changeType   改的是什么      price / roomStatus       RMS 分流用
endpointId   走的哪个接口    setRCRoomPrice 等         RMS 解析 changeRaw 形状用
```

携程改价有新老两套模块、形状完全不同，光有 `changeType: 'price'` 解析不了 —— 所以 `endpointId` 删不掉。

### 决策 3：房态的 `changeRaw` 独立成 `room-status-payload.ts`

| 方案 | 结论 |
|---|---|
| 新建 `ctrip/room-status-payload.ts` | ✅ 采用 |
| 并入 `ctrip/amount-change-payload.ts` | ❌ 那份已 147 行且要讲清新老两套改价模块，再塞房态会变成一份四种形状的大杂烩 |

目录：

```
channels/ctrip/
├── amount-change-adapter.ts     加 1 个端点常量 + parse 分支
├── amount-change-payload.ts     不动（改价两套模块）
└── room-status-payload.ts       🆕 房态
```

### 决策 4：开房关房不拆 endpointId

同端点、同形状，只差 `roomStatus` 字段的 `"G"` / `"N"`。拆成两个 `endpointId` 等于让 desktop 解读渠道语义，与「忠实透传、不解读」的定位冲突。`roomStatus` 原样留在 `changeRaw` 里，开关判定由 RMS 做。

### 决策 5：剔 `holidyInfo`，浅层剔除不够

`holidyInfo` 嵌在 `dateItemInfoDtoList[]` 每一项里，不像改价那三个噪音字段在顶层，不能照搬浅层 `Object.entries` 过滤。要逐项重建：

```ts
// room-status-payload.ts
export type CtripRoomStatusRaw = JsonObject & Readonly<{
  hotelRoomInfoDtoList?: readonly JsonObject[];   // { hotelID, roomTypeID, roomName }
  dateItemInfoDtoList?: readonly JsonObject[];    // { startDate, endDate } —— holidyInfo 已剔
  weekDayIndex?: string;                          // "1111111" 位串
  roomStatus?: string;                            // "G" 开 / "N" 关  ⚠️ 必须保留
  originalRoomProductIds?: readonly unknown[];
}>;

export function toCtripRoomStatusRaw(requestBody: JsonObject): CtripRoomStatusRaw;
//   顶层原样保留（不含改价那三个噪音字段 —— 房态请求体里本来就没有）
//   dateItemInfoDtoList[] 逐项重建，去掉 holidyInfo，其余键原样
```

剔它的理由与改价剔 `reqHead`/`cipher`/`head` 同一口径：与「这次改了哪个房型哪天的房态」毫无关系，是页面渲染日历用的静态字典（中秋/国庆/元旦/春节/清明 5 条），且每条上报都要带一遍。

### 决策 6：成功判定必须按 endpointId 分支

房态响应样本（2026-08-13 补齐，已回填 `docs/踩点/携程/房量01.md`）：

```json
{ "code": 200, "message": "房态设置成功。", "totalCount": 0,
  "returnCode": "200", "data": null,
  "otherData": "房态设置成功。", "extendData": [] }
```

**`data` 是 `null`** —— 房态端点没有内层结果明细，成功信息只在外层与文案字段里。三个端点的响应形状因此两两不同：

| endpointId | 判定依据 |
|---|---|
| `batchsetroomprice` | 外层 `code` + 内层每条 `data.roomPriceSetResults[].resultCode` |
| `setRCRoomPrice` | `resStatus.rcode` + `ResponseStatus.Ack` / `Errors` |
| `setbatchroombookablestatus` | 外层 `code` + `returnCode`，**没有内层明细可看** |

直接沿用现有逻辑会出事 —— 房态响应没有 `resStatus`，会落进老模块分支然后被这一句挡下：

```ts
const data = envelope.data;                    // null
if (typeof data !== 'object' || data === null  // ← 就是这里
    || Array.isArray(data)) return false;      // ❌ 每次房态成功都判成失败
```

（`typeof null === 'object'`，真正拦下它的是 `data === null`。）失效方式是**静默漏报**：日志上与「用户没改房态」一模一样。

**光靠响应形状分不开**「房态成功」与「改价响应结构异常」—— 两者都是 `code: 200` 加一个用不了的 `data`。所以必须让适配器知道自己在判哪个端点：

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 靠响应体形状自辨（现有做法的延伸） | 不改接口 | 上面已证明分不开；且现有实现已在用「有没有 `resStatus`」猜新老模块，再叠一层只会更脆 | ❌ |
| B. `isSuccessful(responseBody, endpointId)` 加参数 | 判定精确，与 `parse` 拿到的信息对齐 | 改接口，三个适配器都要动签名 | ✅ 采用 |

`endpointId` 在机制层本来就有（`amount-save-capture.ts:208` 已算出来），传下去零成本。抖音/美团实现体一行不改，只加形参。

房态分支判定取 `code === 200 && returnCode === '200'`：两个字段携程都给了，双重确认比只认一个稳，也不必去猜 `message` 的中文文案。

### 决策 7：`changeType` 加在哪一层

```ts
// shared/types/amount-change.ts
export type OtaAmountChangeReport = Readonly<{
  operationId: string;
  source: ChannelId;
  changeType: OtaChangeType;   // 🆕 适配器返回，随 Observed 一路带上来
  endpointId: string;
  endpointUrl: string;
  otaHotelId: string;
  changeRaw: JsonObject;
  // …其余不变
}>;
```

`OtaAmountChangeObserved` 是 `Omit<Report, 'operationId'|'submitAt'|身份字段>`，`changeType` 不在 Omit 列表里 → **自动继承**，适配器必须提供。这正是想要的：语义由最懂渠道的适配器声明，service 层不参与。

不放 `changeRaw` 里：那是「渠道原文，desktop 不解读」，塞进我们的解读结果会破坏这个约定。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **只有成功样本，没有失败样本** —— 房态被携程拒绝时的响应形状未知，判定可能过松（把失败当成功） | 取 `code === 200 && returnCode === '200'` 双重确认。⚠️ 判失败时必须记 warn 并带响应体片段：过严的失效方式很隐蔽，与「用户没改房态」在日志上一样。真机验证时若能构造一次失败（如改已售罄日期）应抓样本回填 |
| **rms-server 尚未接收 `changeType`**，字段发出去被忽略 | 加字段不破坏既有报文结构，改价上报不受影响。房态上报在 RMS 侧接上之前不产生效果，属预期 |
| `isSuccessful` 加形参**触及三个渠道适配器**，改价链路有回归风险 | 抖音/美团实现体一行不改，只加形参；改价的既有单测覆盖这条路径，跑通即可确认无回归 |
| 房态与改价共用日历页，**同一个 capture 要同时认三个端点** | `matchEndpoint` 首个命中即返回，三个路径互不为子串（见 Context）。加一条针对该分发的单测 |
| 携程房态一次可能改多家门店（同改价老模块） | 沿用既有结论：`otaHotelId` 取第一家，全量在 `changeRaw`，多店时记 info |

## Migration Plan

纯增量，无数据迁移、无回滚脚本：

1. 契约加 `changeType` → 三个适配器补上 → 类型检查会把所有遗漏点报出来（这是选必填字段而非可选的用意）
2. 携程加房态端点与模型页
3. 回滚 = 撤 commit；上报是单向通知，无落盘队列、无远端状态需要清理

## Open Questions

- **房态被拒绝时的响应形状** —— 只有成功样本。不阻塞实现（判定条件已定，见决策 6），真机验证时若能构造失败场景则抓样本回填。
- **房态是否也有「新模块」对应端点** —— 改价有 `ebkovsroom`（老）与 `rateplan`（新）两套并存，房态是否同样存在新模块入口未知。若存在，表现为走新入口改房态拦不到，届时按改价那次的做法补一个端点常量即可，不影响本次结构。
