# 美团房态房量监听 —— 任务清单

> 依据 `design.md`。契约与机制层本次**一行不改**，改动集中在美团适配器一个文件。
> 测试粒度按 CLAUDE.md：迭代期只跑改动直接命中的测试文件，完成态跑一次全量。

## 1. 端点

- [x] 1.1 加两个端点常量：`inventory-status-switch` → `/api/gw/v1/product/goods/inventory/status/switch`，`inventory-update` → `/api/gw/v1/product/goods/inventory/update`
- [x] 1.2 注释写清 **`inventory/check` 为什么不拦**：与 `update` 请求体逐字节相同，两个都拦会让一次改动上报两遍且幂等挡不住（见 design 决策 2）
- [x] 1.3 注释确认 `WATCH_PATH` 无需改动（referer 实测是 `/ebooking/merchant/product`，`#/index` 是 hash 路由不参与匹配），把这个结论留下免得后人重复排查

## 2. 解析

- [x] 2.1 `parse` 按 `endpointId` 分流出房态房量分支，与改价的 calc/update 分流并列
- [x] 2.2 房态分支（`status/switch`）：取顶层 `poiId` 作 `otaHotelId`、顶层 `roomId` 作定位依据
- [x] 2.3 房量分支（`inventory/update`）：取顶层 `poiId`；房型标识从 `modifyInventoryModelList[].modifyInventorySubjectsModel` 的 `dayRoomIdList`/`hourRoomIdList`/`goodsIdList` **三个列表都收**（见 design 决策 7）
- [x] 2.4 两个分支都返回 `changeType: 'roomStatus'`、`changeRaw: observed.requestBody`（**原样透传，不裁剪、不新建 payload 模型**）
- [x] 2.5 丢弃路径：房型标识全空时记 warn 并返回 `null`
- [x] 2.6 `isSuccessful` **不加分支** —— 房态房量响应与改价同构（`code:10000` + `success:true`），把这个结论写进注释说明为何美团继续忽略 `endpointId` 形参
- [x] 2.7 更新适配器文件头：本渠道现在管四个端点（改价 calc/update + 房态 + 房量），说明房量请求体里房态房量并存、合并为一条上报的理由

## 3. 测试

- [x] 3.1 用踩点原文补房态用例（`status: 0` 关 / `status: 1` 开各一条），验证 `changeType`、`endpointId`、`otaHotelId`、`changeRaw` 原样
- [x] 3.2 补房量用例：验证 `changeRaw` 里 `countType`/`invSwitch`/`limitChangeValue`/`count` **全部保留**（语义未知不等于该剔 —— 这条是防止日后有人"顺手清理"的护栏）
- [x] 3.3 补一条护栏用例：`inventory/check` **不在** `watchedEndpoints` 里
- [x] 3.4 补端点分发用例：四个端点各自只命中自己的 URL，互不为子串
- [x] 3.5 补房型标识全空 → 返回 `null` 的丢弃用例
- [x] 3.6 补一条房量用例验证钟点房：只有 `hourRoomIdList` 有值时照常上报

## 4. 完成态验证

- [x] 4.1 `npm run check:types` + `npm run lint` 通过（重点看 `channels/` 分层约束）
- [x] 4.2 `npm run test:unit` 跑一次全量，如实记录结果
- [ ] 4.3 真机验证：美团商品页单独改房态一次、改房量一次，确认各自拦到、判定成功、`endpointId` 与 `changeRaw` 符合预期
- [ ] 4.4 真机确认 `inventory/check` 确实**没有**产生第二条上报
- [ ] 4.5 若能构造一次被美团拒绝的操作，抓失败响应样本回填踩点文档
- [x] 4.6 验证证据写入 `openspec/changes/meituan-room-status-watch/verification.md`

## 5. 规范同步

- [ ] 5.1 本次 delta 与 `ctrip-room-status-watch` 的 delta 同属 `ota-amount-change-report` capability，验收后一并合并进 `openspec/specs/`
