## 1. 裁剪口径（前置，阻塞 4 与 5）

⚠️ design 的 Open Question 之一。**已定（2026-09-20）：照既有链路，黑名单剔噪音、其余原样。**

既有两处的做法：

| 处 | 做法 |
|---|---|
| `ctrip/amount-change-payload.ts` | `NOISE_KEYS = ['reqHead','cipher','head']` 浅层剔除，其余原样，**不做任何语义转换** |
| `ctrip/inventory-readback.ts` `pickCells` | **完全不裁剪** —— `roomStatusResult` 的行整条透传 |

结论：`item_data` **不做白名单裁剪**，沿用回读的「整行透传」；只在 `content_hash` 上取
一个窄字段集，避免渠道噪音触发误报。

- [x] 1.1 确认既有裁剪约定（黑名单剔噪音 / 回读整行透传），不另造白名单机制
- [x] 1.2 `item_data` = 渠道 cell 整行原样（与回读 `pickCells` 同口径）；
      `content_hash` 参与字段 = 价量态事实字段，见 4.2
- [x] 1.3 结论写进 `inventory-snapshot/ctrip-cells.ts` 文件头规格注释
- [x] 1.4 与用户确认：「照回读/上报链路，尽量简单」—— 已确认

## 2. 存储层

- [x] 2.1 `database/application-database.ts` 加 migration v9：建 `ota_inventory_snapshot` 表
      （字段与索引照 design 决策 3 的 DDL）
- [x] 2.2 ⚠️ 空值用 `''` 不用 NULL，并带 `CHECK (physical <> '' OR sale <> '')`
      —— 注释写明理由（SQLite `UNIQUE` 里 `NULL != NULL`，可空列参与唯一键会反复 INSERT）
- [x] 2.3 ⚠️ 不加外键 —— 注释写明理由（快照是渠道事实，加外键会让未绑定账号的数据落不了库）
- [x] 2.4 新建 `database/ota-inventory-snapshot-repository.ts`：接口与实现同文件
      （照 `ota-hotel-repository.ts` 的形状）
- [x] 2.5 `upsertMany(cells)`：单条 `INSERT … ON CONFLICT` 批量 upsert，包进**一个**
      `database.transaction()`
- [x] 2.6 ⚠️ 事务内不得出现 `await` —— 注释写明（better-sqlite3 事务同步，跨事件循环未定义）
- [x] 2.7 `findByHotelAndDateRange(...)`：一次读一批基线（Change B 决策 6 的前提：
      读基线+比对+写入要在同一同步段内完成）
- [x] 2.8 ⚠️ 写入耗时打日志：行数 + 耗时 —— **改在队列消费者（3.6）打**：repository 是
      同步纯写入、无 logger 依赖，而耗时要连同「这批多少行」一起看才有意义
- [x] 2.9 单测：建表与迁移幂等；upsert 同格覆盖不新增行；`CHECK` 拒绝两 ID 皆空；
      按日期范围查询边界

## 3. 快照模块（渠道无关，纯逻辑）

- [x] 3.1 新建 `inventory-snapshot/types.ts`：`SnapshotCell` / `SnapshotKey` / `SourceOfTruth`
- [x] 3.2 ⚠️ `item_type` 只有 `roomStatus` | `price` 两个值 —— 注释写明为何房态房量不拆
      （两渠道读模型里本就同行，拆了要再拼回来）
- [x] 3.3 新建 `inventory-snapshot/snapshot-write-queue.ts`
- [x] 3.4 投递方法：`push(cells)` 同步返回，**不 await 写入**
- [x] 3.5 按格子键去重合并，同一格只保留最新一份（防膨胀 + 合并写）
- [x] 3.6 单一消费者串行 drain；每批（如 200 行）后 `setImmediate` 让出
- [x] 3.7 ⚠️ 写失败吞掉 + 记日志，**不回传给投递方**
- [x] 3.8 ⚠️ 命名不得含 "thread"/"线程" —— 注释写明这是队列不是并发
- [x] 3.9 `dispose()`：停止消费，丢弃未写入项
- [x] 3.10 新建 `inventory-snapshot/snapshot-diff.ts`：比对纯函数（本期只建不接线，Change B 调用）
- [x] 3.11 单测：投递不阻塞；同格去重；写失败不冒泡；分批让出；dispose 后不再消费

## 4. 携程 cells 抽取（依赖第 1 节）

- [x] 4.1 ⚠️ **落在 `inventory-snapshot/ctrip-cells.ts`，不是 `channels/ctrip/`**：
      它产出 `SnapshotCell`，而 eslint 禁止 `channels/` 依赖 `inventory-snapshot/`
      （9.5 实测拦下）。分界线：渠道层**解析**响应交出原始行，本文件**映射**成格子
