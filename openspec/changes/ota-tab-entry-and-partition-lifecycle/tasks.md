# tasks — OTA 标签入口梳理与 partition 生命周期

> 承接自 `harden-tab-partition-lifecycle` 的 T5。**该任务原本的定性是错的**，
> 详见下方「为什么要重新梳理」。
>
> **先出 `design.md` 再动代码**（🔴 除 P0 止血外）。入口有 6 个、partition 策略有
> 3 种、回收只有 1 条路且时机挂错了事件 —— 这是生命周期没定义，不是缺个清理函数。

---

## 为什么要重新梳理

排查用户报的「sandouhotel 点登录却进登录页」时，发现的不是「该清的没清」，而是
**「不该清的清了」**：

```
7 个美团 credential → 5 个指向的 partition 登录态已被清空
                     只剩 Btphhldxm、yinjijiudian 还能用
21 个 partition 目录 → 只有 9 个被 credential 引用，11 个是无人认领的孤儿
```

**产出与回收严重不对称**：6 个入口里 4 个会新建 partition，回收只有一条路
（`onCredentialPartitionReplaced` → `retirePartition`），且触发时机挂在「关 tab」
这个与生命周期无关的事件上。

---

## 现状盘点（已核实，2026-08-14）

### 6 个开 tab 入口

| # | 入口 | renderer 调用点 | 主进程方法 | partition 策略 |
|---|---|---|---|---|
| 1 | 已登录列表 → 登录新渠道账号 | `AccountSwitcherDialog.svelte:141` → `onNewLogin` | `open()` | 🆕 新建 |
| 2 | 已登录列表 → 从 Cookie 导入 | `CookieLoginListDialog.svelte:75` | `createFromCookie()` | 🆕 新建 + 注入 cookie |
| 3 | 已登录列表 → 点某个账号 | `BrowserWorkspace.svelte:110` | `openExisting()` | ♻️ 复用 |
| 4 | 标签区 `+` 开渠道标签 | `BrowserWorkspace.svelte:75` `createTab()` | `open()` | 🆕 新建 |
| 5 | 酒店管理 → 新增绑定账号 | `BindHotelDialog.svelte:84/86` | `openExistingInFreshPartition()` / `open()` | 🆕 新建（+ 搬 cookie）/ 🆕 新建 |
| 6 | 酒店管理 → 失败账号重新登录 | `ReauthDialog.svelte:58` | `openExisting()` | ♻️ 复用 |

**4 / 6 会新建 partition。** 入口 5 尤其可疑：`openExistingInFreshPartition` 的注释
自述「代价是每次绑定都会留下一份新 partition。已知，暂时接受」—— 每绑一次留一份。

### partition 的产生与回收

```
产生（4 条路）                          回收（1 条路）
─────────────────────────────          ─────────────────────────
open()                    ──┐          onCredentialPartitionReplaced
createFromCookie()        ──┼──→ 新建   → retirePartition(旧的)
openExistingInFreshPartition ─┘           → retiredPartitions.add()
                                          → clearRetiredPartitionWhenUnused()
openExisting()            ──→ 复用          守卫：只看「有没有 tab 开着」❌
```

### 🔴 P0 BUG：退休守卫会清掉 credential 正在用的 partition

`browser-manager.ts`：

```ts
close(tabId: string): void {
  // ...
  for (const retiredPartition of this.retiredPartitions) {   // 遍历整个集合
    void this.clearRetiredPartitionWhenUnused(retiredPartition).catch(() => {});
  }
}

private async clearRetiredPartitionWhenUnused(partitionName: string) {
  const stillUsed = [...this.tabs.values()].some((t) => t.partitionName === partitionName);
  if (stillUsed) return;                    // ← 只检查 tab，不检查 credential 引用
  await this.sessionFactory.clearAccountSession(partitionName);   // clearStorageData()
}
```

两个缺陷叠加：

1. `retiredPartitions` **只加不减**（清成功才 delete），会攒着
2. **每关一个 tab 就把整个集合重扫一遍** —— 触发时机与「谁替换了谁」无关

