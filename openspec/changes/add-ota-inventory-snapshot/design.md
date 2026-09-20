## Context

动机见 `proposal.md`。总纲见 `docs/arch/2026-09-20-ota-inventory-snapshot-and-scan.md`。
本节只记影响方案形状的现状。

**既有链路已经提供了一大半**：

| 能力 | 位置 | 本次怎么用 |
|---|---|---|
| 回读（改完主动读回渠道真实状态） | `channels/{ctrip,meituan}/inventory-readback.ts` | 取得的 cells 直接写快照 |
| CDP 请求/响应配对机制 | `channels/amount-save-capture.ts` | 照抄形状，改拦**读**端点 |
| 上报服务（补身份、归一 `masterHotelId`、重试） | `services/amount-change-report-service.ts` | Change B 复用，本次不动 |
| SQLite + 编号 migration（当前 v8） | `database/application-database.ts` | 追加 v9 |
| 运行期可调配置（三层优先级链，已留下发接口） | `main/app-config/` | 加一个配置组 |

**四个硬约束**：

| # | 约束 | 出处 |
|---|---|---|
| 1 | `channels/` 禁 import `services/` `database/` `gateway/` `ipc/` `composition/` | `.eslintrc.json:50-73` |
| 2 | 分层 boundary 必须 lint 强制，不得只写注释 | `specs/desktop-main-layering/spec.md` |
| 3 | 主进程单线程，better-sqlite3 同步 API（全仓 `worker_threads` 命中 0） | 本次调研 |
| 4 | 跨 scope 能力须返回 dispose 句柄，释放走唯一 disposers 链 | `specs/desktop-main-layering/spec.md` |

## Goals / Non-Goals

**Goals**

- 基线快照可独立验证：手动操作渠道页面 → 查库 → 数据正确
- 写入失败不影响任何既有链路（监听、回读、上报）
- 模块边界允许后续把「比对+存储」搬出主线程，而调用方不改
- 配置形状预留分酒店与多时间段，扩展时不改结构

**Non-Goals**

- 定时调度、差异计算的**触发**、差异上报 —— 全在 Change B
- 无标签页时取数（`net.fetch` / 后台隐藏 tab）—— Change B 的待决项
- 抖音（被跟价的一端，与既有两条链路同口径不接入）
- 严格一致性 —— 明确不追求，见决策 6

## Decisions

### 1. 模块四分，依赖方向决定放置位置

```
┌─ 事件驱动（被动）────────────────────────────────┐
│  回读完成 ────┐                                  │
│  自然读拦截 ──┼──→ ❶ 写入队列 ──→ ❷ 对比和存储   │
└───────────────┼──────────────────────────────────┘
                │                     ▲
┌─ 定时驱动（Change B）─────────────┼──────────────┐
│  定时任务 ──→ ❸ 获取数据 ─────────┘ ──→ ❹ push  │
└──────────────────────────────────────────────────┘
```

⚠️ **❷ 是两条链路的交汇点**。事件驱动那条不产生差异 —— 它在**建立基线**，不是对账。
所以 ❷ 的接口必须同时服务两种调用（写入、以及 Change B 的「读基线+比对+写入」）。

| 模块 | 依赖 | 位置 | 能否搬出 main |
|---|---|---|---|
| ❶ 写入队列 | 无（纯数据） | `inventory-snapshot/` | 接缝本身 |
| ❷ 对比和存储 | SQLite | `inventory-snapshot/` + `database/` | ✅ 能 |
| ❸ 获取数据 | `webContents` | `channels/<渠道>/` | ❌ **不能** |
| ❹ push | gateway + JWT | `services/`（复用既有） | ✅ 能 |

### 2. 目录结构

