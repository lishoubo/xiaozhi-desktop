# 状态：美团价量态定时扫描

**2026-09-21｜代码 + 真机验证完成，未提交。⭐ 8.4 已通过。待 code review。**

```
云朵 1834077877   18 商品 → 270 价格格   6 房型 → 90 房态格
三豆  942804505    8 商品 → 120 价格格   7 房型 → 105 房态格
⭐ 浏览器改房量 → 下一轮 changed:1，360 格里精确命中
```

## 已完成

| 组 | 内容 |
|---|---|
| 1 | ✅ 连通性验证（探针跑完已删）—— 结论见 design 决策 9.1 / 9.2 |
| 2 | 公共形状：`ScanTarget.channelExtra`、`InventoryScan` 第三参、`ScanFetcher` 泛化、`listByCredential` |
| 3 | 四步取数 + `session-expiry.ts` + `room-status-endpoint.ts` 抽取 |
| 4 | `inventory-snapshot/meituan-cells.ts` —— 两类格子各自的 ID 空间 |
| 5 | 自然读基线接线（`isReadEndpoint` / `onReadResponse`） |
| 6 | 装配、payload、registry、defaults、`scan-targets.ts` 提取 |
| 7 | `服务端需求.md` + 端点对照表 + ⭐ 同步携程文档 |

**新增文件**：
`channels/meituan/` 下 `inventory-scan.ts` / `inventory-scan-payload.ts` /
`room-status-endpoint.ts` / `price-inventory-endpoint.ts` / `session-expiry.ts`；
`inventory-snapshot/meituan-cells.ts`；`composition/scan-targets.ts`

**测试**：净增 74 项。全量 `1002 passed`，与基线同为 `11 failed files / 1 failed test`
（`__APP_ENV__` 等构建期常量未注入，stash 验证过改动前后相同）。

---

## ✅ 已解除：门店清单改随登录写入（第 6b 组）

原阻塞是「美团凭证没有绑定门店 → 扫描没有目标」。用户方案：**discovery 时把
`poiInfos` 记进 `credentialExtra.pois`，扫描仍遍历凭证**，不动登录编排、不动
`ota_hotel`、不动携程。

⚠️ 这与其余三条链路对齐了 —— 改价上报、回读、自然读的 `otaHotelId` **都从报文里取**，
只有扫描由定时器触发、没有报文可取。

⏸️ **已登录的美团账号要重新登录一次**才会写入 `pois`（不做回填）。

### 原阻塞记录

真机跑起来后**一条美团扫描日志都没有**。查库：

```
ota_credential   meituan × 2   ✅ 都在
ota_hotel        meituan × 0   ❌ 一条都没有（只有 3 条抖音）
```

按 design 决策 4，美团只扫已绑定门店（门店级 `otaPartnerId` 只有绑定流程会写）。
所以这是**设计行为**，不是 bug —— 但日志上与「调度器挂了」长得一样，已补一条 info。

### 曾考虑「三渠道统一扫 ota_hotel」，已否决

一度打算另开 change 让三个渠道统一走 `ota_hotel`。否决理由：要动登录编排 + 三个渠道
+ **携程扫描的取数来源**（已实装并过 review），范围远大于问题本身。

⚠️ 抖音的真实约束也在讨论中澄清了：它不是「多店所以要用户选」，而是**登录后根本
拿不到门店 ID**，必须走额外 UI 动作 —— 没有可静默探测的数据源。所以分界线是
**数据可得性**，不是渠道特殊化。

---

## ⚠️ 本次顺带修掉的两个既有缺陷

### 1. 扫描 fetcher 把 HTTP 401 翻译成业务码 `{code:401}`

照携程定制的（它的 `EXPIRED_CODES` 里恰好有 401）。美团接进来后，这个翻译会让美团
一个正常的业务错误被误报成登录失效。**是回读的既有测试挡下来的**（它断言业务码 401
应落 `PARSE_ERROR`）。已改成中立回传 `__httpStatus`，携程判据自己做归一。

