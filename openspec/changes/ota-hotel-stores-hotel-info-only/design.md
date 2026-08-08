## Context

动机见 `proposal.md`。这里只记录约束现状。

**现在的写入链路**（本次要拆掉的）：

```
LoginDetector ──emit──> TabEventBus ──on──> OtaHotelProbService
                                                │
                                                ├─ findByCredentialId() 早退      ← 删
                                                ├─ probe(credential, webContents)
                                                └─ findByChannelAndHotelId()
                                                   ├─ 有 → updateDiscovery()      ← 删
                                                   └─ 无 → create()               ← 删
                                                        写 ota_hotel
```

**关键约束：**

| 约束 | 来源 |
|---|---|
| `channels/` 不得反向依赖 `services`/`ipc`/`composition` | CLAUDE.md 编程约束 |
| `services/` 不得 import `browser/`；实现类只能在 composition root 装配 | `.eslintrc.json` `no-restricted-paths` |
| 广播必须晚于 credential 写库完成 | `login-detector.ts` 时序注释（历史踩坑，携程只导航一次） |
| migration 只前进，drop-and-recreate 是既有先例 | `application-database.ts` migration 6 |
| 绑定关系（OTA 酒店 ↔ RMS 酒店）由远端持有 | 本次确认的领域边界 |

**当前数据**：3 条 `ota_hotel` 记录（携程/抖音/美团各 1），均由探测自动写入，无用户确认背书。用户已确认不保留。

## Goals / Non-Goals

**Goals:**

- 写入时机从「探测完成」后移到「用户确认」
- 探测侧变为纯查询：无写库、无早退，可重复执行
- 本地表职责收窄为「保存酒店信息」，不表达绑定关系
- 仓储写入口收敛为单个 upsert，为 Change 3 准备唯一写入点

**Non-Goals:**

- 不接通绑定流程（intent 上行、候选下行、弹窗、远端同步）——Change 3
- 不动 `TabEventBus` 位置、不改 `channels/` 目录结构——Change 2
- 不改 `ota_credential` 表与三渠道 `discovery` 逻辑
- 不迁移旧数据
- 本地不引入任何绑定关系字段

**本次结束后的中间态**：探测照常执行并产出结果，但结果既不落库也无人消费——`OtaHotelProbService` 探完只记日志。这是有意的中间态，酒店信息在 Change 3 完成前不会被保存。

## Decisions

### 决策 1：本地表只存酒店信息

绑定关系存在于远端，本地表不持有。据此**不引入** `bound_at` 与 `rms_hotel_id`——它们都是绑定动作的痕迹，放在本地会让同一事实出现两个来源。

| 字段 | 处置 | 理由 |
|---|---|---|
| `discovered_at` | **删除** | 「探测即写库」的产物；写入时机后移后无意义，留着会误导为探测仍在写库 |
| `created_at` / `updated_at` | 保留 | 记录生命周期，已在表上，够用 |
| `bind_extra` | **保留原名** | 与服务端字段对齐优先于本地语义自洽；改名会在同一份数据上造出两套叫法 |
| `bound_at` / `rms_hotel_id` | **不新增** | 绑定关系在远端 |

```sql
-- migration 7: ota-hotel-stores-hotel-info-only
DROP TABLE ota_hotel;

CREATE TABLE ota_hotel (
  id             TEXT PRIMARY KEY,
  credential_id  TEXT NOT NULL REFERENCES ota_credential(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel        TEXT NOT NULL,
  ota_hotel_id   TEXT NOT NULL,
  ota_hotel_name TEXT,
  bind_extra     TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ota_hotel_channel_hotel_idx ON ota_hotel(channel, ota_hotel_id);
CREATE INDEX ota_hotel_credential_idx ON ota_hotel(credential_id);
```

相对现状**只删不加**：去掉 `discovered_at`，其余不变。

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. `ALTER TABLE DROP COLUMN` | 保留旧数据 | 旧数据无用户确认背书，是语义污染 | ✗ |
| B. DROP + CREATE（migration 7） | 语义干净；与 migration 6 先例一致 | 丢弃 3 条旧记录 | **✓** |
| C. 不动表结构 | 零成本 | `discovered_at` 成为无人写入的残留列，误导后来者 | ✗ |

### 决策 2：写入口收敛为单个 upsert

`create` 与 `updateDiscovery` 都删除，新增 `save()`——不是两者的重命名，而是新语义下的唯一写入口。

```ts
export type OtaHotelSaveInput = Readonly<{
  id: string;                        // 新建时使用；命中冲突时忽略
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
}>;

export interface OtaHotelRepository {
  /** 唯一写入口：按 (channel, otaHotelId) upsert，由用户确认触发。 */
  save(input: OtaHotelSaveInput): OtaHotel;
  findByChannelAndHotelId(channel: ChannelId, otaHotelId: OtaHotelId): OtaHotel | null;
}
```

