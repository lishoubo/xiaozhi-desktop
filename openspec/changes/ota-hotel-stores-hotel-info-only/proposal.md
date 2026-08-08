## Why

`ota_hotel` 现在是**探测缓存**：`OtaHotelProbService` 探到酒店就直接写库，用户从未确认过（当前库里 3 条记录即是如此产生）。酒店绑定流程要求酒店信息只有在用户从候选中选定后才保存，因此写入时机 MUST 后移到用户确认。本地表只保存**酒店信息本身**——绑定关系（OTA 酒店 ↔ RMS 酒店）只存在于远端，本地不表达。这是「酒店绑定探测流程」三个 change 的地基。

## What Changes

- 探测侧剥离 `OtaHotelRepository` 依赖，`OtaHotelProbService` 变为纯查询、无副作用；探测结果只作候选返回，不落库
- 删除探测早退 `if (repository.findByCredentialId(...)) return;`——该早退在新语义下有害：用户在候选弹窗点「否」后，同一凭证将永远无法再次探测
- **BREAKING** 仓储写入口收敛为单个 `save()`（按 `(channel, ota_hotel_id)` upsert）：删除 `create` 与 `updateDiscovery`；已存在的酒店改指最新凭证并刷新酒店信息
- 删除 `findByCredentialId`（本次无调用方；后续如需按凭证列酒店再按当时语义新增）
- 表结构删除 `discovered_at` 列——该列是「探测即写库」的产物，写入时机后移后不再有意义；`created_at`/`updated_at` 已足够
- **不新增** `bound_at` 与 `rms_hotel_id`：绑定关系在远端，本地表不持有
- `bind_extra` 保留原字段名（与服务端字段对齐），保留 `UNIQUE(channel, ota_hotel_id)`
- 旧数据不迁移（沿用 migration 6 的 drop-and-recreate 先例）

**不在本次范围**：Change 2（TabEventBus 归位、channels 约束固化）、Change 3（intent 上行、候选下行、弹窗、`startBinding`/`confirmBinding` 与远端同步）。本次只把地基换掉，探测结果暂时不落库也不通知——写入口由 Change 3 接通。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `local-ota-credentials`: 酒店记录的**写入时机与职责**变更。现规格多处以「发现即保存 account/hotel」描述持久化（如「保存该酒店及其临时 credential 身份」「系统创建或更新对应的本地 OTA account」「已有分区再次发现酒店 → 新建或更新酒店账号」）；新规格 MUST 改为「探测只产出候选，用户确认后才保存酒店信息」。同时补充：探测不得因已有记录而跳过（支持用户否决后重试）、本地只保存酒店信息不表达绑定关系、同一酒店再次保存时改指最新凭证。

## Impact

| 层 | 影响 |
|---|---|
| `main/database/application-database.ts` | 新增 migration 7（重建 `ota_hotel`，去掉 `discovered_at`） |
| `main/database/ota-hotel-repository.ts` | 写入口收敛为 `save()`；删除 `create`/`updateDiscovery`/`findByCredentialId` |
| `shared/types/ota-hotel.ts` | 删除 `discoveredAt`；`OtaHotelCreateInput`/`OtaHotelDiscoveryUpdate` 换为 `OtaHotelSaveInput` |
| `main/services/ota-hotel-prob-service.ts` | 移除 repository 依赖与全部写库逻辑、移除早退 |
| `main/channels/types.ts` | `HotelProbe` 文档注释中「落库逻辑对三个渠道完全一致」失效，需重写 |
| 单元测试 | 探测服务与仓储的既有用例需按新语义调整 |
| 用户可见行为 | **本次结束后酒店信息不再保存**（探测结果不落库、无弹窗），由 Change 3 接通 |

依赖关系：本 change 与 Change 2 可并行；Change 3 依赖两者。