```
main/
├── channels/
│   ├── types.ts                        ← 加 cells 抽取契约
│   ├── inventory-read-capture.ts       ← 自然读拦截机制层（照 amount-save-capture.ts）
│   └── ctrip/
│       └── inventory-snapshot-cells.ts ← 从响应抽 cells（回读与自然读**共用**）
│
├── inventory-snapshot/                 ← 新目录，渠道无关
│   ├── snapshot-write-queue.ts         ← ❶
│   ├── snapshot-diff.ts                ← ❷ 比对纯函数（本期只建，Change B 才调）
│   └── types.ts                        ← SnapshotCell / SnapshotKey 跨层契约
│
└── database/
    └── ota-inventory-snapshot-repository.ts
```

| 判断 | 理由 |
|---|---|
| ❶❷ 单开目录，不塞 `channels/` | `channels/` 禁 import `database/`，放进去够不着；且两者渠道无关。先例：`calendar/`、`error-reporting/` |
| repository 放 `database/` | 既有多数在那儿，app-scope 从那儿 import。`calendar/calendar-repository.ts` 是不一致先例，新增跟多数派 |
| cells 抽取放渠道目录 | 抽取是**渠道语义**（携程读 `roomStatusResult`、美团读 `roomStatusMap`）；回读与自然读拿到同一端点的响应，**必须共用**，否则两条路径抽出的形状会漂 |

⚠️ **eslint 要补一条**（约束 2 要求 lint 强制）：

```
channels/ ─❌→ inventory-snapshot/     （同 database/，走 composition 注入窄回调）
```

否则 `channels/` 里的模块会直接 import 队列，绕过注入把分层吃掉。

### 3. 表结构

```sql
CREATE TABLE ota_inventory_snapshot (
  id                    TEXT PRIMARY KEY,
  source                TEXT NOT NULL,       -- 无枚举约束，加渠道不动表
  ota_hotel_id          TEXT NOT NULL,       -- ⚠️ 取凭证，见决策 5
  ota_physical_room_id  TEXT NOT NULL DEFAULT '',
  ota_sale_room_id      TEXT NOT NULL DEFAULT '',
  item_type             TEXT NOT NULL CHECK (item_type IN ('roomStatus','price')),
  item_date             TEXT NOT NULL,
  item_data             TEXT NOT NULL,       -- 裁剪后的渠道原始 cell（JSON）
  content_hash          TEXT NOT NULL,       -- diff 比它，不比 JSON 字符串
  observed_at           INTEGER NOT NULL,    -- 数据的观测时刻
  source_of_truth       TEXT NOT NULL,       -- readback / page-read / scan
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ota_physical_room_id <> '' OR ota_sale_room_id <> '')
);

CREATE UNIQUE INDEX ota_inventory_snapshot_cell_idx ON ota_inventory_snapshot(
  source, ota_hotel_id, ota_sale_room_id, ota_physical_room_id, item_type, item_date
);
CREATE INDEX ota_inventory_snapshot_scan_idx ON ota_inventory_snapshot(
  source, ota_hotel_id, item_date
);
```

**空值用 `''` 不用 NULL**：SQLite 的 `UNIQUE` 里 `NULL != NULL`，可空列参与唯一键会让
同一格反复 INSERT 新行。代价是「无此维度」与「空字符串」语义被抹平 —— 用 `CHECK` 约束
补回「不得同时为空」。

| 方案 | 结论 |
|---|---|
| 空值归一成 `''` + CHECK | **采用**，简单且唯一键可靠 |
| 生成列 `COALESCE(...)` 做键 | 多一层间接，收益只是保住 NULL 语义，不值 |

**不加外键**：快照是渠道事实，不依赖本地绑定关系。加外键会让未绑定账号的数据落不了库。

**`item_type` 拆两类不拆三类**（房态与房量同格）：两个渠道的读模型里它们本就在同一行
（美团 `roomStatusMap[date]` 含 `roomStatus`+`limitRemain`，携程 `roomStatusResult` 同理），
拆开等于把一行劈成两行存、diff 时再拼回来。与既有 `OtaChangeType` 里 `roomStatus` 不拆同理。

