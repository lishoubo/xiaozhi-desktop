# 状态：美团房量回读

**2026-09-18｜代码 + 真机验证 + 文档 review 完成，3 commit 未推送。code-review 进行中。**

## 已完成

| 节 | 内容 |
|---|---|
| 1 | app-config 加 `meituanInventoryReadback`（只有 `timeoutMs`） |
| 2 | `room-change-targets.ts` —— 从写请求还原 (房型 × 日期) |
| 3 | `inventory-readback.ts` + `inventory-readback-fetcher.ts` |
| 4 | `inventory-readback-payload.ts` —— 上报体与 RMS 对接规格 |
| 5 | 接线：导出端点常量、`registry.ts` 加一行、更新注释与 registry 测试 |
| 6 | 真机验证 4 项（见下）；6.4 失效判据**决定不做**，理由见文末 |
| 7.1-7.3 | 类型检查、反向验证、服务端需求文档 |

**新增文件**（全在 `apps/desktop/src/main/channels/meituan/`）：
`room-change-targets.ts` / `inventory-readback.ts` / `inventory-readback-fetcher.ts` /
`inventory-readback-payload.ts`

**新增测试**：`meituan-room-change-targets.test.ts`(28) +
`meituan-inventory-readback.test.ts`(22) = **50 项**，另加
`amount-change-watcher.test.ts` 的多标签隔离用例 1 条。相关文件合计 **59 项全绿**。

**fixture**：`tests/fixtures/meituan/query-room-status-info.json` —— 踩点的真实回读响应，
含 493879575 的 cat1/cat2 两条，未自造。

### 机制层一行未动

`channels/types.ts` / `inventory-readback-dispatcher.ts` / `amount-change-watcher.ts` /
`composition/` 全部未修改 —— 携程那次「无渠道硬编码」的设计被这次实施验证了。

`amount-change-adapter.ts` 唯一改动是把 `INVENTORY_ENDPOINT_ID` 从模块私有改成导出。

### 顺带修的既有问题

`app-config-store.ts` 的 `mergeConfig` 原本逐组手写，加第二个配置组时**类型检查直接报错**。
改成按 key 遍历 + 泛型辅助函数（直接在循环里赋值会因 key 是联合类型而把值推成交集，
需要泛型把单次调用的 K 钉死）。

原写法的失效方式是「新组的覆盖永远不生效」—— 这次因为 `AppConfig` 是全量形状才被类型系统
抓住，若当初写成可选字段就会静默。

---

## ✅ 真机验证（2026-09-18，门店 1834077877）

| # | 场景 | 操作 | 结果 |
|---|---|---|---|
| 6.1/6.2 | 单日相对改动 | 493899418，10-22 房量 **+1** | `limitRemain: 19`，109ms |
| 6.3a | **星期分档** | 10-22~10-23，周末 19 / 平时 17 | 10-22(周四)**17**、10-23(周五)**19** |
| 6.3b | **批量多房型** | 2 房型 × 10-22 各设 18 | 两格均 **18**，**一次请求**，120ms |
| 6.5 | **钟点房** | `hourRoomIdList` 设 11 | `skipped: no-targets`，**零请求** |

### ⭐ 6.1 同步写入成立 —— design 唯一无保护假设站住了

写请求是 `countType:1620, limitChangeValue:1`（纯相对操作），**报文里没有任何地方出现 19**。
回读拿到 19。全程 109ms，连加延迟的余地都没有。

这同时证明了本链路的立论：绝对值只能靠回读拿到。

### ⭐ 6.3a 一条验四个决策

```
effectWeek [1,2,3,4,7] → 17     回读 10-22(周四) = 17
effectWeek [5,6]       → 19     回读 10-23(周五) = 19
```

- **ISO 基准 1=周一**：若基准是「1=周日」，周五会落在 `[5,6]` 之外拿到 17，**数字会反过来**
- 美团「周末」= **周五周六**（与携程 `"0000110"` 同解）
- 多星期档取并集 → `dateCount: 2`
- 按目标集合精确过滤 → `cellCount: 2`

