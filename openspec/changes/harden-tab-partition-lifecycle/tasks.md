# tasks — 账号提取加固（探测稳定性 + 身份口径）

> 来源：2026-08-14 对标签管理（标签打开 → ota-credential 提取 → 关联）的一次
> 集中 review。
>
> **范围已收窄**：原 T5（partition 生命周期治理）在实施过程中被推翻并移交给
> `ota-tab-entry-and-partition-lifecycle`，本 change 只保留「账号提取」这一条主线
> —— 探测能不能稳定拿到身份、拿到的身份对不对。
>
> **不写 proposal**（用户明确要求）。T4 改了设计，单独出踩点文档。
>
> 代码位置速查：
> ```
> main/browser/partition.ts          partition 命名规则（纯函数）
> main/browser/session-factory.ts    partition 名 → Electron Session（唯一开口）
> main/browser/browser-manager.ts    tab 生命周期 + retirePartition
> main/ota-tab/ota-tab-service.ts    四种打开意图 → partition 策略
> main/ota-tab/login-detector.ts     导航 → 登录判定 → 触发探测
> main/services/ota-credential-service.ts  身份探测调度 + credential 归并
> main/database/ota-credential-repository.ts
> main/file-store/pending-partitions-store.ts
> main/channels/{ctrip,douyin,meituan}/discovery.ts
> ```

---

## T1 探测失败后允许在同一 tab 内重试 🔴 体感最强

**现状缺陷**：`login-detector.ts:101` 在**进入** `triggerDiscovery` 前就
`this.triggered.add(event.tabId)`，且失败后**不移除**。于是：

```
tab 内第一次导航 → 探测失败（返回 null）→ triggered 永久保留该 tabId
tab 内后续任何导航 → :84 命中 triggered → 直接走 not-applicable，再也不探测
```

用户体感就是「登录成功了但账号没出来，刷新也没用，必须关掉标签页重开」。
与 T2（抖音 5s 硬超时）叠加后，是「账号提取不稳定」的**主要来源**。

- [x] `main/ota-tab/login-detector.ts` ✏️
  - `triggerDiscovery` 返回 `null` 时 `this.triggered.delete(event.tabId)`，
    允许同一 tab 的后续导航重试
  - 返回非 null（探测成功）才保留 `triggered` 标记
  - ⚠️ **实现时修正**：`triggered` 仍需承担 **tab 维度**的并发门（原计划想把并发
    完全交给 `inflight`，但那是 **partition 维度**的，挡不住同 tab 连续两次导航）。
    最终写法是 `try/finally` + 「失败才 delete」：成功保留标记，失败/抛错放开重试，
    探测进行中标记仍在 → 并发导航不叠加。两者分工已写进字段注释
  - 🐛 **顺带修掉**：原实现 `triggerDiscovery` 抛错时既不移除标记、也不广播
    `credential-checked`，标签页被永久判死。现在抛错走同一条重试路径
- [x] 测试 `login-detector.test.ts` ✏️（11 用例全过）
  - happy path：探测成功 → 同 tab 再导航 → 不重复探测
  - 🔴 边界：探测失败 → 同 tab 再导航 → **会重新探测**
    （已确认该用例在旧代码上失败：`expected "spy" to be called 2 times, but got 1`）
  - 边界：探测进行中的并发导航不重复触发

## T2 抖音探测超时放宽 + 失败可观测

**现状缺陷**：`douyin/discovery.ts:48` 轮询 session storage，
`20 次 × 250ms = 5 秒`硬超时，超时即 `kind: 'none'`，纯轮询无事件驱动。
三家里最容易偶发失败的一个，与用户「账号提取不稳定」的直觉一致。

- [x] `main/channels/douyin/discovery.ts` ✏️
  - 轮询上限 5s → **15s**，取 `hotel-prob.ts` 的 `RESPONSE_WAIT_TIMEOUT_MS = 30000`
    的一半（那是「点菜单 + 等页面 + 等接口」的完整链路，这里只等前端写 storage）。
    魔数 20 拆成 `IDENTITY_WAIT_TIMEOUT_MS` / `IDENTITY_POLL_INTERVAL_MS` /
    `IDENTITY_MAX_ATTEMPTS` 三个具名常量
  - 超时与解析失败分成两句 warn，并带上 `waitedMs`
  - 「失败即 `none`、不产生脏数据」语义未变
