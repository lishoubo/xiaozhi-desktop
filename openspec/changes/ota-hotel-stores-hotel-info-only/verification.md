# 验证证据

验证时间：2026-08-08 15:47 – 16:07
验证人：Claude（Opus 5）+ 用户手动操作应用

## 静态检查

| 项 | 命令 | 结果 |
|---|---|---|
| 类型 + Svelte | `npm run check --workspace @hotel-butler/desktop` | ✅ `COMPLETED 828 FILES 0 ERRORS 0 WARNINGS` |
| Lint | `npm run lint --workspace @hotel-butler/desktop` | ✅ 通过，无输出 |

## 单元测试

**定向（迭代期）**：`npm run test:unit -- ota-hotel`

```
✓ tests/unit/main/ota-hotel-prob-service.test.ts (8 tests) 4ms
✓ tests/unit/main/database/ota-hotel-repository.test.ts (6 tests) 9ms
Test Files  2 passed (2)
     Tests  14 passed (14)
```

**全量（完成态，跑一次）**：`npm run test:unit --workspace @hotel-butler/desktop`

```
Test Files  49 passed (49)
     Tests  224 passed (224)
```

全量首次运行时 `tests/unit/main/calendar-database.test.ts` 失败——它硬编码断言迁移数为 6。migration 7 加入后改为 7（`count` 与 `migrationsApplied` 两处），非本次设计问题，属预期连带修改。

### upsert 行为的独立确认

在 better-sqlite3（SQLite 3.53.4）上直接验证 `INSERT ... ON CONFLICT ... RETURNING` 语义：

```
insert: { id: 'a', credentialId: 'cred1', name: '酒店A' }
upsert: { id: 'a', credentialId: 'cred2', name: '酒店A改名' }   ← id 不变、credential 改指
rows:   { n: 1 }                                                ← 未产生第二条
```

确认 design.md 决策 2 的三条保证成立：记录 `id` 不变、`credential_id` 改指最新凭证、总行数不增。

## 运行时验证

用户于 16:00 重启应用（旧实例 PID 72189 已停），16:07 手动关闭。

### migration 7 应用成功

```
version  name
1        create-calendar-storage
2        add-calendar-event-notes
3        create-ota-credential
4        add-ota-credential-channel-account-id
5        create-ota-hotel-prob
6        rename-ota-hotel-prob-to-ota-hotel
7        ota-hotel-stores-hotel-info-only     ← 本次
```

启动日志：`Application database initialized { migrationsApplied: 1, mockEventsSeeded: 8 }`（本次只新增 1 条迁移，符合预期）。

### 表结构符合设计

```sql
CREATE TABLE ota_hotel (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES ota_credential(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  ota_hotel_id TEXT NOT NULL,
  ota_hotel_name TEXT,
  bind_extra TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ota_hotel_channel_hotel_idx ON ota_hotel(channel, ota_hotel_id);
CREATE INDEX ota_hotel_credential_idx ON ota_hotel(credential_id);
```

列清单确认：`id / credential_id / channel / ota_hotel_id / ota_hotel_name / bind_extra / created_at / updated_at`
— 无 `discovered_at`（已删）、无 `bound_at`、无 `rms_hotel_id`（按设计不引入）。

### 探测链路仍跑通且不再写库

三渠道均触发探测，全程零 error / 零 warn：

```
[16:00:18.654] Discovery triggered { channel: 'douyin' }
[16:00:19.745] Douyin discovery outcome { kind: 'found' }
[16:00:43.642] Discovery triggered { channel: 'ctrip' }
[16:00:44.118] Ctrip discovery outcome { kind: 'found' }
```

关闭后最终状态：

| 表 | 行数 | 说明 |
|---|---|---|
| `ota_hotel` | **0** | 探测不再写库（旧代码此时应有 3 条） |
| `ota_credential` | 3 | 凭证写入不受本次影响，`updated_at` 为本次运行时刻（08:00:19 / 08:00:44 UTC = 16:00 本地） |

`ota_credential.updated_at` 落在本次运行时间窗内，证明 credential 写入链路正常执行——即探测**上游**未被破坏，`ota_hotel` 的 0 行是写入时机后移的结果，不是链路中断。

## 未能验证 / 遗留观察

1. **`save()` 无真实调用方**：本次没有任何生产代码调用 `OtaHotelRepository.save()`（写入口由 Change 3 的用户确认接通）。其行为只经单元测试与上述 SQL 直验，未在真实运行路径上跑过。已记入 design.md 风险表。

2. **`XXX discovery saved credential` 日志未出现**：本次运行日志中，`discovery outcome { kind: 'found' }` 之后没有出现 `Ctrip/Douyin discovery saved credential` 行，但数据库 `ota_credential.updated_at` 证明写入确实发生了。该日志位于 `ota-credential-service.ts`（本次未修改的文件），日志缺失与 `ota_hotel` 无关。**未定位根因**，可能与携程 `multiple` 分支提前 return、或 `persistIdentifiedResult` 内部路径有关。属既有行为，不阻塞本次变更，但值得单独排查。

3. **候选日志 `Hotel probe found candidates` 未出现**：与第 2 点同因——探测服务订阅的 `tab:credential-checked` 事件在 credential 判定完成后才广播，上述链路未走到广播点。因此本次运行**未直接观测到**新增的候选日志，该路径仅由单元测试覆盖（`ota-hotel-prob-service.test.ts` 8 个用例）。
