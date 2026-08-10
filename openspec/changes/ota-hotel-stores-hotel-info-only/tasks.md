## 1. 共享类型

- [x] 1.1 `shared/types/ota-hotel.ts`：`OtaHotel` 删除 `discoveredAt` 字段；确认不引入 `boundAt`/`rmsHotelId`
- [x] 1.2 同文件：删除 `OtaHotelCreateInput` 与 `OtaHotelDiscoveryUpdate`，新增 `OtaHotelSaveInput`（字段与 `OtaHotel` 一致）
- [x] 1.3 同文件：顶部注释「一个 credential 名下探测出的一家可操作渠道酒店」改为反映「用户确认后保存的渠道酒店信息，绑定关系在远端」
- [x] 1.4 确认未误改 `ota_credential` 的 `discoveredAt`（`shared/types/ota-credential.ts`、`shared/browser.ts` 的 `otaCredentialSchema`、`main/database/ota-credential-repository.ts`）——那是不同字段，本次不动

## 2. 数据库

- [x] 2.1 `main/database/application-database.ts` 新增 migration 7 `ota-hotel-stores-hotel-info-only`：`DROP TABLE ota_hotel` 后按 design.md 决策 1 的 DDL 重建（无 `discovered_at`）
- [x] 2.2 保留 `UNIQUE(channel, ota_hotel_id)` 与 `ota_hotel_credential_idx` 普通索引
- [x] 2.3 `main/database/ota-hotel-repository.ts`：`SELECT_COLUMNS` 与 `hotelFromRow` 去掉 `discovered_at` / `discoveredAt`
- [x] 2.4 同文件：新增 `save()`，用 `INSERT ... ON CONFLICT(channel, ota_hotel_id) DO UPDATE SET`（见 design.md 决策 2 的 SQL），冲突时更新 `credential_id`/`ota_hotel_name`/`bind_extra`/`updated_at`
- [x] 2.5 同文件：删除 `create` 与 `updateDiscovery`（方法与接口声明）
- [x] 2.6 同文件：删除 `findByCredentialId`（方法与接口声明）；保留 `findByChannelAndHotelId`

## 3. 探测服务剥离写入

- [x] 3.1 `main/services/ota-hotel-prob-service.ts`：依赖里移除 `repository`，同步更新 `OtaHotelProbFeatureDependencies`
- [x] 3.2 删除早退 `if (this.deps.repository.findByCredentialId(credential.id)) return;`
- [x] 3.3 删除 `outcome.hotels` 的遍历写库块（`findByChannelAndHotelId` / `updateDiscovery` / `create`）及 `randomUUID`、`now` 等仅服务于写库的引入与局部变量
- [x] 3.4 日志 `Hotel probe saved hotels` 改为反映「产出候选」而非「已保存」（如 `Hotel probe found candidates`），保留渠道与数量字段
- [x] 3.5 `main/composition/window-scope.ts`：移除传给 `OtaHotelProbService` 的 `repository: scope.otaHotelRepository`
- [x] 3.6 `main/composition/app-scope.ts` 的 `otaHotelRepository` 本次无消费者，保留装配（Change 3 会用），确认 `npm run lint` 无未使用告警

## 4. 文档注释同步

- [x] 4.1 `main/channels/types.ts`：`HotelProbe` 上方注释中「触发机制、去重规则、落库逻辑对三个渠道完全一致（见 services/ota-hotel-prob-service.ts）」已失效，改写为「探测只产出候选，不落库」
- [x] 4.2 `main/services/ota-hotel-prob-service.ts` 顶部注释中涉及写库与去重的表述同步更新

## 5. 测试

- [x] 5.1 `tests/unit/main/database/ota-hotel-repository.test.ts`：删除两个 `updateDiscovery` 用例与 `findByCredentialId` 用例
- [x] 5.2 同文件：原「同一 (channel, otaHotelId) 二次创建违反唯一索引」用例改为断言 upsert 语义——第二次 `save()` 不报错，且记录 `id` 不变
- [x] 5.3 同文件：新增用例——同一酒店由不同凭证 `save()` 后，`credential_id` 改指新凭证，`ota_hotel_name` 与 `bind_extra` 被刷新，总行数仍为 1
- [x] 5.4 同文件：`create` 相关用例改用 `save()`；断言写入 `bindExtra`，并确认结果不含 `discoveredAt`
- [x] 5.5 同文件：新增用例——同一凭证 `save()` 两家不同酒店，两条记录并存
- [x] 5.6 `tests/unit/main/ota-hotel-prob-service.test.ts`：删除「探测成功后创建新的酒店探测记录」「渠道已有探测记录时跳过，不重复探测」「已存在同渠道同酒店记录时更新而非新建」三个依赖写库语义的用例
- [x] 5.7 同文件：新增「探测成功但不写库」用例——断言 probe 被调用且无任何写入副作用（依赖里已无 repository）
- [x] 5.8 同文件：新增「同一凭证连续两次事件都会执行探测」用例，覆盖删除早退后的重试能力（spec 场景「用户否决后再次探测同一凭证」）
- [x] 5.9 同文件：保留 URL 不匹配、渠道未注册、outcome 非 checked、credential 为 null、probe 抛错五个用例，确认仍通过

## 6. 验证

- [x] 6.1 `npm run check --workspace @hotel-butler/desktop`（tsc + svelte-check）通过
- [x] 6.2 `npm run lint --workspace @hotel-butler/desktop` 通过
- [x] 6.3 迭代期只跑定向测试：`npm run test:unit:desktop -- ota-hotel-repository` 与 `-- ota-hotel-prob-service`
- [x] 6.4 完成态跑一次单元测试全量：`npm run test:unit:desktop`
- [x] 6.5 删除本地 `hotel-butler.sqlite` 后启动应用，确认 migration 7 应用成功、`schema_migrations` 有 7 条、`ota_hotel` 无 `discovered_at` 列（`sqlite3 ... ".schema ota_hotel"`）
- [x] 6.6 确认启动日志中探测链路仍跑通（`Discovery triggered` → `discovery outcome` → 候选日志），且 `ota_hotel` 表保持 0 行（探测不再写库）
- [x] 6.7 将验证证据写入 `openspec/changes/ota-hotel-stores-hotel-info-only/verification.md`