### 2. ⭐ 上报的 cells 丢了 `itemType`（用户发现）

`scan-to-report.ts` 只取 `cell.itemData`，把基线库里本就有的 `itemType` 维度丢掉了，
逼服务端靠字段特征猜（「有 salePrice 就是价格」）。

携程两类格子共用同一个 `roomTypeID`，猜错代价有限；**美团是两个 ID 空间**，猜错会拿
`goodsId` 去查物理房型。已在 `scan-to-report.ts` 统一加上，**两个渠道一致**。

⚠️ 这让携程的上报体也变了。`add-ota-inventory-scan/服务端需求.md` 第 4.2 节原先写
「desktop 不会加类型标记字段」，该论断已被推翻，**已改写并标注变更缘由**。

---

## 📌 真机观察到的事实

### 携程扫描已在跑，服务端 Translator 未就绪

```
Inventory scan compared { channel:'ctrip', otaHotelId:'122244992', changed: 33 }
Amount change reported to RMS { changeType:'inventoryDiff', endpointId:'inventoryScan',
                                rmsChangeId: 179, rmsStatus: 'PARSE_FAILED', rmsItems: 0 }
```

⚠️ `rmsItems: 0` **不是** desktop 发了 0 个格子 —— 那三个 `rms*` 字段全部原样来自服务端
响应。desktop 实际发了 33 个（`changed === 0` 时根本不调 report）。

这正是文档预告的形状：HTTP 200 + `code=0` 的正常响应，desktop 完全无感，只有日志里的
`rmsStatus` 能看出来。**也验证了「直接发不摘 report 回调」这个决定是对的** —— 摘掉的话
这轮暴露不出服务端未就绪。

### 携程 `changed: 33` / `changed: 3` 待确认

按设计绝大多数轮次应零上报。可能是房量随订单正常变化，也可能是 `contentHash` 口径误报。
**未排查**。

---

## ✅ 真机验证已通过（2026-09-21 16:23–16:29）

| | goodsCount | priceRows | roomCount | statusRows |
|---|---|---|---|---|
| 云朵 1834077877 | 18 | 270 = 18×15 | 6 | 90 = 6×15 |
| 三豆 942804505 | 8 | 120 = 8×15 | 7 | 105 = 7×15 |

**⭐ 8.4（唯一能证明链路有效的验证）**：浏览器改云享三人间今天的房量 →
下一轮 `changed: 1`，**360 格里精确命中那一格**，上报 HTTP 200。

```json
{ "roomName":"云享三人间", "date":"2026-09-21", "roomId":493882496,
  "limitRemain":6, "roomStatus":1, "invSwitch":1, "itemType":"roomStatus" }
```

同时实证：`contentHash` 字段集选对了（`containerId`/`shareType`/`roomName` 天天回显
却不引发差异）、`itemType` 端到端生效、`otaHotelId` 填满了（不是空串）。

### ⛔ 踩到并修掉：价格请求 `roomIds` 不能给空

```
priceRows: 'failed' (PARSE_ERROR)   ← roomIds: []
priceRows: 270                      ← 传真实 roomIds
```

原注释写「接口要求同时给，但价格按 goodsId 回，给空即可」—— **是没根据的假设**，
RPA 踩点样本两者都传真实值。

⚠️ **这个 bug 是被设计救下来的**：因为有「③④单边失败仍写入另一边」那条规则，
房态房量 90 格照常入库，只丢了价格。已补测试钉住。

---

## 📋 code review 处理结果（2026-09-21，high 档，7 条）

### 已修 4 条

**① `pois` 被空数组覆盖（medium）** —— `credentialExtra` 更新是**整体替换**，而美团门店
探测失败返回空数组。两者相乘：一次网络抖动就让已有清单被抹掉，扫描静默停摆到下次
**成功**登录。原注释「下次登录会重新写」假设的是「缺失」，而代码是**主动销毁**。
→ 加 `ota-credential-service.ts` 的 `keepDiscoveredPois` + 3 项测试。

