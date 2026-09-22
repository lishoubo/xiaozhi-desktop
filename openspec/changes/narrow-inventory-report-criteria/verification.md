# Verification

## Result

**desktop 侧全部通过；服务端侧无法验证（阻塞在 Translator 未就绪，非本次引入）。**

房量收窄按设计生效，**两个方向都有真机实证**：用户改房量能精确报出（#10），
房量噪音被静默滤掉（#13）。启动首轮不再刷屏。

## Evidence

### 自动化

- `npx vitest run`（apps/desktop）：**1253 passed / 1 failed**
  - 唯一失败 `server-client-config.test.ts` 的 `__SERVER_ORIGIN__ is not defined` 是
    **既有问题**：把本次改动 `git stash` 后重跑，失败完全相同。
  - 新增覆盖：`quantity-reading`（16）、`inventory-report-gate`（19）、
    `scan-to-report`（27，含基线新鲜度 8 条与链路 ID 2 条）、`snapshot-diff`（10）。
- `npx tsc --noEmit`：本次改动的文件**零错误**（残留 6 条均在 `renderer/components/ui/**`
  与 `tests/e2e/config/**`，改动前后一致）。
- `npx eslint src/`：通过，含分层约束。

### 真机（2026-09-22，dev 环境，4 个扫描目标）

| # | 场景 | 结果 |
|---|---|---|
| 1 | migration 10 应用 | ✅ 16:12:59 自动应用（库中 applied_at 记的是 UTC 08:12:59），`room_name` 列建立 |
| 2 | 房型名落库 | ✅ 新扫描行 100% 有名字；旧行为 NULL（不回填，符合设计） |
| 3 | 携程房型名 | ✅ `云絮密语房<无早>` / `<单早>` / `<双早>` |
| 4 | 美团两个 ID 空间取名正确 | ✅ 房态取 `roomName`（`云享三人间`）、价格取 `goodsName`（`云享三人间-不含早-…`） |
| 5 | 既有基线未失效 | ✅ 加 `room_name` 后首轮无全窗口误报 |
| 6 | dev 日志落到环境目录 | ✅ `~/Library/Logs/小智酒店管家[开发]/staff/`；旧目录 17:48:44 停写，无双写 |
| 7 | 启动首轮跳过比对 | ✅ 4 个门店全部 `reason: 'first-round'`、`baselineAgeMs: null`、零上报 |
| 8 | 跳过时基线照写 | ✅ 同轮 `Snapshot cells flushed` 全部落库 |
| 9 | **次轮恢复比对** | ✅ 17:59 打出 `compared` —— 证明「跳过也更新时刻」正确，不会连续跳过 |
| 10 | **改房量能报出** | ✅ 见下 |
| 11 | traceId 串全链路 | ✅ `4f9af53e` 贯穿取数 → 上报 → RMS 响应 |
| 12 | 日志按 itemType 拆开 | ✅ `changed: { roomStatus: 3, price: 0 }` + `suppressed` |
| 13 | **⭐ 房量噪音被滤掉（`suppressed > 0`）** | ✅ 19:06 与 19:51 各一次：`changed{roomStatus:1} → reported{roomStatus:0}`、`suppressed: 1` |

#### ⭐ #10 改房量的完整证据

用户在携程后台把 `1569052074`（云享三人间`<无早>`）2026-09-22 的房量改成 3。

```
改前  totalQuantity: 2, canUsedQuantity: 2    hash = G|T|F|2|2|true
改后  totalQuantity: 3, canUsedQuantity: 3    hash = G|T|F|3|3|true
```

- **只有这两个字段变**，`roomStatus`/`limitSale`/`freeSale` 均未动 → 走判据第 ④ 条
  「限量下总房量变了」。
- 上报 `changed: { roomStatus: 3, price: 0 }`、`suppressed: 0`。
- cells 含 **3 个房型**（`1569052074` / `1569052731` / `1569052831`，即无早/单早/双早）——
  **携程把同一物理房间的三个售卖版本一起改了**，不是重复上报。
- **只含 2026-09-22 一天**，其余 14 天未动。
- 同轮 810 个格子只报这 3 个，其余 807 个零上报。