- [x] 4.2 `content_hash` 计算（稳定序列化 —— ⚠️ 键序必须固定，否则同一内容算出不同 hash）
- [x] 4.3 ⚠️ 从响应抽 cells 时**不转换渠道枚举**（`"G"`/`"N"` 不转开/关，`"T"`/`"F"` 不转布尔）
- [x] 4.4 ⚠️ `ota_hotel_id` 在本层**留空**，由装配层用凭证补齐（见第 6 节）——
      注释写明绝不能用响应里的 `hotelID`（那是「门店 × 售卖模式」层）
- [x] 4.5 房型 ID 填法：携程 `sale=roomTypeID`、`physical=''`
- [x] 4.6 单测：用真实样本断言裁剪结果；枚举原样保留；同内容不同键序 hash 一致；
      两 ID 不得皆空

## 5. 回读接入（第一条写入路径）

- [x] 5.1 `InventoryReadbackDispatcher` 增加可选的 persist 窄回调（照既有 `report` 手法）
- [x] 5.2 回读 `ok` 时同时投递快照；⚠️ **既有上报行为一行不改**
- [x] 5.3 ⚠️ 投递失败/抛错不得影响既有上报 —— 两条下游互不阻塞
- [x] 5.4 单测：回读成功时既上报又投递；persist 抛错时上报仍正常；未注入 persist 时行为同现状

## 6. `ota_hotel_id` 归一（装配层）

- [x] 6.1 装配层窄回调：投递方给 `partitionName`，回调查凭证取 `credentialExtra.masterHotelId`
- [x] 6.2 ⚠️ 取不到时**拒绝写入该批 + warn**，不退回响应原值
      （存错会永久污染基线，且下次归一正确时变成「另一家酒店」）
- [x] 6.3 单测：有 `masterHotelId` 时覆盖；缺失时整批被拒且记 warn

## 7. 自然读拦截（第二条写入路径）

- [x] 7.1 ⚠️ **改为扩展既有 capture，不新建文件**（方案 A，已与用户确认）：
      `webContents.debugger` 独占，而 `AmountChangeWatcher` 已在携程
      `/ebkovsroom/inventory`（正是自然读发生的页面）attach —— 另起一个 capture 会被
      静默拒绝。改为给 `AmountChangeAdapter` 加 `isReadEndpoint`/`onReadResponse` 两个
      可选钩子，复用同一条 CDP 连接，分流位置与既有 `isAuxiliaryEndpoint` 相同
- [x] 7.2 ⚠️ 拦**读**端点，且**不做成败判定**（读接口没有「渠道拒绝」这回事）
- [x] 7.3 ⚠️ 绝不改请求、不注入脚本操作页面 —— 页面表现须与未安装本应用时一致
- [x] 7.4 pending 项有存活上限（照既有 `PENDING_MAX_AGE_MS` 兜底，防残留累积）
- [x] 7.5 复用第 4 节的 cells 抽取，**不另写一份**（否则两条路径抽出的形状会漂）
- [x] 7.6 ⚠️ **无需新增 attach/detach**：复用既有 capture 的连接与生命周期（7.1 方案 A），
      读端点随改价监听一起 attach/detach，不新增 disposer
- [x] 7.7 单测：命中读端点则投递、不走 parse；不调 isSuccessful；抽不出行不投递；
      onReadResponse 抛错被吞掉；未注入回调时行为同现状；写端点不受影响（6 项）

## 8. 配置

- [x] 8.1 `app-config/types.ts` 加 `InventoryScanConfig`（`window` 联合 + `timeoutMs`）
- [x] 8.2 ⚠️ `window` 用带 `kind` 的联合，注释写明「加多时间段是加分支不是改字段」
- [x] 8.3 ⚠️ 预留 `byHotel?:` 字段 + 注释写明「本期不实现，合并语义是逐店深合并，
      需扩展 mergeConfig 深度」
- [x] 8.4 ⚠️ **不预留房型字段** —— 注释写明理由（不知是白名单/黑名单/优先级，
      猜错的形状比不预留更糟）
- [x] 8.5 `defaults.ts` 加默认值
- [x] 8.6 ⚠️ `mergeConfig` 注释补「数组 = 整体替换」的约定（防后来者改成 concat）
- [x] 8.7 单测：默认值可用；部分覆盖时未覆盖项不变

## 9. 装配与分层强制

- [x] 9.1 `app-scope`：建 repository 与队列（⚠️ 跨窗口共享，生命周期长于单个窗口）
- [x] 9.2 `window-scope`：接回读 persist 投递方 + 注册 `InventoryReadCapture`
- [x] 9.3 ⚠️ dispose 时只摘投递方，**队列本身不停**（Change B 的定时任务还要用）
- [x] 9.4 ⚠️ `.eslintrc.json` 加禁令：`channels/` 不得 import `inventory-snapshot/`
      （分层 spec 要求 lint 强制，不得只写注释）
