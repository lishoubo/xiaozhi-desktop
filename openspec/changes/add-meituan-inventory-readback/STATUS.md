# 状态：美团房量回读

**2026-09-18｜代码 + 真机验证完成，已提交。剩 code-review 与失效判据。**

## 已完成（59/62 任务）

| 节 | 内容 |
|---|---|
| 1 | app-config 加 `meituanInventoryReadback`（只有 `timeoutMs`） |
| 2 | `room-change-targets.ts` —— 从写请求还原 (房型 × 日期) |
| 3 | `inventory-readback.ts` + `inventory-readback-fetcher.ts` |
| 4 | `inventory-readback-payload.ts` —— 上报体与 RMS 对接规格 |
| 5 | 接线：导出端点常量、`registry.ts` 加一行、更新注释与 registry 测试 |
| 6 | 真机验证 4 项（见下），仅 6.4 未做 |
| 7.1-7.3 | 类型检查、反向验证、服务端需求文档 |

**新增文件**（全在 `apps/desktop/src/main/channels/meituan/`）：
`room-change-targets.ts` / `inventory-readback.ts` / `inventory-readback-fetcher.ts` /
`inventory-readback-payload.ts`

**新增测试**：`meituan-room-change-targets.test.ts`(28) +
`meituan-inventory-readback.test.ts`(21) = **49 项全绿**

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

### 📌 `limitRemain` = 用户设置的房量（两组独立证据）

| 写操作 | `countType` | 回读 `limitRemain` |
|---|---|---|
| +1（结果 19） | 1620 相对 | **19** |
| 设 19 / 17 | 1520 绝对 | **19 / 17** |
| 设 18（2 房型） | 1520 绝对 | **18 / 18** |

同格 `remainCount` 为 1~2、`usedCount` 为 0，显然是不同语义。

⚠️ 三组都是「无预留房、`usedCount:0`、`limitType:1`」的干净场景，**有已售或有预留房时
三字段如何分配尚无样本** —— 已写入服务端文档 §8 请其用镜像数据复核。

⚠️ desktop 侧**仍不判读**，整行透传。结论只写文档，不进代码分支。

---

## 反向验证（7.2）

四条关键判据各改坏一次，**均变红且红的用例数不同**（不是恒红）：

| 改坏什么 | 变红用例数 |
|---|---|
| 星期基准反转（把 1 当周日） | 4 |
| 不按 `roomCategory` 筛 | 2 |
| 不按目标日期集合筛 | 2 |
| 空集合护栏失效 | 5 |

恢复后 49 项全绿。

---

## ⚠️ 未完成（3 项）

### 6.4 失效判据 —— **当前是空的**

美团失效响应无样本，所以 `parseResponse` 只判 401 / 403 / `code !== 10000`，
**刻意没写**携程那样的 HTML 登录页特征。

> 拿到真实响应前不得写猜测的特征 —— 猜的判据会让修复形同虚设且单测全绿。

需要：故意让 cookie 失效 → 取回真实响应 → 补判据 + 存脱敏 fixture。

### 7.4 code-review（独立 pass，未做）

### 减少方向（`countType: 1720`）未实测

回读逻辑不解码 `countType`（读回什么报什么），所以不影响正确性，
但多一个方向能让 `limitRemain` 的结论更稳。

---

## ⚠️ 已知阻塞：服务端 500

```
POST /api/v1/app/ota-changes → 500 (23ms)
```

与携程回读上报同因（`rmsCode: 10000` = INTERNAL_ERROR）。**desktop 侧发出正确，
端到端不通** —— 这是开 change 前就与用户确认过的边界，不是新发现的问题。

服务端待回复事项见 `服务端需求.md` §8。

---

## 全量测试的既有失败

直接跑 `vitest run` 有 12 个文件失败（`__SERVER_ORIGIN__` 等构建期常量未注入）。
**基线即如此**：改动前 12 failed/916 passed，改动后 12 failed/965 passed，
失败数未变，净增 49 个通过。

正常应通过 pnpm 脚本跑（本机 pnpm 不在 PATH，用了 `node_modules/.bin/vitest`）。