### 6.3b 批量：一次观测 = 一次回读 = 一条上报

两个 model（各一房型）汇总成 `roomIds:[a,b]` **一个请求**，两房型在同一个 `cells` 里。
这验证了决策 2.1（所有房型共用同一组日期，汇总而非按 model 配对）。

⚠️ 未验房型数量上限，实测最多 2 个。

### 6.5 空集合护栏真的挡住了

`dayRoomIdList: []` 正是那种能让 `if (ids && dates)` 式判据漏过去、最终发空报文而平台回
200 的输入。落 `skipped` 而非 `failed`，日志里一眼分得清「逻辑挡掉」与「读失败」。

> 同一 `roomId` 493879575 在 6.5 是钟点房（跳过）、在 6.3b 是日租（`cat1`, `remainCount:2`）
> —— 两副身份两个方向都对。

### 📌 `limitRemain` 的三组真机数据

| 写操作 | `countType` | 回读 `limitRemain` |
|---|---|---|
| +1（结果 19） | 1620 相对 | **19** |
| 设 19 / 17 | 1520 绝对 | **19 / 17** |
| 设 18（2 房型） | 1520 绝对 | **18 / 18** |

⚠️ **这三组的 `usedCount` 恰好全是 0**，据此得出的「`limitRemain` = 用户设的值」
是**采样偏差**，已被 fixture 里有已售的样本推翻 —— 见下方「文档 review」第 3 条。

⚠️ desktop 侧**不判读**，整行透传。结论只写文档，不进代码分支。

---

## 反向验证（7.2）

四条关键判据各改坏一次，**均变红且红的用例数不同**（不是恒红）：

| 改坏什么 | 变红用例数 |
|---|---|
| 星期基准反转（把 1 当周日） | 4 |
| 不按 `roomCategory` 筛 | 2 |
| 不按目标日期集合筛 | 2 |
| 空集合护栏失效 | 5 |

恢复后全绿。

---

## 文档 review 发现的问题（已全部处理）

两份服务端文档各跑了一次独立 review（回代码逐条核对），加上用户提的多账号场景，
修了四类问题。**其中两条是真缺陷，不是文档问题。**

### ⛔ 1. 回读上报的 `otaHotelId` 实际发的是空串（代码缺陷）

照携程抄了「service 层会用 `masterHotelId` 覆盖」的注释，但
`AmountChangeReportService.resolveOtaHotelId()` 第一行就是
`if (observed.source !== 'ctrip') return observed.otaHotelId` —— **只对携程生效**
（javadoc 明写「美团没有一店两 ID 的形状，覆盖只会引入偏差」）。

真机日志实证：上报 A 是 `'1834077877'`，上报 B 是 `''`。
后果：服务端 `AppOtaChangeLocator` 跳过按门店反查，而 cells 里只有物理房型 id。

⚠️ **原测试恰恰断言了 `otaHotelId === ''`，是它让缺陷通过的** —— 抄注释时连测试一起抄错了。

### ⛔ 2. 500 的根因定位：`change_type` 列宽不够

```
V81:  ADD COLUMN change_type VARCHAR(16)
      "inventoryReadback" = 17 字符
```

`insertReceived` 外层只 catch `DuplicateKeyException`，列宽超限抛的是
`DataIntegrityViolationException` → 500。由此推出两条此前不确定的事：
**数据 100% 丢失**（异常在 insert 那一行，`raw_body` 一条都没有）；
**DDL 前永远走不到 `UNKNOWN_ENDPOINT`**（那条路径在 insert 之后）。

所以两份文档里「Translator 没上线也没关系，desktop 可以先上线」这个前提是错的，已改。
服务端只需一行 DDL：`MODIFY COLUMN change_type VARCHAR(32)`。

### ⚠️ 3. `limitRemain` 的结论要修正

fixture 里有 `usedCount > 0` 的样本，同房型连续四天：

| date | limitRemain | usedCount | 和 |
|---|---|---|---|
| 09-19 | 20 | 0 | 20 |
| 09-21 | 19 | **1** | 20 |
| 09-18 | 1 | **2** | 3（那天单独设过） |