真机日志实证（2026-08-13 20:27~20:34，用户连续绑 4 个美团账号，每个账号登两次）：

```
20:33:06  Browser tab created  09a47691   ← 新建
20:33:09  discovery found                  ← 探到 yungeerAI（已存在）→ 搬到 09a47691
20:33:10  Retired browser partition cleared
20:33:18  Browser tab closed  ┐
20:33:19  Browser tab closed  ├ 每次 close 重扫全集合
20:33:20  Browser tab closed  ┘
20:33:20  Retired browser partition cleared   ← 又清了一个
```

结果：`09a47691` / `1cfea350` / `4f681a4f` 都是 credential 当前指向的、20:33 刚建的
partition，现在 **cookie 数为 0**。`a033f181`（sandouhotel）只剩 7 条埋点 cookie，
`epassport.meituan.com` 的 `eplt`/`eprt`、`me.meituan.com` 的 `mebsid` 全没了 ——
那才是美团的登录态。

### 存量损坏清单

| partition | 账号 | 状态 |
|---|---|---|
| `0ee20e00` | Btphhldxm | ✅ 14 条 cookie，登录态在 |
| `3e1086c5` | yinjijiudian | ✅ 22 条 cookie，登录态在 |
| `a033f181` | sandouhotel | ❌ 只剩 7 条埋点 cookie |
| `09a47691` | yungeerAI | ❌ 0 条 |
| `1cfea350` | wudeAI | ❌ 0 条 |
| `4f681a4f` | anmanAI | ❌ 0 条 |
| `e60374c8` | BaijiaAI | ❌ 0 条（08-12 同模式更早一例） |

孤儿（磁盘上有、无 credential 引用）11 个：`13489384` `15c5bca9` `1b6d52f6`
`498e5c3b` `59fb27f7` `5c799edd` `5f747ad8` `5fc53960` `bc04efb9` `cbf87865` `cff1c0e0`

---

## 实施结果（2026-08-14，五项全部完成）

| # | 任务 | 状态 |
|---|---|---|
| ① | G2 守卫：不清被 credential 引用的 partition | ✅ |
| ② | `close()` 不再全量重扫退休集合 | ✅ |
| ③ | 第 5 条路：复用 partition + 删抖音 PoiSwitch 键 | ✅ |
| ③b | 四层重命名对齐（含 IPC 契约） | ✅ |
| ④ | `partitions.json` 账本 + 启动清理 | ✅ |
| ⑤ | 存量孤儿 partition 清理 | ✅ |
| ⑥ | `SessionFactory.cache` 语义订正（原诊断有误） | ✅ |

**验证**：`lint` ✅ / `check:types` ✅ / `check:svelte` ✅（994 文件 0 错误）/
全量 `test:unit` → **82 文件 577 用例全过**（改动前 80 文件 554 用例）。
⚠️ 全部为单测，**真机未验**，见下方门禁。

### ① G2 守卫（`browser-manager.ts`）

- [x] 注入 `isPartitionClaimed` 窄回调（照 `setPartitionRetirer` 套路，
      `BrowserManager` 仍不认识仓储）；window-scope 接 `findByPartitionName`
- [x] 守卫命中时**撤销**退休标记 + warn —— 留着会被之后每次 `close()` 反复重扫，
      只要某刻 credential 短暂不指向它就会得手
- [x] 测试 5 条，其中「仍被引用绝不清理」「撤销后不再重试」**已确认在旧代码上失败**

### ② 退休触发时机（`browser-manager.ts`）

- [x] `close(tabId)` 只重试**该 tab 自己的** partition。本次关闭唯一新增的事实是
      「它少了一个占用者」，与集合里其他条目无关 —— 原实现的全量重扫是事故放大器

### ③ 第 5 条路 —— ⚠️ 三次尝试失败，最终维持新建 partition