```sql
INSERT INTO ota_hotel (id, credential_id, channel, ota_hotel_id, ota_hotel_name, bind_extra)
VALUES (@id, @credentialId, @channel, @otaHotelId, @otaHotelName, @bindExtra)
ON CONFLICT(channel, ota_hotel_id) DO UPDATE SET
  credential_id  = excluded.credential_id,
  ota_hotel_name = excluded.ota_hotel_name,
  bind_extra     = excluded.bind_extra,
  updated_at     = CURRENT_TIMESTAMP
```

| 方案 | 结论 |
|---|---|
| A. 保留 `create` + `update`，调用方先查再决定 | ✗ 两次往返有竞态；调用方要重复写同一段分支 |
| B. 单条 `INSERT ... ON CONFLICT` | **✓** 原子、无竞态、调用方无分支 |
| C. 冲突时报错 | ✗ 用户换账号后无法再保存同一家店；旧凭证失效后该店成孤儿 |

**冲突时改指最新凭证**：同一家店应跟随最近一次成功探测的凭证，否则旧凭证失效后这家店无法再被操作。记录 `id` 保持不变。

### 决策 3：`findByCredentialId` 删除

该方法有两个身份：

| 身份 | 处置 |
|---|---|
| 探测早退条件（`if (findByCredentialId(...)) return`） | **删除调用**——新语义下有害：用户否决后同一凭证永远探不出来 |
| 仓储查询方法本身 | **删除**——早退删掉后本次无任何调用方 |

Change 3 若需要「按凭证列出酒店」，届时按当时语义新增（返回数组）。现在不预留——留一个没有调用方的方法，等到 Change 3 大概率还要改签名。

### 决策 4：探测服务的残留形态

剥离 repository 后 `OtaHotelProbService` 只剩「订阅 → 选 probe → 调 → 记日志」：

```ts
export type OtaHotelProbServiceDependencies = Readonly<{
  tabEventBus: TabEventBus;
  probes: ReadonlyMap<ChannelId, HotelProbe>;
  logger: AppLogger;
  // repository 移除
}>;
```

| 方案 | 结论 |
|---|---|
| A. 本次就把它挪进 `channels/` 并改名 | ✗ 那是 Change 2 的范围，混进来会让两个 change 的 tasks 交叉 |
| B. 本次只剥依赖，位置与名字不动 | **✓** 保持 change 边界干净 |

探测结果本次**无人消费**：`probe()` 返回后只 `logger.info` 记录候选数量，不落库不广播。Change 3 在此处接上 notifier。

### 决策 5：类型变更

```ts
// shared/types/ota-hotel.ts
export type OtaHotel = Readonly<{
  id: string;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
}>;

export type OtaHotelSaveInput = OtaHotel;   // 字段一致
// OtaHotelCreateInput / OtaHotelDiscoveryUpdate 删除
```

`ProbedHotel`（候选，定义在 `channels/types.ts`）与 `OtaHotel`（本地记录）本次**保持分离**——前者是探测产出，后者带 `id`/`credentialId`。`ProbedHotel` 搬到 `shared/` 是 Change 3 的事（届时 payload 契约需要它）。

**注意**：`ota_credential` 也有 `discoveredAt` 字段，本次**不动**。全局搜索 `discoveredAt` 会同时命中两者。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 本次结束后酒店信息不再被保存（探测结果无人消费） | 有意的中间态，已在 proposal 的 Impact 中声明；Change 3 接通。若不接受空窗，Change 1+3 合并发布 |
| `save()` 本次无调用方，upsert 行为未在真实路径验证 | 单元测试直接对仓储断言（新建 / 冲突改指 / 刷新字段三种情况）；真实写入路径在 Change 3 验证 |
| upsert 会改写既有记录的 `credential_id` | 记录 `id` 不变。若远端绑定关系按本地 `ota_hotel.id` 建立则不受影响；若远端记的是 credential，Change 3 需考虑改指时同步远端——**留给 Change 3 处理，本次仅标记** |
| 删除早退后，同一凭证每次导航都会重跑探测 | 探测本身是幂等只读操作；导航后仅触发一次，可接受。若实测有性能问题，Change 3 可用 intent 限定「仅绑定意图才探测」 |
| 现有单元测试大量依赖旧语义 | 按新语义重写，不保留兼容分支 |
| `openspec/specs/local-ota-credentials/spec.md` 中的 `OtaAccount` 命名早已被 migration 6 改为 `ota_hotel`，spec 未同步 | 本次 delta 统一改用「本地酒店记录」表述；归档时合并进主 spec |

## Migration Plan

1. migration 7 随应用启动自动执行（`application-database.ts` 既有机制），无需手工步骤
2. 开发者本地库中 3 条旧记录随 `DROP TABLE` 消失，用户需重新走保存流程（Change 3 完成后）
3. **回滚**：migration 无 down 脚本（既有设计）。回滚需还原代码并删除 `~/Library/Application Support/小智酒店管家/hotel-butler.sqlite`，由应用重建

## Open Questions

无。字段取舍、冲突处理、`findByCredentialId` 去留均已确认。
