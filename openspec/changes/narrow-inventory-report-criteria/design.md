## Context

动机见 `proposal.md` 的 Why。这里只记实现要用到的现状与约束。

**当前链路**（`scan-to-report.ts`）：

```
调度器取回原始行
   ↓ ① 行 → 格子（渠道映射）
   ↓ ② 读基线 → diffSnapshots → 写入     ← 三步之间不得 await
   ↓ ③ changed 全部组上报体
上报服务
```

判据要插在②与③之间。②的「不得 await」约束不变，新增判断是**纯函数**，不引入 IO。

**`diffSnapshots` 当前只比 hash，不交出旧值**：

```ts
// 现状
export type SnapshotDiff = Readonly<{
  changed: readonly SnapshotCell[];   // ⚠️ 只有新格子，旧格子在函数内被丢掉
  added: readonly SnapshotCell[];
}>;
```

「可售从非 0 变为 0」需要旧值，所以这个返回形状必须改。

**两条硬约束**：

| 约束 | 后果 |
|---|---|
| `HASH_FIELDS` 字段集与顺序不可动 | 改了 → 既有基线 hash 全失效 → 下一轮全窗口误报 |
| `added` 只写基线不上报 | 破坏它 → 首轮扫描把整个窗口灌给服务端 |

## Goals / Non-Goals

**Goals**

- 房量噪音（正常销售）不再上报，房态行为完全不变
- 判据可单测，不依赖真机与网络
- 渠道口径集中一处，新增渠道只加一张映射

**Non-Goals**

- 不改上报体结构（服务端解析不动）
- 不改 `contentHash` / 表结构 / 不加 migration
- 不做 `changedFields`（「报变了什么」仍是独立待办，见下方 Decision 5）
- 不区分「关房」与「售罄」—— 依赖未踩实的 `invSwitch` 语义，房态判据维持现状故不需要

## Decisions

### 1. 判据分层：`snapshot-diff` 只管「变没变」，新模块管「值不值得报」

```
snapshot-diff.ts       比 hash → 变了 / 首次见到        渠道无关，不动语义
inventory-report-gate  变了的格子里，哪些值得上报        ← 新增
  └── channel-quantity 各渠道的房量口径                  ← 新增
scan-to-report.ts      调用 gate 过滤后再组上报体
```

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 判据写进 `snapshot-diff` | 少一个文件 | 让渠道无关的比对模块长出渠道知识；`added` 规则与房量规则混在一处 | ❌ |
| 判据写进 `scan-to-report` | 不新增文件 | 该文件是装配粘合件，塞进渠道口径后无法单测 | ❌ |
| **独立 gate 模块 + 渠道口径表** | 纯函数易测；渠道差异集中；两处调用方都不长渠道知识 | 多一层 | ✅ |

### 2. `SnapshotDiff.changed` 带上基线格子

```ts
/** 一格的变化：新值 + 它在基线里的旧值。 */
export type SnapshotChange = Readonly<{
  latest: SnapshotCell;
  /** ⚠️ 必有 —— `changed` 的定义就是「基线里有且 hash 不同」。 */
  baseline: SnapshotCell;
}>;

export type SnapshotDiff = Readonly<{
  changed: readonly SnapshotChange[];   // ← 由 SnapshotCell[] 改成这个
  added: readonly SnapshotCell[];       // 不变（首次见到，无旧值可言）
}>;
```

**为什么不用「把旧 hash 塞进新格子」这类更小的改动**：hash 是拼接串，从它反解不出
`limitRemain` 的旧值；要比数值就必须拿到旧 `itemData`。

### 3. 渠道房量口径：一张表，两个函数

```ts
/** 一格的房量读数。字段取不到时为 null —— 判据遇 null 一律「按变化上报」，不猜。 */
export type QuantityReading = Readonly<{
  /** 总房量（用户设定的配额）。不限量或字段缺失时为 null。 */
  total: number | null;
  /** 可售房量为 0（真售罄）。不限量时恒为 false。 */
  soldOut: boolean;
}>;

export type QuantityReader = (itemData: JsonObject) => QuantityReading;
```

| 渠道 | `total` | `soldOut` | 依据 |
|---|---|---|---|
| 携程 | `freeSale==="T" \|\| limitSale==="F"` 时 null，否则 `totalQuantity` | 不限量时 false，否则 `hasInventory === false` | 先判不限量，再读数字 |
| 美团 | `limitType === 1 ? limitRemain + usedCount : null` | `limitType === 1 && limitRemain === 0` | 配额，非物理房量 |

**⚠️ 美团的坑（两个总量，别选错）**：

```
limitRemain + usedCount  = 用户设的配额   ← 判据用这个
remainCount + usedCount  = 物理房量       ← 不是判据要的
```

真机数据（本地快照库 201 行）：云憩大床房 `limitRemain+usedCount` 在 15 个日期上**恒为 20**，
其中 `usedCount` 从 0 变到 5；而 `remainCount+usedCount` 在 2/3/5 之间跳。12 个房型里 8 个的
配额式总量完全恒定，物理式只有 2 个恒定。

> `meituan-cells.ts:96` 的注释「`remainCount` 与 `usedCount` 一起才能还原出总量」说的是
> **物理房量**，不是配额 —— 两者都对，但判据要的是配额。
> 见 `add-meituan-inventory-readback/服务端需求.md` §4.1（标题即「已修正」）。

**⚠️ 携程：`hasInventory` 单独用会误判，必须先过不限量**

原本设想「`hasInventory` 已内含 freeSale 判读，直接采信即可」，**本地库证伪了这个设想**：

