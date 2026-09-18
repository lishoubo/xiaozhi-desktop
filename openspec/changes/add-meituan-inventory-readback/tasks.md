## 1. app-config

- [x] 1.1 `main/app-config/types.ts` 加 `MeituanInventoryReadbackConfig`：**只有 `timeoutMs`**
- [x] 1.2 注释写明**为何没有 `delayMs` / `windowDays`**（design 决策 1.2）—— 否则下一个人会照携程补上一个永远为 0 的旋钮
- [x] 1.3 `defaults.ts` 加 `meituanInventoryReadback: { timeoutMs: 30000 }`，沿用携程口径
- [x] 1.4 单测：默认值可用；部分覆盖时未覆盖项不变 `undefined`

## 2. 从写请求还原 (房型 × 日期)（纯函数，全部可单测）

- [x] 2.1 新建 `channels/meituan/room-change-targets.ts`，导出 `extractMeituanReadbackTargets(endpointId, changeRaw)`
  - ⚠️ **无 `windowDays` / `today` 入参**（美团无「应用到所有日期」）
- [x] 2.2 该函数是 `meituan/` 的**内部实现**，MUST NOT 出现在 `channels/types.ts` 上
- [x] 2.3 非 `inventory-update` 端点返回 `null`（决策 1.1）
- [x] 2.4 汇总 `modifyInventoryModelList[]` 全部元素的房型与日期，产出**一组** (房型集, 日期集)（决策 2.1：所有房型共用同一组日期）
  - ⚠️ 不加「各 model 日期不同」的保护性分支 —— 产品上不存在，那条分支永远走不到也测不出
- [x] 2.5 房型只取 `dayRoomIdList`；某 model 只有 `hourRoomIdList` 时**跳过该 model**（不是整次 skip，决策 2.4）
- [x] 2.6 日期：`modifyDates[]` 闭区间逐日展开（可复用携程 `expandRanges` 的算法，但**不跨文件共享** —— 两渠道各持一份，避免一方改动波及另一方）
- [x] 2.7 星期：`modifyParamByEffectWeeks[].effectWeek` 取**并集**（决策 2.2），ISO 1=周一（决策 2.3）
- [x] 2.8 `effectWeek` 缺失 / 空数组 = 不过滤（与服务端 `toDayOfWeek` 同口径）
- [x] 2.9 空房型或空日期返回 `null`，**判据须覆盖空值本身**（决策 2.5）

### 单测（第 2 节）

- [x] 2.10 单房型单日期段（`房价房量日历-房量.md` 真实样本，`dayRoomIdList:[493879575]` + `2026-10-20` 单日）
- [x] 2.11 多房型（`批量改房态房量.md` 真实样本，3 个 model 同日期段）→ 3 个房型 × 同一组日期
- [x] 2.12 ⭐ 星期过滤用 `批量改房态房量.md` 真实样本：`effectWeek:[1,2,3,4,7]` + `[5,6]` 两档 → **并集 = 7 天全展开**
- [x] 2.13 ⭐ 单档 `effectWeek:[5,6]` + 跨周区间 → **只剩周五周六**；断言 `[1]` → 周一（**不是周日**）—— 这是唯一能抓住基准写反的用例
- [x] 2.14 `effectWeek: []` → 不过滤，全区间
- [x] 2.15 多日期段（`批量改房态房量.md` 的 `09-09~10-08` + `08-27~08-28` 两段）
- [x] 2.16 只有 `hourRoomIdList` 的 model 被跳过；全部是钟点房 → 返回 `null`
- [x] 2.17 空 `modifyDates` / 空 `dayRoomIdList` / 字段缺失 → `null`（不退化为全量、不发空请求）

## 3. 回读实现

- [x] 3.1 新建 `channels/meituan/inventory-readback-fetcher.ts`：照携程那份的结构（XHR + `withCredentials`，全路径 `resolve`），**不跨渠道复用**（决策 3.3）
- [x] 3.2 新建 `channels/meituan/inventory-readback.ts`，实现 `InventoryReadback`
- [x] 3.3 `poiId` / `partnerId` 从 `trigger.changeRaw` 顶层取（决策 3.1）；⛔ 不从 `credentialExtra` 取
- [x] 3.4 取不到 `poiId` / `partnerId` → `skipped`（不猜、不省略字段发请求）
- [x] 3.5 请求区间取 `min(dates)` / `max(dates)`（决策 3.2）
- [x] 3.6 ⭐ 拿回结果后**按目标日期集合过滤**，丢弃区间内但不在集合的行（决策 3.2）
- [x] 3.7 ⭐ **按 `roomCategory === 1` 过滤**（决策 4.2）；`roomCategory` 缺失 → 丢弃该行
- [x] 3.8 展平 `roomStatusMap`（日期为 key 的对象）成扁平 `cells`，并进 `roomId`/`roomName`/`roomCategory`（决策 4.3）
- [x] 3.9 成功判据 `code === 10000 && success === true`（决策 4.1）
- [x] 3.10 失败分类：401 → `COOKIE_EXPIRED`，403 → `FORBIDDEN`，`code !== 10000` → `PARSE_ERROR`，网络/超时 → `NETWORK_ERROR`
  - ⚠️ **不写猜测的登录页判据**（决策 4.5）。也不打算补 —— 见 6.4
