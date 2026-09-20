# 待解决问题

实施中发现、但不阻塞当前进度的问题。解决后在此标注，不另开文档。

---

## ISSUE-1 ⚠️ 读端点寄生在「改动适配器」里，命名与职责错位

**发现于**：2026-09-20，Change A 实施后 review（用户提出）
**状态**：待解决 —— 拟与 Change B 的 `InventoryScan` 接口一并梳理

### 现状

```
文件名   channels/ctrip/amount-change-adapter.ts   「改动」适配器
机制层   channels/amount-save-capture.ts           「保存」捕获
实际装的 isReadEndpoint / onReadResponse           读接口
```

两层名字都在说**写**，里面却长出了**读**的职责。

### 为什么会这样（当初的决定是对的，但只对了一半）

`webContents.debugger` 是**独占**的，而改价监听早已在携程 `/ebkovsroom/inventory`
（正是自然读发生的页面）attach —— 另起一个 capture 必然被静默拒绝。所以**机制层复用
是必须的**，这一点没错。

错的是：为了省事，把读端点的两个钩子直接挂在了 `AmountChangeAdapter` 接口上。
**复用机制层 ≠ 必须复用接口。**

### 拟议方向（未定）

机制层仍是一个 capture（独占决定的），但持有两个职责分明的适配器：

```
AmountSaveCapture（或一并改名）
  ├─ AmountChangeAdapter    写端点：isSuccessful / parse
  └─ InventoryReadAdapter?  读端点：isReadEndpoint / onReadResponse
```

⚠️ 接口名待定，`InventoryReadAdapter` 只是占位。

### ⛔ 不要改叫 `inventory-prob`

1. **`prob` 在本仓是「主动探测」**：`hotel-prob.ts` 会点菜单、等页面、有超时。
   而读端点是**被动旁听**，绝不碰页面 —— `channels/types.ts` 把这条界线写得很清楚
   （`HotelProbe` 主动 vs `AmountChangeAdapter` 被动）。套 `prob` 会抹掉它。
2. **真正主动的是 Change B**：`ctrip/inventory-scan.ts` 才符合那个语义。被动的先占了
   这个名字，主动的反而没名字可用。
3. **拼写**：英文是 `probe`，`hotel-prob.ts` 已经错过一次，不宜扩散。

### 为什么先不改

Change B 马上要加 `InventoryScan` 接口，它与这个「读适配器」的关系还没定形 —— 两者都是
「读渠道价量态」，只是一被动一主动，且已经共享了 `mapCtripReadRows`。现在改一轮，
Change B 落地后可能还要再改一轮。

**等取数层写完、两边形状都摆出来，一次性梳理命名与接口边界。**

⚠️ 风险是「等等再说」变成「永远不说」—— 所以记在这里，Change B 收尾前必须回来处理或
明确判定不处理。

### 命名共识（已定）

**定时扫描一律叫 `scan`，不叫 `prob`/`probe`。** Change B 全线已按此命名：
`InventoryScanDispatcher` / `inventory-scan.ts` / `endpointId: 'inventoryScan'` /
`sourceOfTruth: 'scan'`。

---

## ISSUE-2 三层开关的 `isHotelEnabled` 没有测试覆盖

**发现于**：2026-09-20 code review（P1-4 修复时）
**状态**：待补 —— 用户明确「目前不需要，后面再加」

### 现状

`byHotel` 的键已修成 `<channel>:<otaHotelId>`（原先是裸 `otaHotelId`，两个渠道的同号
门店会互相影响）。修复本身已生效，但**没有测试钉住它**。

原因是实现藏在装配层的闭包里：

```
composition/app-scope.ts
  config: () => {
    const scopeOf = (channel, otaHotelId) => ({ ... })   ← 闭包内，测试够不到
    return { isChannelEnabled, isHotelEnabled, ... }
  }
```

`inventory-scan-dispatcher.test.ts` 只能传一个假的 `isHotelEnabled` 进去，测的是
**调度器怎么用这个判据**，而不是**判据本身算得对不对**。

### 要测什么

| 用例 | 期望 |
|---|---|
| `byHotel['ctrip:123'].enabled = false` | 携程 123 不扫 |
| 同上，但问美团 123 | 美团 123 **照常扫**（不受影响）← 本次修的就是这条 |
| `byHotel` 未列出该店 | 取渠道层的值 |
| 渠道层关、酒店层开 | 酒店层优先（`hotel?.enabled ?? channelScope?.enabled ?? false`） |

### 怎么改才能测

把那个 `config()` 工厂从 `app-scope.ts` 的闭包里提成独立的纯函数，例如
`channels/scan-runtime-config.ts`：`(appConfig: AppConfig) => ScanRuntimeConfig`。
装配层只负责调它。属于小重构，不影响行为。

⚠️ 同时注意：`byHotel` 的键格式变更**没有迁移逻辑**。当前默认值是 `{}`、也还没有任何
下发链路，所以无存量数据。将来若先上了服务端下发再来改键格式，就需要迁移了。