**两个房型 ID 列**适配渠道差异：

```
携程 roomStatus   sale=roomTypeID   physical=''
携程 price        sale=roomTypeID   physical=''
美团 roomStatus   sale=''           physical=roomId
美团 price        sale=goodsId      physical=''      ← 待踩点（Change B）
```

⚠️ **不需要 `payType` 维度**。携程预付/现付是同一批房型按支付方式的**切片**，不是两行独立
数据 —— `inventory-readback.ts:158` 的 `seen` 集合按 `roomTypeID` 单独去重，
`roomPPInfos`/`roomFGInfos` 注释明写「读了会重复」。随售卖模式变的是 `hotelID`（见决策 5），
不是房型。

### 4. 写入队列：投递即返回

```
回读完成 ─┐
自然读   ─┼──→ [ 队列：按格子键去重合并 ] ──→ 单一消费者串行 drain ──→ SQLite
定时取数 ─┘        ▲                              │
              投递即返回                   失败：吞掉 + 记日志，不回传
```

得到三件事：触发方零阻塞、写失败被隔离、写入天然串行。

⚠️ **命名不叫「写线程」**，叫 `SnapshotWriteQueue` —— 否则后来者会以为真有并发去加锁。

⚠️ **按格子键去重合并**，同一格只留最新一份：既防渠道返回膨胀吃光内存，又顺带合并写。

**为什么不开 worker 线程**：

| | |
|---|---|
| 收益 | 只有写库那几毫秒。网络等待**完全不占线程**（`await` 期间事件循环一条指令都不执行）；UI 在**另一个进程**，主进程出错不影响渲染 |
| 代价 | 结构化克隆、双连接 `SQLITE_BUSY`、跨线程调试、token 刷新要跨线程、全仓第一个 worker 无先例 |
| 结论 | **先不开，留接缝**。❶ 投递方不关心谁消费，❷ 进出纯数据 —— 将来换消费者实现即可 |

⚠️ **真正该盯的是解析不是写库**：全量扫描响应远大于回读，几 MB 的 `JSON.parse` 同步不可
中断可达数百毫秒，且开销发生在 Electron 跨进程回传时，**搬 worker 也躲不掉**。

⚠️ **「异步写」在单线程下唯一有意义的形式是分片让出**（每 drain 一批后 `setImmediate`），
不是包 Promise —— better-sqlite3 同步 API，包 Promise 只推迟到下一 tick，阻塞时长一分不少。

⚠️ 一批写入包进一个 `database.transaction()`（压成一次 fsync）；**事务内不得出现 `await`**，
better-sqlite3 事务是同步的，跨事件循环边界行为未定义。

### 5. `ota_hotel_id` 取凭证，不取响应

```
credentialExtra.masterHotelId   ← 取这个（登录酒店）
        ↓ 覆盖
响应里的 hotelID                 ← 丢弃
```

携程同一家酒店**预付与现付是两个不同的 hotelID**，响应里出现的是本次操作那一侧。既有
`resolveOtaHotelId()`（`amount-change-report-service.ts:130`）已经这么做；回读 payload
文件主动留空串并注明「⛔ 绝不能拿回读响应里的 `hotelID` 填」。

**踩过的坑**：值不对 → upsert 撞不上唯一键 → INSERT 新行 → 同一房型两行。

⚠️ **归一不能在写入点做** —— 两条事件路径都在 `channels/`，禁 import `database/`，拿不到凭证。

| 方案 | 结论 |
|---|---|
| A composition 注入的回调补齐（投递方给 `partitionName`，回调查凭证） | **采用**。与既有 `report(observed, partitionName)` 同一手法，不发明新机制 |
| B ❷ 自己查 | ❷ 够得着 repository，但多一个依赖，且把渠道语义漏进渠道无关模块 |