**② ⭐ `roomCategory` 缺失就筛掉 —— 代码与自己的 design 矛盾（medium）**

```
design 决策 3.1   ②组参：roomCategory === 2 排除，缺失保留
实际代码          !== 1 就筛（缺失也筛）
```

后果：美团改字段名时**整轮落 `skipped: no-scannable-room-types`**，与「这账号真的没有
日历房」在日志上分不开 —— 静默的全量覆盖丢失。
→ 改成 `=== ROOM_CATEGORY_HOURLY`；⚠️ 当初那条单测断言的正是错误行为，一并改掉，
并补一条回归（整批缺字段时不能退化成扫不到任何房型）。

**⑤ 每店重复调 `poiInfos`（low）** —— 那一步原本用于「校验门店属于本账号」，但第 6b 组
把门店清单改成随登录记录后，这层校验的前提就没了（换账号时 `pois` 跟着更新）。
它是改动过程中的**遗物**，且会让 N 家门店每轮重复发 N 次同样的账号级请求。
→ 已删，**四步变三步**。

**⑥ 死代码（low）** —— `listByCredential` / `meituanPartnerIdOf` 零调用方，注释还在宣称
已废弃的设计。→ 已删，同步修 `page-read-to-cells.ts` 的过时注释与 design 决策 4
（加修订说明，不抹历史）。

### ⏸️ 未改 2 条（记为待办）

**③ 双边失败塌缩成 `NETWORK_ERROR`** —— `fetchPriceRows`/`fetchStatusRows` 丢掉
`parsed.reason` 只返回 `null`，调用方一律报 `NETWORK_ERROR`。403（重登无用）与
cookie 问题在 GlitchTip 里长得一样，与携程的失败分类不一致。
⚠️ **影响仅诊断层面**：reason 不被任何重登路径消费，且过期 cookie 通常在①就失败。

**④ 价格侧空数组掩盖房态失败** —— `fetchPriceRows` 在 `goodsIds` 为空时返回 `[]` 而非
`null`。「有房型但全部商品不可售 + 房态取数失败」时，双边失败的护栏不触发，
整轮记成功且 GlitchTip 无感。要分开「没尝试」与「返回空」才能堵住。

### ✅ 确认 1 条

**⑦ dev 默认开启并上报** —— 用户明确决定「直接发就好了」，design 决策 12 已同步修订。
真机验证了这个决定是对的：正因为发了才暴露出服务端 Translator 未就绪。

---

## ⚠️ 未完成

- **第 9 组 收尾** —— 反向验证 + code review
- **8.4 只验了房量，改价那一半未验**
- 携程 `changed` 非零的原因未排查
- ⏸️ 服务端 `(meituan, inventoryScan)` Translator 未就绪 —— 上报回 `PARSE_FAILED`
  （与携程同状态，`服务端需求.md` 已写好）

### 📌 用户提出但暂不做：上报「变了什么」而非「现在是什么」

用户注意到改房量时报文里 `roomStatus`/`invSwitch` 也一并报了（它们没变）。

现状是**报整行**，服务端看不出哪个字段变了。desktop 这边其实知道（`snapshot-diff`
手里有新旧两个 hash）。若要做，可在 cell 里带 `changedFields: { limitRemain: {from,to} }`。

⚠️ 取决于服务端拿这条上报做什么：跟价只需「现在是什么」；审计/告警才需要「变了什么」。
**用户决定先不做。**

### 📌 `roomStatus` 与 `invSwitch` 的语义未踩实

读响应侧这两个字段我们**没有自己踩点**。RPA 文档（`RPA-房价信息.md` §12.2）的说法：

```
roomStatus  1 有房 / 0 无房（关房与售罄都是 0）
invSwitch   房态开关本身（写请求侧实证：关房样本 invSwitch:0）
```

推论：两者组合才能区分「关房」与「售罄」。⚠️ 但 RPA 侧明说 `invSwitch`「本期不读」，
所以他们也没验。两个字段都参与了 `contentHash`，不影响正确性（变了就报），
只是语义解读留给服务端。