- [x] `main/channels/meituan/discovery.ts` ✏️ + `main/channels/ctrip/discovery.ts` ✏️
  - 未加重试（按计划：T1 已让整个 tab 可重试，渠道层再叠一层会让失败路径难推理）
  - 携程：`parseCtripHotelDom` 返回 `null`（DOM 缺失/读不到）与返回空数组
    （DOM 在但解析不出酒店）分成两句 warn —— 前者是页面没渲染完，后者是携程改了结构
  - 美团：解析不出账号时带上 `hasResponse`，与 catch 分支（请求本身没成）区分开
- [x] 测试（抖音 4 用例，携程 4，美团 2，全过）
  - 抖音用 `vi.useFakeTimers()` + `runAllTimersAsync()`，**不硬编码轮数**：
    锁的是「等待期间空值不算失败」「超时与解析失败记两句不同的 warn」，
    超时值可调而语义不变

## T3 credential ↔ partition 关联的两个正确性缺陷

### T3.1 去掉阻断账号切换的多余 throw 🔴

**现状缺陷**：`ota-credential-service.ts:161-163`

```ts
if (existing) {
  throw new Error('新 partition 已关联另一条 credential，无法替换渠道账号登录态');
}
```

触发路径真实存在：**用户在同一个 partition 里切换渠道账号**（携程/美团后台支持）。
此时 `existing` 是旧账号的 credential、`identified` 是新账号的，两者 id 不同 →
直接抛错 → 被 `:127-132` 的 catch 吞成一行 warn + `return null` →
用户看到「登录成功但没反应」。

- [x] `main/services/ota-credential-service.ts` ✏️ 删掉那句 throw，改为
  「新账号接管 partition + 清理被顶替的旧 credential」
- [x] `main/database/ota-credential-repository.ts` ✏️ 新增 `deleteById()`

### T3.1 实现中修正的两处判断

**① 「让出 partition、保留 credential」这个原方案行不通，改为直接删除。**

原计划让旧账号只解除 partition 指向、记录保留。实现时发现表达不出来：

| 让位表示 | 结果 |
|---|---|
| 空串 | 撞 `partition_name` 的 UNIQUE（两条让位的就冲突）；`createOtaCredential` 本身也禁止空串 |
| NULL | SQLite 允许多个 NULL，语义也对 —— 但列是 `NOT NULL`，要加 migration，且 `OtaCredential.partitionName` 要变 `string \| null`，**所有拿它开 tab / 读 cookie 的地方都得处理 null** |

更关键的是**「让位」根本不是临时状态**（用户提问点）：`listByChannel` 喂着账号切换、
新增绑定、重新登录三个 UI，一条没有 partition 的 credential 会**长期**摆在列表里，
用户点中就拿着一个不属于自己的 partition 开标签页 —— 开出来是**新账号**的页面。
这是持续的错误选项，不是暂时闲置。所以直接删。

**② `ota_hotel` 跟着删 —— 但它不是「绑定关系」，我一开始的措辞是错的。**

用户指出「本地应该没记绑定关系」，属实：`shared/types/ota-hotel.ts` 明确写着
「OTA 酒店与 RMS 酒店之间的绑定关系由远端持有，本地不表达」，表里没有 rmsHotelId、
没有绑定时刻，存的是**门店信息 + 渠道上下文**（`otaPartnerId` / `merchantGroupId`）。

跟着删仍然成立，理由是：
- 唯一读取处是 `HotelManagementService` 里「远端这条绑定是哪个 credential 建的」反查，
  且该反查**优先走远端 `bindExtra`**，本地这张表只是兜底；查不到只少一个展示标注，
  注释自述「不该因为一条脏数据让整个弹窗报错」，不阻断流程
- credential 已经不存在了，指向它的门店行本就失去意义
- `ota_hotel.credential_id` 是 `ON DELETE RESTRICT`，**不先删它就根本删不掉 credential**

- [x] 测试 `ota-credential-service.test.ts` ✏️（14 用例）
  - 🔴 同 partition 换账号 → 不抛错、新账号迁到当前 partition（**已确认旧代码上失败**）
  - 🔴 被顶替的旧 credential 被清理
  - 🧹 顺带删掉已失效的 `携程多酒店结果不创建 credential` —— discovery 不再返回
    `multiple`（T4 已删该分支），这条用例锁的是不存在的行为