⚠️ **取不到 `masterHotelId` 时拒绝写入 + warn**，不照既有上报那样退回响应原值。
理由：存错会**永久污染基线**，且下次归一正确时变成「另一家酒店」，diff 直接失效。
宁可少一格基线，不留脏数据。

### 6. 不追求严格一致性

**已定：拦住大部分即可。** 落到实现只需一条约束（Change B 消费）：

```
✅  ❸ 取完整批 → ❷（读基线 + 比对 + 写入，一个同步段内完成）→ ❹ 推
❌  ❸ 取一个房型 → ❷ 比一个 → ❸ 取下一个 …
```

一次性完成天然把「回读插队导致基线过期」的窗口压到最小，**不需要版本号、时间戳护栏或锁**。
边取边比会把窗口拉长到整轮扫描时长（几十秒），那才会把用户自己的改动误报成外部变更。

这条约束同时是 ❷ 可搬 worker 的前提：一次吃一批、吐一批。

⚠️ 本期仍记录 `observed_at` 与 `source_of_truth` —— 成本为零，且是排查「这格哪来的」的唯一
依据。本期不据此做覆盖仲裁。

### 7. 自然读拦截

照 `amount-save-capture.ts` 的形状（`Network.requestWillBeSent` → `loadingFinished` →
`getResponseBody`），差别只在拦**读**端点而非写端点，且**不需要请求/响应配对判成败**
（读接口没有「渠道拒绝」这回事）。

⚠️ **CDP 会拦到我们自己注入的 XHR**：`Network.requestWillBeSent` 是渲染进程网络栈层面的
事件，不区分请求由页面脚本还是 `executeJavaScript` 发起 —— 回读的 XHR 跑在页面上下文里，
**大概率被自己的监听拦到**。

队列去重后这不是正确性问题，但仍是浪费（同一份数据投递两次）。**倾向回读 XHR 加标记头，
监听侧见到就跳过**。⚠️ 需真机验证，不可假设 —— 见 Open Questions。

### 8. 配置

现有机制已够用的部分**照抄，不改**：

| 已有 | 本次怎么用 |
|---|---|
| `config: () => appConfig().xxx` 每次调用读一次 | 照抄。构造时取一次会让服务端下发失效 |
| 三层优先级链（默认值 → 下发 → 本地覆盖） | 不动，仍只接默认值层 |
| `mergeConfig` 按 key 遍历 | 不动 |

⚠️ **现有形状是「两层扁平」，撑不住分酒店**（`mergeConfig` 注释明写「只深一层」）。
本期**只预留形状，不实现**：

```ts
type InventoryScanConfig = Readonly<{
  /** 日期窗口。第一期只有 days；多时间段是**加一个分支**，不改字段。 */
  window: { kind: 'days'; days: number };
  //      将来：| { kind: 'ranges'; ranges: readonly { start: string; end: string }[] }
  timeoutMs: number;
  /**
   * ⚠️ 预留，本期不实现。按酒店覆盖上面的值。
   * 合并语义：以 hotelId 为键**逐店深合并**，不是整体替换 ——
   * 需扩展 mergeConfig 深度，届时一并做。
   */
  byHotel?: Readonly<Record<string, Partial<Omit<InventoryScanConfig, 'byHotel'>>>>;
}>;
```

`window` 用**带 `kind` 的联合**：加多时间段是加分支而非改字段，消费方的 `switch` 被类型
系统强制处理新分支，不会静默漏掉。

⚠️ **数组 = 整体替换**的约定要写进 `mergeConfig` 注释 —— 多时间段与房型列表正该整体替换
（不该 concat 两个列表），但不写明后来者会当 bug 改成 concat。

⚠️ **房型信息刻意不预留字段**。还不知道是白名单、黑名单还是优先级排序 —— 预留一个猜错的
形状比不预留更糟，后来者会照着它实现。等需求清楚再加，加字段本就不用改结构。

