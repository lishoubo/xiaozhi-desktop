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

## P0 止血（⏸ 用户决定：**不抢跑，随 design 一起做**）

> 2026-08-14：用户确认当前受损账号都在测试环境，数据丢失可接受，因此**不单独止血**，
> 避免改出一个与 design 结论重复或冲突的临时守卫。bug 本身已在上面完整记录。

- [ ] `browser-manager.ts` 给 `clearRetiredPartitionWhenUnused` 加**第二道守卫**：
      该 partition 仍被某条 credential 引用则**绝不清理**
  - `BrowserManager` 在 window scope，不得直接依赖仓储 → 注入窄回调
    （照 `setPartitionRetirer` 的现有套路），如 `isPartitionClaimed(name): boolean`
  - 守卫失败时记 warn 并**从 `retiredPartitions` 移除**，避免它永远留在集合里被反复重扫
- [ ] 测试：退休一个仍被 credential 引用的 partition → 不调 `clearAccountSession`
- [ ] 测试：`close()` 不再无差别重扫全集合（或重扫时守卫生效）

## 需要在 design 里回答的问题

- [ ] **入口收敛**：4 个新建入口是否都必须新建？特别是入口 5
      （`openExistingInFreshPartition`，每次绑定必留一份新 partition）——
      它换新 partition 的真实目的是「丢掉 localStorage 里的选店记录」，
      有没有不新建 partition 的办法（如只清 localStorage）？
- [ ] **生命周期定义**：`创建 → 认领 → 替换 → 退休 → 清理` 每一步的触发条件、
      守卫、以及**谁负责**（现在退休触发挂在 `close()` 上，明显错位）
- [ ] **事实来源**：partition 全集现在散在三处（credential 表 / `pending-partitions.json` /
      磁盘目录），且 `listPendingPartitions` **全仓零调用方**（已 grep 确认，
      `pending-partitions.json` 只写不读）。要不要升级成单一事实来源？
- [ ] **清理触发点**：应用启动时？空闲时？还是跟着替换事件走？
- [ ] **`retiredPartitions` 跨重启丢失**：它是 window scope 的内存 Set，
      重启即清空 —— 标记了退休但没清成的 partition 会永远留在磁盘上
- [ ] **`SessionFactory.cache` 无淘汰**：`Map<string, Session>` 只增不减
      （仅 `clearAccountSession` 里 delete 一次），tab 关闭不释放
- [ ] **存量修复**：11 个孤儿目录怎么清；5 个已损坏 credential 怎么办
      （提示用户重新登录？还是直接删 credential 让用户重新走绑定？）
- [ ] ⚠️ **`clearAccountSession` 不删目录**：Electron 无此 API，只能
      `clearStorageData` + `clearCache`。所以「清理」的上限是清空内容，
      目录数只增不减 —— design 要正视这个天花板

## 完成门禁

- P0 止血必须**真机验证**：连续绑定多个账号后，确认已认领的 partition 登录态不丢
- 触及 partition 生命周期 → 按 CLAUDE.md 同步 `openspec/specs/` 对应 capability
- 存量数据修复涉及删除用户数据 → **执行前必须取得用户确认**
