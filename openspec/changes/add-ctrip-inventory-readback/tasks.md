## 1. app-config 基础设施

- [x] 1.1 新建 `main/app-config/types.ts`：`AppConfig` 类型 + 每项语义注释（控制什么、默认值依据、调整影响）
- [x] 1.2 新建 `main/app-config/defaults.ts`：`ctripInventoryReadback: { delayMs: 0, windowDays: 7, timeoutMs: 30000 }`，每个值注明依据（design 决策 6 / 4.2 / inventory.py 口径）；`delayMs: 0` 须注明「留位，真机确认读到旧值再调」
- [x] 1.3 新建 `main/app-config/app-config-store.ts`：三层优先级合并（默认 → 服务端下发 → 本地覆盖），本期只实现第一层，其余两层留接口形状
- [x] 1.4 单测：只有默认值时全项可用；高优先级层只覆盖部分项时，未覆盖项仍取低层值（**不得变 undefined**）
- [x] 1.5 确认 `app-config/` 不被 eslint 分层规则禁止 `channels/` import；若被禁，改为 composition 注入窄回调

## 2. 从写请求还原 (房型 × 日期)（携程内部纯函数，全部可单测）

- [x] 2.1 新建 `channels/ctrip/room-change-targets.ts`，导出 `extractCtripReadbackTargets(endpointId, changeRaw, windowDays, today)`；**入参是既有 `parse` 产出的 `changeRaw`**（已裁剪），不是原始 requestBody
- [x] 2.2 ⚠️ 该函数是 `ctrip/` 的**内部实现**，MUST NOT 出现在 `channels/types.ts` 的任何跨渠道接口上（决策 1.1）
- [x] 2.3 日历页分支：从 `hotelRoomInfoDtoList[]` 取 `roomTypeID`，**忽略 `originalRoomProductIds`**（决策 3.1）
- [x] 2.4 批量页分支：从 `roomProductIds[]` 取房型，字符串转数字
- [x] 2.5 日期展开：`dateItemInfoDtoList[]` / `dates.dateRanges[]` 闭区间逐日展开，**再与星期筛选取交集**（决策 4.1）；产出的 `dates` 是**已展开的具体日期列表**
- [x] 2.5a 日历页星期解析：`weekDayIndex` 7 位串，**最左 = 周一**，与服务端 `RawBodyReader.weekdaysFromBitString` 同口径
- [x] 2.5b 批量页星期解析：`dates.weekDays[]` 英文枚举，与服务端 `weekdaysFromNames` 同口径
- [x] 2.5c 空数组 / 空串 / 字段缺失 = **不过滤**（等同全选），与服务端 `toDayOfWeek` 口径一致
- [x] 2.6 `applyAllDates === true` 时裁剪到 `windowDays`（从今日起）；`windowDays` 与 `today` 均为**入参**，不得硬编码、不得读全局时钟（决策 4.2）
- [x] 2.7 空房型集合或空日期返回 `null`（不回读），**不得退化为全量**（决策 3.3）
- [x] 2.8 单测 2.3-2.7：单房型单日、多房型多日、**跨门店 6 房型样本**（`日历菜单-价量态修改踩点.md:165`）、`applyAllDates:true` 裁剪、空数组
- [x] 2.9 ⭐ 星期过滤单测（**用真实样本，守决策 4.1**）：
  - 日历页 `weekDayIndex: "0000110"` + 7 天区间 → **只剩周五周六 2 天**（⚠️ 携程把周五六算 weekend）
  - 日历页 `"1111001"` → 周一二三四 + 周日（与上一条互补，合起来正好是区间全集）
  - 批量页 `["SATURDAY"]`（`改价03..md` 真实样本）→ 只剩周六
  - 批量页 `["FRIDAY","SATURDAY"]`（`房价维护菜单踩点.md` 真实样本）→ 只剩周五六
  - 批量页 `[]`（`改价踩点2.md:117` 真实样本）→ 不过滤，全区间
- [x] 2.10 ⚠️ 断言位序不是反的：`"1000000"` → 周一（**不是周日**）；这是唯一能抓住位序写反的用例，缺了它左右颠倒仍会全绿

## 3. 回读能力（port + 携程实现）