**谁持有 config**：

```
❸ 获取数据（Change B）  config: () => appConfig().inventoryScan
定时任务（Change B）    同上
❷ 对比存储             ❌ 不收 —— 纯比对，无策略
❶ 队列                 ❌ 不收 —— 纯数据结构
```

⚠️ 别让 ❶❷ 收 config，否则后来者会往里塞策略，把纯模块污染成有状态的。

### 9. 装配

```
app-scope      database 单例
               SqliteOtaInventorySnapshotRepository
               SnapshotWriteQueue          ← 跨窗口共享，生命周期长于单个窗口
    │ 注入窄回调（channels/ 禁 import database/ 与 inventory-snapshot/）
    ▼
window-scope   InventoryReadbackDispatcher 旁加 persist 窄回调 → 投递
               InventoryReadCapture（新）                      → 投递
```

⚠️ 注入的回调签名是**「投递」而非「写入」**，天然不返回写入结果 —— 与决策 4 的隔离目标一致。

⚠️ window-scope dispose 时只摘投递方，**队列本身不停**（Change B 的定时任务还要用）。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **写库阻塞主进程** —— 一次 70~210 行，量级远超既有 repository（单行） | 事务包批 + 分片让出；⚠️ **写入耗时打进日志（行数+耗时），真机跑一段后拉日志分析，用数据决定要不要搬 worker —— 不靠估算** |
| 回读 XHR 被自己的监听拦到，同一份数据投递两次 | 队列按格子键去重，不产生错误数据；标记头方案需真机验证 |
| 自然读只覆盖用户实际翻到的天数与房型，基线长期稀疏 | 本期即此语义（建基线）；Change B 有「无基线的格子只写不报」规则兜底 |
| 渠道改字段导致 `content_hash` 全变，Change B 触发全量误报 | 本期定下裁剪白名单并单测；⚠️ 裁剪粒度是「不解读语义」唯一让步处，见 Open Questions |
| 旧日期的行永久留库无限增长 | 本期实现按窗口清理；⚠️ 清理时机与谁触发见 Open Questions |
| 分层被绕过（`channels/` 直接 import 队列） | eslint 新增禁令，`npm run lint:desktop` 失败 |

## Migration Plan

纯新增，无数据迁移。migration v9 只建表不改既有表。

| 阶段 | 内容 | 回滚 |
|---|---|---|
| 1 | 表 + repository + 队列 + 比对纯函数（全可单测，不依赖真机） | 纯新增文件 |
| 2 | 回读接投递（既有链路加一个窄回调） | 摘掉回调即回到现状 |
| 3 | 自然读拦截 | 不注册即不监听（照 `amountChangeAdapters()` 的可选注册） |
| 4 | 真机验证 + 写入耗时日志分析 | 同上 |

**渠道范围**：本期只接**携程**。携程读接口契约已在 `ctrip/inventory-readback-payload.ts`
踩透；美团的 `price` 侧 ID 空间（`goodsId` vs `roomId`）尚未踩点，留到 Change B 或后续。

## Open Questions

- **裁剪白名单的具体字段**：`item_data` 存哪些字段、`content_hash` 参与哪些。需要真实样本
  支撑 —— 携程有 `inventory-readback-payload.ts` 的实证，美团有 fixture。⚠️ 不影响表结构与
  任务拆分（两者都要求「裁剪后存」），但**实现前必须定**，否则 Change B 的 diff 会误报。
- **过期行的清理时机**：随写入顺带清理 vs 启动时清理 vs Change B 的定时任务清理。倾向随
  写入顺带（无需新触发点），待实现时确认成本。
- **回读 XHR 标记头是否可行**：`executeJavaScript` 注入的 XHR 能否稳定携带自定义头、CDP
  侧能否读到。真机一次即可判定；判定失败则退回「靠队列去重容忍重复投递」，不影响正确性。