| 样本 | 行数 | `hasInventory` |
|---|---|---|
| `canUsedQuantity=0` 且 `freeSale="T"`（文档明写**有房**） | 68 | **全部为 0** |

也就是说不限量的房型在 `hasInventory` 上与真售罄**长得一模一样**，它并没有替我们判掉这层。
所以必须按文档的判读顺序自己判：

```
freeSale === "T"        → 不限量，soldOut = false，total = null
否则 limitSale !== "T"  → 不限量，同上
否则（limitSale === "T"）→ 限量，才读 totalQuantity / hasInventory
```

⛔ 直接用 `canUsedQuantity === 0` 或裸用 `hasInventory === false`，都会把 68 行不限量房误判成售罄。

**⚠️ 美团为什么不用 `remainCount === 0`**：库里 `remainCount=0` 的 32 行**配额都还有剩**，
不是售罄；真正售罄（`limitRemain=0`）只有 1 行。用 `remainCount` 会误报 32 倍。

**⚠️ 哨兵值**：美团 `limitType=2`（不限量）时 `limitRemain` 是哨兵。文档记的是 998/999，
**本地库实测到 1002**（15/15 行）——说明哨兵不是固定几个值，所以判据**先看 `limitType`**，
不做 `limitRemain !== 999` 这类值比较。

### 4. 判据本身

```
                    ┌─ itemType = price      → 本次不管，维持「变了就报」
一格 changed ───────┤
                    └─ itemType = roomStatus → 房态变了？ ──是──→ 上报
                                                  │否
                                                  ↓
                                              房量判据：
                                              total 变了？        ──是──→ 上报
                                              soldOut 非0→0 跃迁？──是──→ 上报
                                              其余                ──────→ 不报
```

「房态变了？」= 房态相关字段（携程 `roomStatus`；美团 `roomStatus` + `invSwitch`）新旧不等。

| 判据 | 表达式 |
|---|---|
| 总量变化 | `latest.total !== baseline.total`（任一为 null 时按「变化」处理，见 Risk 2） |
| 售罄跃迁 | `latest.soldOut && !baseline.soldOut` |

### 5. 不顺带做 `changedFields`

`add-meituan-inventory-scan/STATUS.md` 里「报变了什么而非现在是什么」是独立待办。本次 gate
虽然手里同时有新旧值，但两件事的**消费方不同**（gate 决定发不发，`changedFields` 决定报文长什么样），
合并会让本次变更同时改动上报体结构，服务端要跟着改。保持本次「只改触发条件、报文不动」。

### 6. 服务端文档：写在本 change 目录下

`服务端需求.md` —— 与既有两份（`add-meituan-inventory-scan/`、`add-ota-inventory-scan/`）同构，
说明计算口径与触发条件。**不改既有两份**，在新文件里指明它是对触发条件的收窄。

## Risks / Trade-offs

**1. 携程不限量房的房量变化一律不报** → `freeSale="T"` / `limitSale="F"` 时 `total=null`
且 `soldOut=false`，这类格子的房量变化不会触发上报（房态变化仍照报）。
**取舍**：不限量模式下携程的房量数字本就不是真实房量（文档：`totalQuantity:0` 不代表没房），
拿它比大小得出的「变化」没有业务含义。本地库这类样本 173 行，`totalQuantity` 只有 2 个不同取值，
本就没什么可报的。

**2. 字段缺失时「按变化上报」而非「按不变忽略」** → 渠道改字段名会导致上报量回升到现状水平。
**取舍**：失效方向朝「多报」而不是「漏报」——漏报在日志上看不出来，多报看得出来。

**3. 美团房态路径的字段集差异** → `goodsStatusMap` 缺 `usedCount`，若某条写入路径用了它，
该格算不出配额。**缓解**：本地库实测两条路径（`page-read` 6 行 / `scan` 195 行）
`usedCount`/`remainCount` **均无缺失**，当前不受影响；Risk 2 的兜底覆盖将来出现缺失的情况。

**4. 上线首轮的口径断层** → 基线里的旧格子是上一版写的，但 `contentHash` 与字段都没变，
比对照常成立。**无需数据迁移**。

**5. 真正的配额变化被漏报的场景** → 若用户把配额从 5 改成 5（无变化）但同时卖出一间，
`total` 不变、未售罄 → 不报。这是**期望行为**，不是缺陷。

## Migration Plan

无数据迁移。`HASH_FIELDS`、表结构、上报体均不变。

| 步骤 | 内容 |
|---|---|
| 1 | 改 `SnapshotDiff` 形状 + 既有单测跟着改（`changed[i]` → `changed[i].latest`） |
| 2 | 新增 gate 与渠道口径 + 单测（用本地库真实样本做 fixture） |
| 3 | `scan-to-report` 接入 gate |
| 4 | 真机跑一轮，确认房量噪音消失、改配额仍能报出 |

**回滚**：gate 是单一调用点，去掉该调用即回到「变了就报」。

## Open Questions

- 携程「用户改总房量」时 `totalQuantity` 与 `canUsedQuantity` 各自怎么动，**没有直接观测样本**。
  本地库能证明 `canUsedQuantity ≤ totalQuantity` 恒成立（684 行相等 / 71 行小于 / **0 行大于**），
  支持「total 是总量」的读法，但这仍是推断。
  **不阻塞**：判据用 `totalQuantity` 做相等比较，即使它的语义是别的，「它变了就报」也不会漏报。
- 美团有**预留房**（`countType` 152x）时三个房量字段如何分配，现有样本未覆盖
  （`add-meituan-inventory-readback/服务端需求.md` 已记为待确认）。
  **不阻塞**：Risk 2 的兜底保证异常形状朝多报方向失效。