- [x] 3.1 `channels/types.ts` 加 `InventoryReadback` 接口，**只有一个方法** `readback(report, webContents)`（决策 1.1）；`ReadbackOutcome` 为 tagged union，`ok` / `skipped` / `failed` **三态分开**，不用空数组表失败
- [x] 3.2 新建 `channels/ctrip/inventory-readback.ts`：判端点（非房量端点返回 `skipped`）→ 调 2.1 的纯函数 → 两步请求（`getRcProductList` 补齐六字段 → `getRoomInventoryInfo`）→ 组上报体；超时取配置值
- [x] 3.3 页面内执行表达式：照 `meituan/poi-infos.ts` 的 `FETCH_MEITUAN_POI_INFOS_EXPRESSION` 模板，XHR + `withCredentials`，**所有异常路径 `resolve(null)` 绝不 reject**（决策 5）
- [x] 3.4 房型六字段补齐：按 `roomTypeID` 从 `getRcProductList` 的 `roomInfos[]` 索引 `hotelID`/`payType`/`roomClass`/`rateCodeID`；`roomClass` 缺省回落 `roomTypeID`
- [x] 3.4a 回读请求的日期区间取 `min(targets.dates)` / `max(targets.dates)` —— 接口只认起止，不支持星期过滤（决策 4.1.1）
- [x] 3.4b ⭐ 拿回结果后**按 `targets.dates` 集合过滤 `effectDate`**，丢弃区间内但不在目标集合的行；漏了这步等于「多读」，服务端会多跟价
- [x] 3.4c 单测 3.4a-3.4b：目标日期不连续（如只要周六周日）时，请求区间覆盖 7 天而上报 `cells` 只剩 2 天
- [x] 3.5 源头过滤 `hourRoom === true` / `advanceSale === true`，**在去重前**；判据「明确为 true 才排除」
- [x] 3.6 登录失效四形态判定 + 403 单列（决策 10）；形态 2 用 `rms-rpa-worker/tests/fixtures/ctrip/login_page.html` 作输入
- [x] 3.7 `registry.ts`：`ChannelAdapter` 加可选 `inventoryReadback`，携程接上，新增 `inventoryReadbacks()` 投影（照 `amountChangeAdapters()` 写法）
- [x] 3.8 单测：fixture 驱动两步请求（执行器注入替身），覆盖成功、cookie 失效四形态、403、网络失败、**成功且为空**
- [x] 3.9 回归用例：断言靠 `<title>` 判登录页会漏（守决策 10 的形态 2）

## 4. 上报契约

- [x] 4.1 `shared/types/amount-change.ts`：`OtaChangeType` 加 `'inventoryReadback'`，注释说明它与 `price`/`roomStatus` 的语义差异（事实 vs 意向）
- [x] 4.2 新建 `channels/ctrip/inventory-readback-payload.ts`：`changeRaw` 规格文件（给 RMS 对接看），照 `room-status-quantity-payload.ts` 风格
- [x] 4.3 `changeRaw.trigger.rawRequest` **直接复用 `trigger.changeRaw`**，MUST NOT 另写裁剪逻辑（决策 7）
- [x] 4.4 `changeRaw.trigger.observedAt` 用 dispatcher 收到时的时间戳（`OtaAmountChangeObserved` 无时间字段，差几毫秒可接受）
- [x] 4.5 `cells` 原样透传，**不做任何枚举映射/类型转换**；在 payload 规格里写明 `limitSale:"F"` 时房量 0 不代表没房
- [x] 4.5a ⚠️ **不区分房态/房量**：只要命中两个房量端点就整行回读，MUST NOT 看请求体里动的是 `roomStatus` 还是 `remainRoomQuantityType`；重复内容由服务端裁剪（决策 7）
- [x] 4.5b 单测：只改房量的请求 → `cells` 仍含房态字段；只改房态的请求 → `cells` 仍含房量字段
- [x] 4.6 `otaHotelId` 留空串交由 service 层用 `masterHotelId` 归一，**不新写一套**；回读响应里的 `hotelID` 只进 cell 存档（决策 8）
- [x] 4.7 单测 4.3-4.6：`rawRequest` 与触发它的上报体 `changeRaw` **逐字节相同**、cells 原值未被改写、`otaHotelId` 不取响应值