- [x] 测试 `database/ota-credential-repository.test.ts` ✏️（11 用例，**真实 SQLite**）
  - 级联删除清掉 `ota_hotel` 行
  - **顺序不能反**：先门店后 credential，否则被 RESTRICT 外键抛错留下半截状态
  - 删除后该 partition 可被另一条 credential 重新占用（UNIQUE 腾位）
- [x] `lint` ✅ / `check:types` ✅ / 全量 `test:unit` → **80 文件 546 用例全过**
- [ ] ⚠️ **真机未验**：需要在携程或美团后台**同一标签页内直接切换账号**，
      确认新账号归并成功、旧账号从账号列表消失、且没有误删正在用的账号

### T3.2 ~~`partition_name` 加唯一约束~~ —— ✅ 无需改动，约束早已存在

**结论订正**：`application-database.ts` migration 3（`create-ota-credential`）第 101 行
已经是 `partition_name TEXT NOT NULL UNIQUE`。

review 时只读了 `ota-credential-repository.ts`（那里确实没有任何唯一性表达）就下了
「表上没 UNIQUE」的判断，没往上查 schema —— **该结论作废**。

对 T3.1 的影响：去掉那句 throw 之后，数据库兜底**本来就在**，不需要额外迁移。

## T4 携程多门店账号无法绑定 🔴 数据缺失级 + 需单独设计

**现状缺陷**（本次 review 新发现，不在最初三点担心里）：

```
ctrip/discovery.ts:45     hotels.length > 1 → { kind: 'multiple' }
ota-credential-service.ts:85-91  multiple → return null，不写库、不 bound.add
login-detector.ts         广播 outcome.credential = null
hotel-probe-dispatcher.ts:54     credential 为 null → 直接 return，不探测
```

**结果：多门店携程账号永远探测不出 credential，门店探测被完全跳过，绑不了。**
且携程标签页「只导航一次，没有第二次机会」（`login-detector.ts` 注释自述），
连重试的机会都没有。

根因是设计层的：**携程把酒店 ID 直接当成了账号身份**
（`discovery.ts:51` `channelAccountId: hotel.otaHotelId`）。一个携程账号管多家
门店时，这个等式不成立，`multiple` 分支只能放弃。

### T4 踩点结论（2026-08-14 真机，`docs/踩点/携程/账号身份.md`）

携程页面挂着官方 SDK `window.HEAppInfo`，账号与酒店**本来就是两组独立字段**：

```
HEAppInfo.getUserInfo()   huid 12324831 / userName 银际青山店 / login ...   ← 账号
HEAppInfo.getHotelInfo()  masterHotelId 85068938 / hotelName ...           ← 酒店
```

同一份身份还冗余写在 cookie `imislogin`、`HEMicroUserTag`、`window.HEUbtBaseData`
（后者用作 SDK 未就绪时的兜底）。至此三渠道口径统一：抖音 `user_id`、美团登录账号、
携程 `huid`。

⚠️ 本次账号是单店（`isSingleHotelViewer: true`），**多门店实样未取到**；
`getHotelInfo().hotelList` 存疑（5 个 9 位 ID，与 8 位的 `masterHotelId` 量级不同，
疑似子房型而非可绑定门店），不得直接当门店候选。

### T4 实现（已完成）

用户决策：① 保持 discovery 顺手存酒店、hotel-prob 照旧读 `credentialExtra`（不新增
页面操作）；② 老数据不迁移，沿用 migration 8「下次重新探测自然改写」的惯例。

- [x] `channels/ctrip/account-identity.ts` 🆕 —— 读 `HEAppInfo`，SDK 未就绪时退回
  `HEUbtBaseData`，两条来源归一后带 `identitySource` 区分。`hotelId: -1` 等
  携程表达「无」的写法在此归一为 null
- [x] `channels/ctrip/discovery.ts` ✏️ 改读账号身份；**`kind: 'multiple'` 整个删除**
  —— 身份是 `huid`，与门店数量无关，多门店不再需要放弃
- [x] `channels/ctrip/hotel-dom.ts` ❌ 删除（已无引用，按 CLAUDE.md 清理废弃代码）
- [x] `channels/ctrip/hotel-prob.ts` ✏️ 改读 `masterHotelId`，**同时兼容老记录的
  `hotelId`** —— 老数据不迁移，只认新字段会让老账号的酒店探测当场失效
