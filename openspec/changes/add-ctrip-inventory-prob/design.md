## Context

动机见 `proposal.md`。需求见 `specs/ctrip-inventory-scrape/spec.md`。本节只记影响方案形状的现状。

**参考实现**：`xiaozhi-rms-workspace/rms-rpa-worker/rms_rpa_worker/adapters/ctrip/inventory.py`（**不是** `order/order_fetch.py` —— 那是订单，另一个网关、另一套成功判据）。

**本仓三个既有 prob 的取数机制各不相同**，本次都不照抄：

| 渠道 | 机制 | 为何不适用 |
|---|---|---|
| 携程 `ctrip/hotel-prob.ts` | 不发请求，纯解析 `credentialExtra` | 房态房量不在凭证里 |
| 美团 `meituan/hotel-prob.ts` | `executeJavaScript` 在页面里 fetch | 依赖标签页开着，违背「后台继续跑」 |
| 抖音 `douyin/hotel-prob.ts` | `executeJavaScript` 点菜单 + CDP 拦响应体 | 同上，且更重 |

要照抄的是它们的**装配形状**，不是取数机制。

**四个硬约束**：

| # | 约束 | 出处 |
|---|---|---|
| 1 | `channels/` 禁 import `services/` `ipc/` `composition/` `database/*-repository` `browser/session-factory` `browser/browser-manager` | `.eslintrc.json:49-73,117-163,245-261` |
| 2 | `session.fromPartition()` 只允许 `browser/session-factory.ts` 调用 | 该文件首部注释 |
| 3 | 跨 scope 能力必须 `attach` 返回 detach 句柄，释放走唯一 disposers 链 | `specs/desktop-main-layering/spec.md:135-146` |
| 4 | 主进程无任何定时调度器可复用（全仓 `setInterval`/`cron` 命中 0） | 本次调研 |

## Goals / Non-Goals

**Goals**

- 抓取不依赖标签页、窗口焦点
- 携程渠道逻辑收在 `channels/ctrip/` 一个目录 + `registry.ts` 一行
- 接口契约与响应字段语义以**可执行规格**形式固化（payload 文件 + 单测），不靠记忆
- 第一阶段结束后，「换成落库/上报」只需替换注入的一个窄回调

**Non-Goals**

- 落库、RMS 上报、写接口（下发房态）
- 其他渠道（美团/抖音）
- 多门店遍历 —— 第一阶段只抓凭证自报的当前门店（见决策 6）
- 金额入库精度处理（只打日志，但字段语义记在 payload 规格里）

## Decisions

### 1. 取数走主进程 `net.fetch`，不借页面上下文

全仓 `net.fetch` 此前只有一处（`server-client/trpc-client.ts` 打自家 RMS），**没有主进程打 OTA 渠道的先例**。本次可以，是因为携程这两个**读**接口无签名头：

| 头 | 读接口是否需要 | 依据 |
|---|---|---|
| `Content-Type` / `Cookie` / `Referer` / `Origin` | 需要 | `inventory.py:122-131` |
| `phantom-token` / `ebk-cid` / `rmstoken` / `x-requested-with` | **不需要** | `docs/携程/调研-修改价格.md:395` 实证；写接口亦然 |

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A 主进程 fetch + 读 partition cookie | 不依赖标签页，满足「后台继续跑」；cookie 读取能力已存在 | 首次由主进程打渠道接口 | **采用** |
| B 借已开标签页 `executeJavaScript` | 有三处先例，天然带齐上下文 | 用户不开携程页就抓不到 | 降级备选 |
| C 后台静默开隐藏 tab | 能保证常驻 | 须过 `OtaTabService` 唯一开口，`channels/` 够不着；长期挂隐藏 tab | 末选 |

cookie 读取**不是新能力**：`SessionFactory.readInjectableCookies(partitionName)` 已存在（`session-factory.ts:100`），实现就是 `session.cookies.get({})` —— 取该 partition 全部 cookie、不过滤、**不需要 webContents**，所以天然满足「用户没开标签页也能抓」。

⚠️ 别把它和 `readCookieSnapshot` 搞混（两条路径的存在理由不同）：

| 入口 | 机制 | 存在理由 | 含 `partitionKey` |
|---|---|---|---|
| `readInjectableCookies` | `cookies.get({})` | 换干净 partition 重开同一账号 | 否 |
| `readCookieSnapshot` | CDP，需 `webContents` | **只为拿 CHIPS 分区键**（RMS 快照契约要求） | 是 |

CDP 那条路是为分区键存在的，**不是因为普通 cookie 取不到**。本次自己发请求，`Cookie:` 头不需要分区键 → 走 `readInjectableCookies` 即可。