**初稿设想「复用 partition + 清本地存储」，四条路真机全败**（详见 design §3.1.1）：
删 `core:PoiSwitch:` 键 ❌、清 Service Worker 两种 API ❌、绕开 SW ❌、拦跳转 ❌。

根因是**服务端记着这个会话上次用的 `life_account_id`**，页面脚本读到就自己跳走
（CDP 实证 `reason=scriptInitiated`，全程 200 无 302），清本地存储动不了它。

- [x] 维持 `e977c06` 的做法：新建 partition + 注入原账号 cookie
- [x] **但补上账本登记**（`recordPartitionCreated`）—— 这正是当年那句「已知代价，
      partition 生命周期治理另行处理」欠下的一环
- [x] 四条失败路径 + 根因写进 `openExistingForBinding` 方法注释，并注明
      「这条路靠 cookie 不完全等价生效、抖音改判定就会再失效」的警告
- [x] ❌ 删除 `channels/binding-reset.ts` 与 `BrowserManager.runInTab()`
      （基于错误诊断加的，已无用）
- [x] 🔴 **真机验证通过**（2026-08-15）：绑定停在选公司页、成功绑定清水湾舒馨酒店；
      账本记录 `915ef78a → pending`、`f5740df2 → claimed`

### ③b 重命名
- [x] 四层重命名：channel 字符串 / preload / service / renderer store 全部对齐
      （`open`→`openForNewLogin`、`createFromCookie`→`openWithImportedCookie`、
      `openExistingInFreshPartition`→`openExistingForBinding`）
- [x] 新名描述**意图**而非手段 —— 事实证明这个选择是对的：手段在本轮换了三轮
      （复用+删键 → 复用+清SW → 回到新建 partition），名字一次都没作废

### ④ 账本（`file-store/partition-ledger.ts` 🆕）

- [x] 状态机 `pending → claimed → retired → cleared`，三个接线点全部改到账本：
      创建（`ota-tab-service`）/ 认领（`markPartitionClaimed`，取代原
      `removePendingPartition`）/ 退休（`onCredentialPartitionReplaced` 先落账本再清理）
- [x] `cleared` 按 50 条 + 30 天双上限裁剪；**活状态不裁**
- [x] 🐛 实现中修掉一处：时间戳解析失败原会被当成「无限旧」直接丢弃 —— 改为保留，
      裁剪不该因为一个脏时间戳静默删记录
- [x] 账本损坏当作空账本，不阻断启动（它是索引，credential 表才是权威）
- [x] ❌ 删除 `pending-partitions-store.ts`（已被账本取代，`PendingPartition`
      类型迁入账本）
- [x] 测试 10 条（含并发不丢条目、损坏文件、裁剪四种情形）

### ⑤ 启动清理（`browser/partition-cleanup.ts` 🆕）

- [x] `cleanupRetiredPartitions` —— 清账本里 `retired` 的
- [x] `cleanupOrphanPartitions` —— 扫磁盘找账本外的孤儿（存量 11 个走这条）
- [x] **两者都仍查 credential 表**：账本只是索引，以 credential 表为准（事故教训）
- [x] `isOtaLoginPartition` 守卫：`server-api` / `rms-api` 段数不足，天然挡在外面
- [x] 在 `app-scope` 装配、`index.ts` 启动后 fire-and-forget 调用；
      失败只记日志，**绝不阻断启动**
- [x] 测试 11 条（含「账本说 retired 但 credential 还在用 → 绝不清」
      「不碰基础设施 partition」「单个失败不阻断其余」）

## design 待答问题 —— 已全部收敛