## 5. Dispatcher 与装配

- [x] 5.1 新建 `channels/inventory-readback-dispatcher.ts`：构造参数 `{ readbacks, logger, report }`；只做「按 source 取实现 → 调用 → 递出结果」三件事
- [x] 5.2 ⚠️ **机制层 MUST NOT 出现任何渠道判断**（`if (source === 'ctrip')`、端点名、`changeType` 一律不得出现）；未注册回读能力的渠道靠 `readbacks.get()` 落空自然跳过（决策 1.1）
- [x] 5.3 `registry.ts` 加可选 `inventoryReadback` 字段 + `inventoryReadbacks()` 投影，携程接上；**抖音/美团不注册**
- [x] 5.4 在既有 watcher 的上报回调处分叉，把 `OtaAmountChangeObserved` + `webContents` 递给 dispatcher；**既有 `deps.report` 调用一字不动**（决策 2）
- [x] 5.5 `window-scope.ts` 装配，`onDispose` 接上 dispose（`disposed` 标志位；默认不延迟故无定时器需清理）
- [x] 5.6 两条上报的 `operationId` 独立生成，**不共用**（决策 2）
- [x] 5.7 日志：`channel`/`triggerEndpointId`/`roomTypeCount`/`dateCount`/`cellCount`/`durationMs`/`reason`；**`skipped` 与 `failed` 必须在日志里可区分**（决策 1.1、10）
- [x] 5.8 确认 cookie 不出现在任何日志参数里
- [x] 5.9 单测：未注册渠道直接跳过、`skipped` 不上报且不记 error、`failed` 记 warn 不上报、`ok` 才调 `report`、dispose 后不再递出结果
- [x] 5.10 单测（守 5.2）：构造一个**假渠道**注册回读实现，断言 dispatcher 照常调用它 —— 证明机制层没有对携程的硬编码

## 6. 既有行为回归

- [x] 6.1 跑既有 `amount-change-watcher.test.ts` / `ctrip-amount-change-adapter.test.ts`，**全绿**（既有 `parse` 一字未改）
- [x] 6.2 断言既有改价/房态上报体逐字节不变（新增链路不得污染 `changeRaw`）

## 7. 服务端需求文档

- [x] 7.1 `服务端需求.md`（本 change 目录内）：端点、`(source, endpointId)` 分派键、`changeRaw` 完整结构、字段语义、真实样本
- [x] 7.2 写明三条反直觉约定：`limitSale:"F"` 时房量 0 不代表没房、`applyAllDates:true` 时数据非完整快照、`cells` 里的 `hotelID` 不可用于匹配
- [x] 7.3 写明 `operationId` 与改动上报独立，**不可互相去重**

## 8. 验证与收口

- [x] 8.1 `npm run -s typecheck` + lint，确认 `channels/` 层无越界 import（eslint zone 会拦）
- [x] 8.2 跑本 change 受影响模块的全部测试
- [x] 8.3 真机验证（日历页）：改房量 → 确认回读发出、cells 有值、上报体 `otaHotelId` 为账号粒度值
- [x] 8.4 真机验证（批量页）：**增加/减少**各一次 → 确认回读拿到的是改后绝对值
- [x] 8.5 ⚠️ 首测确实读到**改前**的值（设 19 读到 21/2/2）→ 改用**任务门控**解决（决策 6），非调 `delayMs`；复测设 18 准确读回 18
- [x] 8.9 批量任务门控真机验证：`Ctrip batch task completed` 先于回读出现，任务实际耗时约 1.2 秒
- [x] 8.10 星期过滤真机验证：两组不同组合（周二三五 → 3 天、周二五 → 2 天）均精确
- [x] 8.6 真机验证 `applyAllDates: true`：确认裁剪到 7 天、`rawRequest` 保留该字段
- [x] 8.7 ⚠️ 实测服务端返回的是 **500 / `rmsCode: 10000`**（`INTERNAL_ERROR`），不是预期的 `200 + UNKNOWN_ENDPOINT`。报文有没有落 `raw_body` **未确认** —— 已记入 `服务端需求.md` §7，服务端侧处理
- [x] 8.8 grep 真跑进程的日志确认链路各节点都留痕（代码提交 ≠ 生效）