唯一待确认的是**携程是否接受这串 cookie**（`usersign` 是 httpOnly，`cookies.get` 取 httpOnly 无碍）。这个在 prob 写完后第一次真机跑即可知，不值得前置一轮临时脚本；若真不被接受则降级 B，接受「只在用户开着携程页时抓」并回写 spec。

### 2. cookie 取得链路

```
OtaCredential.partitionName          ← 会话的唯一权威指针（可变，绑定流程会改写）
        │
        ▼
SessionFactory.readInjectableCookies(partitionName)     ← 已存在；session.fromPartition() 唯一持有者
        │  cookies.get({})，全部 cookie，不需要 webContents
        ▼
toCookieHeader(cookies)              ← channels/ctrip/cookie-header.ts（纯函数，可单测）
        │  "usersign=...; usertoken=...; randomkey=..."
        ▼
net.fetch(url, { headers: { Cookie: <header string> } })
```

⚠️ **2026-08-09 线上事故**：结构化 JSON 整串塞进 `Cookie:` 头 → 携程返回 HTTP 200 + 登录页 HTML → JSON 解析炸。所以**存储形态与请求头形态必须显式转换**，`toCookieHeader` 单独一个纯函数就是为了让这层转换有测试。

注入的窄回调只收 `{ name, value }[]`，不把 `readInjectableCookies` 的 `url`/`expirationDate`/`sameSite`（注入专用字段）漏进 `channels/`：

```ts
// composition 注入给 dispatcher 的形状
type ReadCookiesForRequest = (partitionName: string) => Promise<readonly { name: string; value: string }[]>;
```

cookie 不筛选，整串透传（与 Python 侧一致，最稳）。已知核心票是 `usersign`（形如 `ebk_token_<base64>`），最小集 `usersign`/`logintype`/`randomkey`/`usertoken` —— 先不瘦身。

### 3. 两步请求契约

```
Step 1  POST /ebkovsroom/api/inventory/getRcProductList      body: {}
        │   酒店上下文完全由 cookie 决定，无入参
        ▼   data[] 物理房型层  ──→  .roomInfos[] 售卖房型层 ← 只读这层
        │       ⚠️ 物理层 hotelID 恒 0、basicRoomStatus 全 null，不可用
        │       ⚠️ roomPPInfos/roomFGInfos 是同批数据按支付方式切片，读了会重复
        │   过滤 hourRoom===true / advanceSale===true  ← 必须在去重前
        │   按 roomTypeID 去重，保留 rateCodeID（缺它 roomPriceResult 为空）
        ▼
Step 2  POST /ebkovsroom/api/inventory/getRoomInventoryInfo
        │   body: { hotelRoomInfoDtoList[6字段], startDate, endDate, showRoomInventory, showRoomPrice }
        ▼   data.roomStatusResult[]           ← 扁平行，房型数 × 天数
            data.roomPriceResult.roomPriceInfo[]  ← 同样平铺
                     │
                     └─ 按 `${roomTypeID}:${effectDate}` 自建索引合并
```

无分页。超时 30s。顶层 `code === 200` 才算成功（≠ 订单接口的 `ResponseStatus.Ack`）。

`hotelRoomInfoDtoList` 每项 6 字段：

```ts
type CtripRoomRef = {
  hotelID: number;      // 售卖层门店 ID，非账号级 otaHotelId
  roomTypeID: number;
  roomName: string;
  payType: 'PP' | 'FG'; // 预付 / 现付
  roomClass: number;    // 缺省回落成 roomTypeID
  rateCodeID: number;
};
```

抓包里前端另发 `showLadderPolicy`/`isPreTaxPrice`/`saleChannel`/`currency`，生产代码全省略且跑通 —— 不带。

### 4. 房态房量字段语义（反直觉，必须单测）

```ts
type CtripInventoryCell = {
  roomTypeID: number;
  effectDate: string;              // "2026-09-15"
  roomStatus: 'OPEN' | 'CLOSED';   // 映射自 "G"|"N"|"Y"
  canUsedQuantity: number | null;
  totalQuantity: number | null;
  limitSale: boolean;              // "T" → true
  price: number | null;            // 独立于房态，缺失就是 null
};
```

| 原值 | 含义 | 映射 |
|---|---|---|
| `"G"` | 有保量开放 | `OPEN` |
| `"N"` | 系统关房 | `CLOSED` |
| `"Y"` | 手动关房 | `CLOSED` |
| 其他/缺失 | 未知 | **`CLOSED`** + warn |

**未知一律 CLOSED**：误报开房的代价（超售）远大于误报关房。