| 问题 | 结论 |
|---|---|
| 4 个新建入口是否都必须新建 | 实为 **8 条路**（酒店管理是 4 条不是 1 条，用户提醒后核实）。只有「绑定·选已有账号」可收敛，已改 |
| 生命周期定义 | `pending → claimed → retired → cleared`，见 `partition-ledger.ts` |
| 事实来源 | `partitions.json` 账本；旧 `pending-partitions.json`（只写不读）已删 |
| 清理触发点 | 启动时（无标签页占用，最安全）+ 替换事件即时 + tab 关闭补清该 tab 那一个 |
| `retiredPartitions` 跨重启丢失 | 退休状态落账本，启动清理兜底 |
| 存量修复 | 11 个孤儿由 `cleanupOrphanPartitions` 静默清理；5 个已损坏 credential **不自动删**（身份信息仍有效，走现有 reauth 流程重新登录） |
| `clearAccountSession` 不删目录 | 已正视：清理上限是清空内容，目录数只增不减。控量靠减少产出 |

### ⑥ `SessionFactory.cache` —— ✅ 已改，但**原诊断是错的**

初稿把它记成「只增不减的内存泄漏，该加淘汰」。用户追问「为什么会有这一层」，
重新读代码后发现**判断错了两处**：

| | 初稿以为 | 实际 |
|---|---|---|
| 它是什么 | Session 对象池 | **「已装过安全 handler」的标记表** |
| 该怎么办 | 加淘汰策略 | **不该淘汰**，条目只增不减是正确行为 |

理由：`session.fromPartition()` 对同名**永远返回同一个 Session**（Electron 语义），
对象由 Electron 全局持有 —— 我们缓存它毫无意义，也管不着它的生命周期。这层唯一的
职责是让 `denyEmbeddedPagePermissions`（两个**覆盖式** setter）只装一次。而「已装过」
这个事实在整个进程生命周期内恒真，撤销标记只会导致重复装。

- [x] `Map<string, Session>` → `Set<string> configuredPartitions`，类型即语义
- [x] `fromPartitionCached` → `configuredSession`（旧名暗示「缓存对象」，是误导之源）
- [x] 🐛 **删掉 `clearAccountSession` 里那次 `cache.delete()`** —— 清空存储不销毁
      Session、handler 仍挂着，撤销标记纯属多余。**该行为已被测试锁住**
      （「清空存储后不重装安全 handler」，已确认在旧代码上失败）
- [x] 顺带修正类注释：原写「只负责拿对象」，现在还负责装安全配置；
      并写明本类**不管理 Session 生命周期**（Electron 不给销毁 API）
- [x] 一处过度断言的旧测试改掉：原断言 `fromPartition` 只被调一次（锁的是实现细节），
      改为断言「拿到同一个 jar」这个真正的契约

### ⏭ 未做（如实记录）
- [ ] 🔜 **intent 梳理**（用户明确另开一轮）：第 8 条路「重新登录·换账号」借用
      绑定意图，日志上与「新增绑定」无法区分，缺来源标记。见 `design.md` §3.3 问题 2

## 完成门禁

- [ ] 🔴 **真机验证（未做，归档阻塞项）**。全部改动只经单测，以下必须真机确认：
  - **连续绑定多个账号后，已认领的 partition 登录态不丢** —— 这是事故本体，
    最该验的一条（复现路径：像 2026-08-13 那样连续绑 4 个美团账号，每个登两次）
  - **抖音绑定能停在选公司页**（档 B 删键是否真的生效；日志看
    `Binding selection memory reset` 的 `removedCount`，为 0 说明键名变了）
  - **携程/美团绑定不受影响**（它们不注册前缀，应完全走原路径）
  - **重新登录·恢复同账号仍落到同一门店**（§3.3 问题 2：这条路绝不能清 PoiSwitch）
  - **启动清理不误清在用登录态**（本次最大风险；启动后查 `partitions.json`
    与各 partition 的 cookie 数）
- [ ] 存量 11 个孤儿的清理会在下次启动自动执行 —— 用户已确认「清理掉就好」
- [ ] 触及 partition 生命周期 → 按 CLAUDE.md 同步 `openspec/specs/` 对应 capability
- ⚠️ 5 个已损坏 credential（yungeerAI / wudeAI / sandouhotel / anmanAI / BaijiaAI）
  的登录态**找不回来**，需用户重新登录；本次改动只保证不再发生