- [x] 3.11 `cells` 为空是**合法结果**（`ok`），不是失败

### 单测（第 3 节）

- [x] 3.12 ⭐ **同一 roomId 两条（cat1 + cat2）的真实响应 → 只留 cat1**（守决策 4.2）
  - fixture 用 `房价房量日历-房量.md` 的真实响应，**不自造** —— 自造的 fake 可能恰好比真实类型「更干净」，把缺陷一起掩盖
- [x] 3.13 ⭐ 目标日期不连续（只要周五六）→ 请求区间覆盖 7 天而 `cells` 只剩 2 天（守决策 3.2）
- [x] 3.14 `roomStatusMap` 展平正确性：3 房型 × 4 天 → 12 个 cell，各带正确的 `roomId`/`date`
- [x] 3.15 `code: 10000` 但 `data: []` → `ok` 且 `cells` 为空（不是 failed）
- [x] 3.16 401 / 403 分别落 `COOKIE_EXPIRED` / `FORBIDDEN`（不可合并）
- [x] 3.17 非 `inventory-update` 端点 → `skipped`（不是 failed）

## 4. 上报体

- [x] 4.1 新建 `channels/meituan/inventory-readback-payload.ts`，导出 `buildMeituanReadbackReport`
- [x] 4.2 `endpointId = 'queryRoomStatusInfo'`（决策 5.1）；⛔ 不用 `inventory-update`
- [x] 4.3 `truncated` 恒 `false`（决策 5.2）
- [x] 4.4 `otaHotelId` 留空串，由 service 层覆盖（决策 5.3）
- [x] 4.5 `trigger.rawRequest` 复用 `trigger.changeRaw` 同一份对象，**不另行裁剪**
- [x] 4.6 文件头写清 RMS 对接规格：字段表 + `countType` 编码表 + 房量字段观察值（标注**语义待服务端确认**）
- [x] 4.7 ⭐ 显式写明「`limitType:2` 时 `limitRemain` 是 998/999 哨兵值，不是真实房量」（决策 4.4）

## 5. 接线

- [x] 5.1 `meituan/amount-change-adapter.ts` **导出** `INVENTORY_ENDPOINT_ID`（当前是模块私有）—— 唯一改动，行为不变
- [x] 5.2 `registry.ts` 美团条目加 `inventoryReadback: createMeituanInventoryReadback({...})`
- [x] 5.3 更新 `ChannelAdapter.inventoryReadback` 的注释：「当前只有携程实装」→ 携程 + 美团；「美团待踩点」一句删掉
- [x] 5.4 确认机制层（`types.ts` / dispatcher / watcher / composition）**一行未改**
- [x] 5.5 `channel-registry.test.ts` 补断言：美团有 `inventoryReadback`，抖音仍然没有

## 6. 真机验证

> ⚠️ 每项**单独跑一次**并各自留观测窗口。连着做会让后一次抹掉前一次的观测，
> 「最终状态看起来对」什么都证明不了。

- [x] 6.1 ⭐ **同步性**（design 决策 1.2 的唯一假设）：改一个房型某天房量为 N → 立刻回读同一房型同一天 → 断言拿到的是 **N（改后值）**而非改前值
  - 若拿到改前值 → **停止**，回到 design 重新设计门控，不要加固定延迟绕过
- [x] 6.2 日历页单房型单日：回读 `cells` 的房型与日期与所改一致
- [x] 6.3 ⭐ 批量页多房型 + **只勾部分星期**：断言 `cells` 的日期**恰好**是所勾星期，一天不多
  - 这条同时验证决策 2.2（并集）、2.3（ISO 基准）、3.2（按集合筛）
- ~~6.4 故意让 cookie 失效取真实响应~~ —— **不做**。回读发生在用户刚操作成功的那个
  标签页里，上一秒才保存成功、下一秒登录失效的场景基本不存在；且回读失败不重试不落盘，
  判成哪种失败对行为没有任何影响，只是日志上一个词的差别。
  （携程那边的四形态判据继承自 `rms-rpa-worker` —— 那是后台无人值守跑的，cookie 放几天
  不用，失效是常态，语境与 desktop 这条路完全不同。）
- [x] 6.5 钟点房：改一次钟点房房量 → 断言**不触发回读**（或 `skipped`），不产出 cells
- [x] 6.6 grep 真实进程日志确认回读发生（**不能只看单测绿**）；确认上报 `operationId` 与改动上报独立
- [x] 6.7 记录服务端响应。⚠️ 预期是 500（`rmsCode: 10000`，与携程同因）—— **这不算验证通过**，
      如实记录为「desktop 侧发出正确，端到端待服务端」

## 7. 收尾

- [x] 7.1 `pnpm check:types` + 单测全绿
- [x] 7.2 ⭐ 反向验证：故意把决策 2.3（星期基准反转）、3.2（不按目标集合筛）、4.2（不按 roomCategory 筛）
      各改坏一次，确认对应单测**变红**
  - ⚠️ 没红要怀疑观测手段；**红了也要确认红得对**（恒红 = 没判据）
- [x] 7.3 写「服务端需求」文档：Translator 需求 + 字段表 + 待确认的房量语义
- [ ] 7.4 code-review（独立 pass，不与实现同上下文）
- [ ] 7.5 更新 STATUS.md，记录真机验证结论与未决项
