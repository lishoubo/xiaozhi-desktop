> 分三块。**踩点已于 2026-08-21 完成（第 4 组），三块均可开工。** 建议仍按 A+B → C 的顺序分两次提交。
> 实现细节见 `design.md`（D1–D8），行为契约见 `specs/ota-amount-change-report/spec.md`。

## 1. A 块：补「统一加减价」端点

- [x] 1.1 `ctrip/amount-change-adapter.ts` 的 `WATCHED_ENDPOINTS` 加一行 `['setUniformRCRoomPrice', '/setUniformRCRoomPrice']`（不含 `soa2/23783`，理由见 D2）
- [x] 1.2 更新该文件头部的端点表格与注释，把房价维护菜单的两个变体都写进去
- [x] 1.3 `ctrip-amount-change-adapter.test.ts` 补：用 `房价维护菜单踩点.md` 的「统一加减价」真实请求体走一遍 `parse`，断言 `changeType: 'price'`、`endpointId: 'setUniformRCRoomPrice'`、`otaHotelId` 为空串
- [x] 1.4 同一测试文件补：断言五个端点片段两两互不为子串（`matchEndpoint` 首个命中即返回，见 D2）
- [x] 1.5 补 `isSuccessful` 用例：统一加减价的真实成功响应（`taskId` + `resStatus.rcode:200` + `Ack:"Success"`）判为成功
- [x] 1.6 补 `toCtripAmountChangeRaw` 用例：三个加减价字段（`adjustmentPriceType`/`adjustmentPriceOperationsType`/`adjustmentPriceValue`）原样透传，`reqHead`/`cipher`/`head` 被剔除

## 2. B 块：修联动房型漏收

- [x] 2.1 `amount-change-adapter.ts` 的 `roomProductIdsOf` 增收 `roomPriceInfos[].relationRoomProducts[].roomProductId`（对象数组，取值路径与 `excludedRelationRoomProductIds` 不同，见 D3）
- [x] 2.2 在该函数注释中写明：`relationRoomProducts` 是「一并改了这些」、`excludedRelationRoomProductIds` 是「排除这些」，**语义相反，后者绝不能收**
- [x] 2.3 补用例：请求体只有 `relationRoomProducts` 而 `roomProductId` 全空时，**不被丢弃**（修复前会误丢）
- [x] 2.4 补回归用例：`excludedRelationRoomProductIds` 中的房型 **不被**当作改动房型收进定位依据
- [x] 2.5 用 `房价维护菜单踩点.md` 前两例（逐项设价）的真实请求体验证：修复后联动房型 ID 出现在定位依据中

## 3. A+B 交付

- [x] 3.1 跑受影响的单测文件（`ctrip-amount-change-adapter.test.ts`、`ctrip-amount-change-payload.test.ts`），全绿
- [ ] 3.2 真机验证：在携程房价维护页各做一次「逐项设价」与「统一加减价」，确认两次都产生上报、`endpointId` 各自正确
- [x] 3.3 ~~提交 A+B~~ → 与 C 合并为**一个提交** `c84ba33`：三块改动在 adapter 文件头、WATCH_PATHS 注释、端点表几处交织，硬拆会产生一份立刻被覆盖的中间态文档且无法验证

## 4. ✅ C 块前置：踩点确认（2026-08-21 已完成）

- [x] 4.1 **`roomStatus` 数字码语义** —— 已确认 **`1` 开房 / `2` 关房**；开关两份请求体逐字段 diff 只差这一个字段，开关同端点同形状，不拆 `endpointId`
- [x] 4.2 **房量字段** —— 本次**不踩点**：字段照常透传，**RMS 不解析**（见 design D9）。已知 `-100` 疑为「不改房量」哨兵，未经验证
- [x] 4.3 **是否存在非批量入口** —— 已确认**没有**，该页面只有批量入口，端点全景图无需扩充
- [x] 4.4 踩点样本已回填 `docs/踩点/携程/房态房量菜单.md`（开房/关房各一份，含标注）
- [x] 4.5 4.3 未发现新入口，design 端点全景图无需改动

## 5. C 块：接房态房量端点