- [x] `services/ota-credential-service.ts` ✏️ 删掉 `multiple` 分支
- [x] 🔴 **三处「显示名」联动**（改口径的连带影响，容易漏）：携程 `credentialExtra`
  里 `userName`（账号名）与 `hotelName`（酒店名）**并存**，凡是按优先级取名的地方，
  `hotelName` 都必须排到 `userName` 之后，否则新记录一律显示成酒店名 = 等于没改
  - `channels/bind-extra.ts` 的 `channelAccountNameOf`（供绑定上报 + 改价上报）
  - `renderer/hotel-management/credential-presentation.ts`（标题取账号名，
    酒店退为 details 佐证；`details` 的酒店 ID 兼容 `masterHotelId` / `hotelId`）
  - `renderer/components/browser/login-credential-options.ts`（账号切换下拉标签）
- [x] 测试：`ctrip-discovery.test.ts` 重写（7 用例，样本取自真机踩点）、
  `ctrip-hotel-prob.test.ts` 🆕（7 用例，**新旧字段兼容是重点**）、
  `ota-credential-service.test.ts` 与两个 renderer 测试更新为新口径并补老记录用例
- [x] `lint` ✅ / `check:types` ✅ / `check:svelte` ✅（994 文件 0 错误）
- [x] 全量 `npm run test:unit` → **80 文件 542 用例全过，无回归**
- [ ] 🔴 **真机验证（未做）**：重新登录携程 → 确认 credential 的 `channelAccountId`
      变成 `huid`、账号列表显示账号名、绑定流程能出门店候选
- [ ] 🔴 **多门店账号验证（阻塞：无此账号）** —— 用户确认手上没有多门店携程账号。
      多门店下 `getUserInfo` / `getHotelInfo` / `getMgrGroupInfo` 的实际形状、
      以及门店候选怎么列，**仍未解决**；本次只解决了「账号身份不再等于酒店」
      与「账号名可读」，多门店候选列表是后续独立任务

## T5 ~~partition 生命周期治理~~ → 已移交新 change

**移交原因**：排查「sandouhotel 点登录却进登录页」时发现，T5 原本的定性（磁盘垃圾
堆积、缺清理机制）是错的。真正的根因是**退休时机挂在「关 tab」这个无关事件上**，
导致 `retirePartition` 会清掉 credential 正指向的 partition —— 不是"该清的没清"，
而是**"不该清的清了"**，已实际丢失 5 个美团账号的登录态。

这不是清理策略问题，是 partition 生命周期本身没有定义；在原基座上加清理触发点只会
把问题叠在错误的地基上。连同 6 个开 tab 入口的梳理一起移交：

→ **`openspec/changes/ota-tab-entry-and-partition-lifecycle/`**

---|---|---|
| **绑定流程** | `openExistingInFreshPartition` 每次绑定必开一份新 partition（该方法注释自述「代价是每次绑定都会留下一份新 partition。已知，暂时接受」） | 探测成功即被 `removePendingPartition` 摘除 → **无痕迹孤儿** |
| 探测失败 | `open` / `createFromCookie` 开了 partition，用户没登录成功就关 tab | 留在 json ✅ |
| 重试登录 | 同一账号反复「去登录」，每次一份新 partition | 成功的被认领，其余留 json ✅ |
| **retire 未完成** | 见下 | **无痕迹孤儿** |

**retire 未完成的机制**：`browser-manager.ts:62` 的 `retiredPartitions` 是
`BrowserManager` 实例字段，而 `BrowserManager` 属于 **window scope**。一个
「已标记退休、但当时有 tab 占用还没清掉」的 partition，**应用重启/窗口重建后
这个 Set 清空，就永远不会再被清理** —— 它同时不在任何 credential 上（已迁移走）、
也不在 json 里（已摘除）。

最狠的是绑定流程那条：**每绑定成功一次，稳定产生一份磁盘上完全无记录的僵尸
partition**，每份带完整 Cookies / LevelDB / IndexedDB。绑 10 次门店 = 10 份。

另有一处泄漏：`session-factory.ts:19` 的 `cache: Map<string, Session>` 除了
`clearAccountSession` 里那一次 `delete` 外**没有任何淘汰**，tab 关闭不释放。
内存量不大，但配合「每次绑定新建 partition」是纯粹的只增不减。