**`limitRemain` = 用户设的配额 − 已售**，不是设定值本身。
真机三组的 `usedCount` 恰好全是 0，所以看起来像相等 —— **采样偏差**。
服务端直接拿它当「用户设了多少房」，在有已售的日期上会偏小。

（另：`remainCount + usedCount` 恒为 2 = 物理房量，与 `limitRemain` 无关。）

### ⚠️ 4. 单房型页面完全不产生上报 B

该页面发 `separateOperateInvDateList[]`（注意 `modifyParamByEffectWeek` 是**单数**），
desktop 与服务端 Translator 都只认 `unifiedOperateInvDateModel`。
**既有缺口，不是回读引入的**，但文档原先「日期恰好精确」的绝对化措辞会让服务端
以为覆盖完整。

---

## 多账号 / 多标签页（用户提问，已验证）

**安全。** 逐层核实：partition 名 `persist:xiaozhi:<env>:<channel>:<shortId>`，
shortId 在创建登录标签页那一刻随机生成（= 每次登录一份，账号粒度）；每个 tab 的
`WebContentsView` 用自己那份 session；watcher 闭包捕获 `event.webContents` 一路传到回读；
`executeJavaScript` 在哪个 view 跑就带哪份 cookie。

⚠️ 但**此前没有测试守着** —— 正确性只靠「webContents 原样传递」这个隐式约定，
任何一处改成「取当前活动标签页」都会串台，且失效静默（把 A 酒店的房量报成 B 酒店的）。

已补 `amount-change-watcher.test.ts` 的固化测试，反向验证：回读 wc 固定成第一个、
上报 partition 固定成第一个，两种串台方式各自让它变红。

---

## 一个值得记住的模式

⚠️ **照携程抄结构时，连带抄走了不适用的前提** —— 同一个毛病犯了三次：

| 抄来的 | 为什么不适用 |
|---|---|
| `otaHotelId` 留空串等 service 覆盖 | 那段归一只对携程生效 |
| HTML 登录页失效判据 | 携程那套继承自后台无人值守的 worker |
| 「数据不丢，desktop 可先上线」 | 列宽问题让报文根本落不了库 |

结构可以抄，**前提必须逐条回到自己的语境重新验证**。

---

## ⚠️ 未完成

### 7.4 code-review（独立 pass）—— 进行中

### 减少方向（`countType: 1720`）未实测

回读逻辑不解码 `countType`（读回什么报什么），不影响正确性，
但多一个方向能让 `limitRemain` 的结论更稳。

### 失效判据 —— **决定不做**（原 tasks 6.4）

回读发生在用户刚操作成功的那个标签页里，上一秒才保存成功、下一秒登录失效的场景
基本不存在；且回读失败不重试不落盘，判成哪种失败对行为没有任何影响。
理由已写进 design 与代码注释，免得下个人当成待办再捡起来。

---

## ⚠️ 已知阻塞：服务端 500（根因已定位）

```
POST /api/v1/app/ota-changes → 500 (23ms)
```

**根因是 `change_type` 列宽不够**（`VARCHAR(16)` vs 17 字符的 `"inventoryReadback"`），
与携程回读同因。详见上方「文档 review」第 2 条。

服务端只需一行 DDL：`ALTER TABLE app_ota_change_target MODIFY COLUMN change_type VARCHAR(32)`。
⚠️ 线上 Flyway 已关，需人工执行；V81 本身在生产是否已执行也要一并核。

在此之前 **desktop 侧发出正确，端到端不通、数据 100% 丢失**。

---

## 全量测试的既有失败

直接跑 `vitest run` 有 12 个文件失败（`__SERVER_ORIGIN__` 等构建期常量未注入）。
**基线即如此**：改动前 12 failed/916 passed，改动后 12 failed/965 passed，
失败数未变，净增的全部是通过项。

正常应通过 pnpm 脚本跑（本机 pnpm 不在 PATH，用了 `node_modules/.bin/vitest`）。