⚠️ **`limitSale:"F"` 时房量 0 不代表没房**。`docs/携程/踩点/房态2.md` 有 4 个人工标注样本，直接作为单测用例：

| 页面显示 | limitSale | freeSale | total | canUsed | 备注 |
|---|---|---|---|---|---|
| 限量 剩7 | `"T"` | — | 9 | 7 | |
| FS | `"F"` | `"T"` | 0 | 0 | `hasInventory:false` 但**有房** |
| FS 剩1 | `"F"` | — | 1 | — | `roomStatus:"N"` |
| 不限 | `"F"` | — | 0 | — | `hasInventory:false` |

**房态与价格路径独立**：`roomPriceResult` 可能不覆盖 `roomStatusResult` 全部 cell（关房日无价）。按「无价即丢」会导致房态刷不进去（`price_readback.py:234-283` 记载过）。所以合并时以房态行为骨架，价格缺失填 `null`。

金额单位是**元的浮点**（不是分），取 `price` 不取 `originalPrice`（后者偏低约 2%）。第一阶段只打日志，不做精度转换。

### 5. 登录失效四形态

携程失效**不保证**返回 HTTP 错误码。四种形态缺一不可：

| # | 形态 | 判据 |
|---|---|---|
| 1 | HTTP 200 + JSON | body `code ∈ {401, 300, -1}` |
| 2 | HTTP 200 + `text/html` 整页登录页 | 正文前 8192 字符 lowercase 后含 `"islogin":false` / `htl-ebk-login-web` / `qrcodeloginswitch` 任一 |
| 3 | HTTP 200 + 授权失败体 | `{"error":"invalid_grant",...}`，无 `code`、非 HTML |
| 4 | HTTP 401 | status |

⚠️ 形态 2 靠 `<title>` 和域名**判不出来** —— 登录页 title 是「携程酒店商家管理后台」这种正常文案，且全文不含 `passport.ctrip.com`。

⚠️ **403 ≠ 401**：403 是身份认了但没权限，重登解决不了，归成 `COOKIE_EXPIRED` 会掩盖真因。`403` 也不在 body-code 词汇表里。

```ts
type CtripInventoryFailure =
  | { reason: 'COOKIE_EXPIRED' }    // 上述 4 种形态
  | { reason: 'FORBIDDEN' }         // 403，单列
  | { reason: 'PARSE_ERROR' }
  | { reason: 'NETWORK_ERROR' }
  | { reason: 'UNEXPECTED' };
```

⚠️ **空结果必须区分「失败」与「确实为空」**：Python 侧漏判形态 3 曾导致「被当成这店没数据 → 全店记录软删 → 联动房型集体不跟价」。本次虽不落库，`Outcome` 也要用 tagged union，不用「空数组表示失败」。

### 6. 抓哪个门店：第一阶段只抓凭证自报的当前门店

两个口径不能混：

| 口径 | 来源 | 含义 |
|---|---|---|
| 凭证侧 | `credentialExtra.masterHotelId`（旧 `hotelId`），`-1`/`0`/`''` 表示无 | 账号自报的当前门店 |
| 绑定侧 | `ota_hotel` 表 | 用户确认过的门店 |

Step 1 的 body 是 `{}` —— **门店上下文完全由 cookie 决定**，所以第一阶段天然就是「抓该会话当前所在门店」，不需要遍历。

`OtaHotelRepository` 只有 `save` / `findByChannelAndHotelId`，**缺 list 查询**。遍历已绑门店要扩接口 —— 留到需要多门店时再做，本次不动。

### 7. 装配形状：第四种触发模型，单独一个 dispatcher

现有三种触发模型都是事件驱动，定时是全新一类，不塞进 `HotelProbeDispatcher`（后者还有「没有等待方就不探」的 intent 早退链，与定时语义冲突）：

| Dispatcher | 触发 |
|---|---|
| `HotelProbeDispatcher` | intent 驱动（`tab:credential-checked` + `intent.kind==='bind-hotel'`） |
| `AmountChangeWatcher` | URL / 端点驱动 |
| `OtaReauthDispatcher` | credential-checked 驱动 |
| **`InventoryPollDispatcher`** | **定时** ← 本次 |