还有一点须在设计里正视：`clearAccountSession` 只 `clearStorageData` + `clearCache`，
**不删目录**（Electron 确实无此 API，`session-factory.ts:87-91` 注释已承认）。
所以磁盘目录数只增不减，「清理」的上限就是清空内容。

- [ ] 🔴 **先出 `design.md`**（本任务不写代码，先定方案）。核心问题是
      **没有「partition 全集」这个事实来源** —— 真相散在三处：credential 表、
      pending json、磁盘目录。要清理必须先能枚举全集。两条候选路：

  | 方案 | 做法 | 优点 | 缺点 |
  |---|---|---|---|
  | **A（倾向）** | `pending-partitions.json` 升级成 `partitions.json`：**记录每一个创建过的 partition，条目永不删除，只改状态**（`pending` / `claimed:<credentialId>` / `retired`） | 绑定流程的中间 partition 与重启丢失的 retire 都有据可查；不依赖未公开实现细节 | 需迁移现有 json；对历史遗留孤儿无能为力 |
  | B | 启动时扫 `<userData>/Partitions/` 取全集，与 credential 表做差集 | 能捡回历史遗留孤儿 | 依赖 Chromium 未公开目录结构，与 `pending-partitions-store.ts:1-22` 明确拒绝的做法冲突 |

  design 还要定：
  - 清理**触发点**（应用启动时？空闲时？两者都要？）
  - 「正在被 tab 使用」的守卫（`browser-manager.ts:276` 的
    `clearRetiredPartitionWhenUnused` 已有半截逻辑可复用）
  - `retiredPartitions` 从 window scope 的内存 Set 挪到持久化状态（否则重启丢失
    的问题原样存在）
  - `SessionFactory.cache` 的淘汰时机
  - B 作为**一次性迁移清理**是否值得单独做一次
  - 是否顺带给 `openExistingInFreshPartition` 减少 partition 产量（例如绑定完成
    后主动 retire 中间 partition），还是维持「先记录、后统一清理」
- [ ] 按 design 结论实现 + 测试
- [ ] 验证：连续绑定 N 次 → 确认僵尸 partition 被清理、且**在用的登录态没被误清**
      （误清等于让用户掉登录，是本任务最大风险）

---

## 进度（2026-08-14）

| 任务 | 状态 |
|---|---|
| T1 探测失败可重试 | ✅ 完成 |
| T2 抖音超时放宽 + 三渠道日志区分 | ✅ 完成 |
| T3.1 去掉阻断换账号的 throw | ✅ 代码完成，**真机未验** |
| T3.2 partition_name UNIQUE | ✅ 无需改动（约束早已存在，原结论有误） |
| T4 携程身份口径 | ✅ 代码完成，**真机未验**；多门店候选仍未解决 |
| T5 partition 生命周期 | 💬 讨论中，未动代码 |

**完成态验证**（T1 + T2 + T4）：
- `npm run lint` ✅ / `check:types` ✅ / `check:svelte` ✅（994 文件 0 错误）
- 全量 `npm run test:unit` → **80 文件 542 用例全过，无回归**
- ⚠️ **全部是单测**。以下均未经真机验证：
  - 抖音 15s 超时的实际效果、三渠道 warn 的区分度（T2）
  - 携程新身份口径在真实登录流程里是否跑通（T4）—— `HEAppInfo` 是在**已加载完的
    页面**上读到的，登录后落地那一刻是否已就绪**没验过**，这是 T4 最大风险

## 完成门禁

- T1 / T2 / T3 是小任务，直接实现 → 定向测试 → 完成态跑一次受影响模块 ✅
- T4 触及 credential 身份口径 —— 按 CLAUDE.md 完成门禁，归档前确认是否需要同步
  `openspec/specs/local-ota-credentials/`
- 🔴 **归档阻塞项**：T3.1（同 partition 换账号）与 T4（携程新身份口径在全新登录
  路径上）**均未真机验证**。T4 只在「已有 partition 恢复后导航」这条路上验过，
  走 `existing` 分支；`create` 分支（cookie 导入 / 全新登录）未走到
- T4 的多门店候选**未解决**（无多门店携程账号），已明确记录，不算本 change 范围
- 验证证据写入本目录 `verification.md`