- [x] 9.5 验证 `npm run lint:desktop` 对违规 import 报错
      —— ✅ 实测生效：初版把 cells mapper 放在 `channels/ctrip/` 下被 lint 拦下，
      据此移到 `inventory-snapshot/ctrip-cells.ts`（渠道层只交出原始行，翻译成格子
      是快照侧的事）

## 10. 验证

- [x] 10.1 类型检查 + 受影响模块测试全绿 —— ✅ typecheck 干净；单测 1065 passed / 1 failed，
      与改动前基线（9 文件失败 / 1 用例失败，`__SERVER_ORIGIN__` 等构建常量未注入所致）
      **完全一致**，本次新增 78 项全绿
- [x] 10.2 真机：用户翻携程价量态页面 → 查库确认快照写入，字段与页面一致
      —— ✅ 房态 437 行 + 价格 346 行；18:04:55~18:05:02 共 9 次 `page-read`
      **前面没有任何回读**，即用户翻页面时页面自发的请求，自然读拦截确实在工作
- [x] 10.3 真机：改一次房态房量 → 确认回读上报**照常**且快照同步更新
      —— ✅ 房量 5→6→7→5→7→8 六轮全部准确落库；回读上报照常
      （`rmsStatus: DISPATCHED, rmsItems: 3`）。**批量页一并验过**：
      写端点 `batchUpdateRoomStatusAndQuantity`（与日历页的
      `setbatchroombookablestatus` 是两个端点），但**读端点同为
      `getRoomInventoryInfo`** —— 读端点只需拦一个，两套写模块都覆盖。
      ⚠️ 批量页回读耗时 2.9s（日历页 0.4s），符合它是异步任务的设计
- [x] 10.4 真机：确认 `ota_hotel_id` 是凭证里的 `masterHotelId`，不是响应里的 `hotelID`
      —— ✅ 日志实证 `payloadHotelId: '122247738' → masterHotelId: '122244992'`，
      库里存的是后者。两值确实不同，归一生效
- [x] 10.5 ⚠️ 真机：验证回读 XHR 是否被自己的监听拦到
      —— ✅ **已确认会被拦到**。两条 enqueue 相隔 2ms，前 3 个键逐字符相同：
      ```
      18:05:09.316 readback   cells:3  roomStatus:1569052074:2026-10-20=G|T|F|7|7|true …
      18:05:09.318 page-read  cells:6  （同样 3 格）+ price:…=434|RMB …
      ```
      ⚠️ **标记头方案已排除**：page-read 的产出**完全包含**回读的，还多 3 格价格
      （回读只取 `roomStatusResult`，拦截两者都取）。让拦截跳过回读请求会**丢价格**。
      结论：`readback` 标记恒被覆盖，但数据一致、无影响；persist 是否保留见下
- [x] 10.6 ⚠️ 拉写入耗时日志分析 —— ✅ **结论：不搬 worker**。实测
      `flushedRows: 200, flushMs: 3` / `100 → 1ms` / `40 → 1ms`。200 行 3 毫秒，
      主进程一帧 16ms，感知不到。收益 3ms，代价是跨线程调试 + 双连接 `SQLITE_BUSY`
      + 全仓第一个 worker，**明确不值**。另见 `pendingLeft: 100`，证明分批让出生效
- [x] 10.7 过期行清理 —— **已定：启动时跑一次**，不随写入顺带（Open Question 已解）。
      理由：过期是按天发生的事，随写入做等于每批都多算日期 + 多发一条 DELETE；启动时跑
      一次已覆盖绝大多数场景，且不需要额外定时器。保留 30 天（窗口默认 7 天，留余量排查）
- [x] 10.8 如实记录验证结果 —— 见上。**未执行项**：美团（本期不接入，见 design
      Migration Plan）；`truncated`（「应用到所有日期」）路径未验；失败路径
      （cookie 失效 / 403）未验

## 11. 待定（不阻塞提交）

- [ ] 11.1 **回读 persist 是否保留** —— 10.5 证明它产出的每一格都会被 2ms 后的
      page-read 覆盖，且后者内容完全包含前者。砍掉可少一次重复写入（每次改动少写 3 行）；
      保留则无害但 `source_of_truth` 的 `readback` 值永远不出现。**待用户定**
- [ ] 11.2 扫描窗口与自然读范围不一致 —— 自然读存 15 天（携程一次返这么多），
      而 `window.days` 默认 7，8~15 天的基线永不被比对。倾向对齐到 15 天，
      **属 Change B 范围**