> 附带实证：`canUsedQuantity` 会随 `totalQuantity` 一起变（2→3 两者同步）。
> `design.md` 的 Open Question 中「携程改房量时两字段如何联动」由此有了直接样本。

#### ⭐ #13 噪音被滤掉的证据（与 #10 形成对照）

美团 `1834077877`，19:06 与 19:51 各出现一次：

```
changed:    { roomStatus: 1, price: 0 }
reported:   { roomStatus: 0, price: 0 }
suppressed: 1
```

噪音来源是 **`remainCount`（预留房量）抖动**：该门店 09-22 的云享三人间
`remainCount=1`、云舒双床房 `remainCount=2`、云朵尊享商务套房 `remainCount=1`，
而它们的配额（`limitRemain + usedCount`）分别恒为 5 / 40 / 22。

`remainCount` 在 `HASH_FIELDS` 里 → 它一变 `contentHash` 就变 → 判成 `changed`；
但判据只看**配额变化**与**售罄跃迁**，两者都没发生 → 不上报。**这正是设计要滤掉的**。

两个方向由此都有实证：

| 时间 | 变化 | 判据 | 结果 |
|---|---|---|---|
| 18:05 | 用户改房量 2→3（配额变了） | 该报 | ✅ 报 3 格 |
| 19:06 / 19:51 | 预留房量抖动（配额没变） | 噪音 | ✅ 零上报 |

### 收窄效果（2026-09-22 16:18，旧版本日志）

隔 17 小时基线的一轮，四个目标：

| 目标 | changed | reported | 说明 |
|---|---|---|---|
| ctrip 131576652 | 4 | **0** | ⭐ 全部是房量噪音，全滤掉 |
| ctrip 122244992 | 21 | 15 | 滤掉 6 |
| meituan 942804505 | 47 | 42 | 滤掉 5 |
| meituan 1834077877 | 211 | 205 | 滤掉 6 |

抽样解析该轮上报体，37/205 条**全部是 `price`，零 `roomStatus`** —— 房量噪音未进入上报。
`changed` 总数大是因为隔了 17 小时价格确有变动（价格不在收窄范围内），
该现象正是后续新增基线新鲜度保护所要解决的。

## ⚠️ 未验证 / 已知阻塞

| 项 | 状态 |
|---|---|
| **`reason: 'stale'`** | ⏳ 需运行期间断档 > 1 小时（睡眠/断网）。仅验证了 `first-round` |
| **携程限量房售罄跃迁** | ⏳ 库中仅 3 行样本，且均为 `roomStatus='N'`（关房），未造出真售罄 |
| **美团预留房（`countType` 152x）** | ⏳ 样本未覆盖，见 `design.md` Open Questions |
| **服务端端到端** | ❌ **阻塞**：`(meituan, inventoryScan)` Translator 未就绪，上报回
  `rmsStatus: 'SKIPPED'`、`rmsItems: 0`（服务端收下即丢弃）。**非本次引入**，
  见 `add-meituan-inventory-scan/STATUS.md:214`。本次已把该响应从 info 升为 warn，
  避免「等于没上报」在日志里与成功长得一样 |

## Review

判据逻辑在真机上暴露并修正了两处**自身设计错误**，均由数据证伪而非推理得出：

1. **携程 `hasInventory` 判售罄是死代码** —— 限量的 291 行中它**恒为 `true`**，
   而为 `false` 的 203 行全部落在不限量（已被前置判断滤除）。原实现 `soldOut` 恒为
   `false`，该判据永不触发。已改判 `canUsedQuantity === 0`。
2. **`remainCount` 是预留房量**（用户指出），非「剩余可卖」，与 `limitRemain`/`usedCount`
   无算术关系。连带推翻旧文档「`remainCount + usedCount` = 物理房量」——
   云舒双床房照此算得 2，而该房型配额为 40。已在五处订正并警示服务端。

另修正一处**模式切换漏报**：限量 ⇄ 不限量切换时一侧 `total` 为 `null`，
原判据会静默丢弃。实测携程有 7 个房型出现过该切换，属真实经营动作，已补判据放行。

`HASH_FIELDS` 与其顺序全程未动，既有基线未失效（#5 实证）。
上报体结构、分派键、cell 字段均未改变，服务端无需改动。