```
channels/types.ts
   └── interface InventoryProbe { probeOnce(ctx): Promise<InventoryOutcome> }

channels/ctrip/inventory-prob.ts        createCtripInventoryProbe(logger)
channels/ctrip/inventory-payload.ts     接口契约与字段语义规格（注释+类型，给 RMS 对接看）
channels/ctrip/cookie-header.ts         toCookieHeader 纯函数

channels/registry.ts
   ChannelAdapter += inventoryProbe?: InventoryProbe      ← 可选字段
   inventoryProbes(registry)                              ← 投影，跳过无此能力的渠道
                                                             （照 amountChangeAdapters() 的写法）

channels/inventory-poll-dispatcher.ts
   constructor({ probes, logger, intervalMs, windowDays,
                 listCredentials,   ← 窄回调，composition 注入（绕开 repository 禁令）
                 readCookies,       ← 窄回调，composition 注入（绕开 session-factory 禁令）
                                       实现直接转 SessionFactory.readInjectableCookies，只保留 name/value
                 report })          ← 窄回调；第一阶段实现就是打日志，将来换落库/上报
   start(): Disposable                                     ← 返回 dispose 句柄

composition/window-scope.ts
   const stopInventoryPoll = new InventoryPollDispatcher({...}).start();
   onDispose(stopInventoryPoll);                           ← 唯一 disposers 链
```

三个窄回调是为了绕开 eslint 的 import 禁令 —— 这正是现有 `HotelProbeDispatcher.notify` / `AmountChangeWatcher.report` 的既有手法。

### 8. 调度器：自建，最小实现

无可复用抽象。不引第三方 cron —— 只需要固定间隔。

```
start()
  ├── 立即跑第一轮？→ 否。延迟一个间隔，避免与启动期的登录/发现流程抢资源
  ├── setInterval(tick, intervalMs)
  └── return () => clearInterval(h)

tick()
  ├── listCredentials('ctrip') → 空则直接返回，不发请求
  ├── 每个凭证：inFlight.has(id) ? 跳过这一轮 : 标记后执行
  └── 结束后 if (disposed) 丢弃结果，不投递给已释放的 scope
```

`inFlight` 去重是必须的：5 分钟间隔 vs 30s 超时，慢响应叠加会并发打同一账号。

⚠️ `douyin/hotel-response-capture.ts:184` 有「悬着的 promise 连同定时器被闭包留住」的已知泄漏注释 —— dispose 时必须同时处理 in-flight。

### 9. 日志

沿用既有约定：句子式英文 message + 扁平对象。键名 `channel` / `credentialId` / `hotelId` / `windowDays` / `roomTypeCount` / `cellCount` / `durationMs` / `reason` / `error: safeLogErrorDetails(error)`。

`shared/logging.ts` 的 `redactLogData` 会按 `SENSITIVE_KEY_PATTERN`（含 cookie/token）脱敏，但**不能依赖它兜底** —— cookie 压根不要进日志参数。

第一阶段的 `report` 回调即「打一条汇总日志」，这是本阶段的唯一产出。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **携程不接受这串 cookie**（首次由主进程打渠道接口） | 6.3 真机首跑即可判定；失败则降级方案 B（借已开标签页），并回写 spec 的「不依赖标签页」要求。cookie 能否读到不是风险 —— `readInjectableCookies` 已有且不依赖 webContents |
| 每账号每 5 分钟 2 次请求，长期打在携程上，可能触发风控 | 读接口本就是页面高频调用的同一批；间隔可配置；先只在开发环境跑，观察后再定默认值 |
| 定时器泄漏导致窗口关闭后仍在抓 | 强约束写进 `specs/desktop-main-layering/spec.md`；dispose 句柄接 `onDispose`；in-flight 结果丢弃 |
| 携程改字段/改枚举，静默错判房态 | 未知枚举一律 CLOSED + warn，不静默；payload 规格文件固化契约；4 个真实样本入单测 |
| 第一阶段只打日志，无从验证数据正确性 | 日志汇总里带房型数/记录数/日期窗口，与页面人工核对；踩点样本入单测 |

## Migration Plan

纯新增，无数据迁移。

| 阶段 | 内容 | 回滚 |
|---|---|---|
| 第 1-4 组 | 契约、纯函数、prob（可单测，不依赖真机） | 纯新增文件，删除即回滚 |
| 第 5 组 | dispatcher + 装配 | 从 `registry.ts` 摘掉 `inventoryProbe` 一行即整体停摆 |
| 第 6 组 | 真机验证（含首次连通性判定，见 Risks 第一行） | 同上 |
| 第二阶段（不在本 change） | 落库 / RMS 上报 | 替换 `report` 窄回调 |

**开关**：第一阶段默认**只在开发环境启用**，避免未验证的周期性外部请求进正式包（参考 `2d8794f` 小智平台入口的同类处理）。

## Open Questions

- 间隔 5 分钟与窗口 7 天的最终默认值，待真机观察抓取耗时与携程响应稳定性后定；不影响 spec 与任务拆分（两者都要求可配置）。
- cookie 是否瘦身到最小 4 个字段，待 T1 结果决定；整串透传是安全默认。