- [x] 5.1 `WATCH_PATHS` 加 `/rateplan/batchSetRoomStatusAndQuantity`（精确页面，**不要写成 `/rateplan`**，见 D6）
- [x] 5.2 `WATCHED_ENDPOINTS` 加 `['batchUpdateRoomStatusAndQuantity', '/batchUpdateRoomStatusAndQuantity']`
- [x] 5.3 新建 `ctrip/room-status-quantity-payload.ts`：`CtripRoomStatusQuantityRaw` 类型 + `toCtripRoomStatusQuantityRaw`（剔 `reqHead`/`cipher`/`head`，其余原样，见 D4）
- [x] 5.4 该文件头部写清与老房态端点的**零字段同名**对照表，并标注 `roomStatus` 的 **`1` 开 / `2` 关**语义（对比老端点 `"G"`/`"N"`，⚠️ 两套都原样透传，**不归一化**）
- [x] 5.5 该文件头部写明房量三字段**本次不被 RMS 解析**，且 ⚠️ **`-100` 疑为哨兵值，不得当作房量写入台账**（见 design D9）
- [x] 5.6 `isCtripSaveSuccessful` 加显式 `endpointId` 分支走 `isNewModuleSuccessful`，并注释说明「不靠形状自辨兜住」的理由（D5）
- [x] 5.7 `parse` 加分流分支 `parseRoomStatusQuantity`：定位依据只取顶层 `roomProductIds`（**不复用** `roomStatusRoomIdsOf`，见 D8）
- [x] 5.8 空 `roomProductIds` → `logger.warn` 并丢弃；`otaHotelId` 恒为空串 → 记一条 `info` 备查，不记 warn
- [x] 5.9 新建 `ctrip-room-status-quantity-payload.test.ts`：用真实请求体验证裁剪与透传（含房量三字段与 `dates.applyAllDates`）
- [x] 5.10 `ctrip-amount-change-adapter.test.ts` 补：新端点走 `parse` 得 `changeType: 'roomStatus'`、`endpointId` 正确、`otaHotelId` 为空串
- [x] 5.11 补用例：新端点的成功响应判为成功，且**不会**误走老房态端点的 `isRoomStatusSuccessful`（那条路径会因 `code` 缺失判失败）
- [x] 5.12 补页面前缀用例：`/rateplan/batchSetRoomStatusAndQuantity` 与 `/rateplan/batchPriceSetting` 都可监听，且互不为前缀
- [x] 5.13 补开关房用例：用踩点的开房（`roomStatus:1`）与关房（`roomStatus:2`）真实请求体各走一遍，断言二者 `endpointId` **相同**，且 `changeRaw.roomStatus` 分别原样保留 `1` 与 `2`（**不归一化成 `"G"`/`"N"`**）

## 6. C 块交付

- [x] 6.1 写服务端对接说明 `server-integration.md`（C 块工作清单 + 完整 `changeRaw` 样本 + 逐字段含义表）
- [ ] 6.1b 把 `server-integration.md` 交给服务端，确认已能处理新端点的 `changeRaw` 形状及空 `otaHotelId`（上线前置，见 design.md Migration Plan）
- [ ] 6.2 与 RMS 侧对齐 `roomStatus` 的 **`1` 开 / `2` 关**（区别于日历菜单端点的 `"G"`/`"N"`），并明确 ⚠️ **房量三字段本次不解析、`-100` 不得当作房量值**
- [x] 6.3 跑受影响单测，全绿
- [ ] 6.4 真机验证：在房态房量页做开房、关房各一次，确认两次都产生上报、`changeRaw.roomStatus` 分别为 `1` 与 `2`
- [ ] 6.5 真机验证：进入房态房量页后再切回房价日历页改一次价，确认监听未被 detach、改价仍能拦到
- [x] 6.6 ~~提交 C 块~~ → 已含在 `c84ba33`（见 3.3）

## 7. 收尾

- [ ] 7.1 同步 `openspec/specs/ota-amount-change-report/spec.md`（本次触及跨模块上报契约的解读约定，属完成门禁触发项）
- [ ] 7.2 写 `verification.md` 汇总真机验证证据
- [ ] 7.3 归档 change
