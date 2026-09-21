## 1. ✅ 连通性验证（已完成 2026-09-21）

**已验证通过，不需要降级。** 结论见 design 决策 9.1 / 9.2。探针跑完已删。

- [x] 1.1 一次性探针（`composition/meituan-scan-probe.ts`，跑完已删，未进仓库）
- [x] 1.2 `poiInfos` 经 `session.fetch` 打通 —— `code 10000`，1 家门店，带 partnerId
- [x] 1.3 `queryListAndTag` 打通 —— `code 10000`，6 realRooms / 9 logicRooms / 24 goods
- [x] 1.4 ⚠️ **标签页开/关对照** —— ✅ 房型结构逐项相同。第二轮还换了 partition
      （期间重新登录，全新 cookie jar），仍一致
- [x] 1.5 探针窗口内基线库**零写入** —— 不被自己的 CDP 拦到，决策 1 第三条理由成立
- [x] 1.6 补头 —— ✅ **只需五个头**，无签名头、无 `mtgsig`
- [x] 1.7 ⭐ `roomCategory` 实证 —— 9 个逻辑房型里 **3 个钟点房**（占三分之一），
      `categoryMissing 0`。源头过滤不是可选项，见 design 决策 9.2
- [x] 1.8 顺带拿到失效样本 —— 失效凭证返回 `200 + JSON + code 606`，**不是 HTML 登录页**，
      回答了决策 10 的一半；⚠️ 单个样本**不硬编码成失效码**，既有 `!== 10000` 判据够用

## 2. 公共形状调整（携程行为不得变化）

- [x] 2.1 `channels/inventory-scan-dispatcher.ts`：`ScanTarget` 加 `channelExtra: JsonObject`
- [x] 2.2 `channels/types.ts`：`InventoryScan.scan()` 加第三参 `channelExtra`
- [x] 2.3 `channels/ctrip/inventory-scan.ts` 跟随签名（忽略第三参），改既有测试
- [x] 2.4 `channels/registry.ts`：`scanFetcher` 参数类型从 `CtripScanFetcher` 泛化为渠道无关类型
- [x] 2.5 `database/ota-hotel-repository.ts`：新增 `listByCredential(credentialId)` + 单测
- [x] 2.6 跑携程扫描既有测试，确认全绿（这步是纯形状调整，行为零变化）

## 3. 美团取数实现

- [x] 3.1 `channels/meituan/session-expiry.ts`：从 `inventory-readback.ts` 抽出失效判据，美团内部共用（回读改为 import，行为不变）
- [x] 3.1a `channels/meituan/room-status-endpoint.ts`：抽出④的端点知识（URL / 请求体形状 / 响应展平）。展平层内建 `roomCategory !== 1` 丢弃（**缺失也丢**，防同一 roomId 返回两行）；⚠️ 目标房型/日期的收窄是回读的语义边界，**留在** `inventory-readback.ts`（design 决策 3.1）
- [x] 3.1b 跑回读既有 22 项单测，确认抽取后行为零变化
- [x] 3.2 `channels/meituan/inventory-scan.ts`：①`poiInfos` 取门店上下文并校验绑定门店属于本账号（design 决策 4）
- [x] 3.3 同上：②`queryListAndTag` 取房型清单，产出 `goodsIds[]` 与去重后的 `roomIds[]`。两道过滤在同一次遍历里：①`roomBaseInfo.roomCategory === 2` 排除钟点房（缺失保留）②`auditStatus==4` + `goodsStatus==2` + `switchStatus==0` 排除不可售商品
- [x] 3.4 同上：③`queryPriceInventoryStatusInfo` 取价格，只读 `goodsPriceMap`（**不读 `goodsStatusMap`**，design 决策 3）
- [x] 3.5 同上：④调 `room-status-endpoint.ts` 取房态房量，直接用展平结果（不收窄）
- [x] 3.6 同上：两类行打 `MEITUAN_SCAN_KIND_MARKER`，合成一个 rows 数组返回
- [x] 3.7 同上：③④单边失败时仍写入另一边的格子（design 决策 2），房型清单为空落 `skipped` 而非 `failed`
- [x] 3.8 单测：四步请求的入参形状、过滤规则、marker 打法、单边失败路径

## 4. 行→格子映射

- [x] 4.1 `inventory-snapshot/meituan-cells.ts`：`price` 行 → `otaSaleRoomId = goodsId`
- [x] 4.2 同上：`roomStatus` 行 → `otaPhysicalRoomId = roomId`
- [x] 4.3 同上：两类 contentHash 字段集按 design 决策 7，金额原样不转单位
- [x] 4.4 跨模块断言测试：`MEITUAN_SCAN_KIND_MARKER` 与映射侧常量逐字符相同（照携程先例）
- [x] 4.5 单测：用真实 fixture（③的踩点样本 + ④的既有 fixture），验两类格子的 key 与 hash
- [x] 4.6 单测（⚠️ 回归）：同一 `roomId` 同时含 `roomCategory` 1 与 2 的响应 → 展平后只剩日租那行；`roomCategory` 缺失的行被丢弃（判据在 `room-status-endpoint.ts`，映射层不再过滤）

## 5. 自然读基线接线

- [x] 5.1 `channels/meituan/amount-change-adapter.ts`：加 `isReadEndpoint`（认③④两个端点）
- [x] 5.2 同上：加 `onReadResponse`，解析出行并打 marker，对③只产 price 行（design 决策 8）
- [x] 5.3 `composition/window-scope.ts`：`snapshotMappers` 加 `['meituan', mapMeituanReadRows]`
- [x] 5.4 单测：拦到③④的响应各自产出正确的行；确认与扫描侧共用同一 mapper

## 6. 装配与上报

- [x] 6.1 `composition/app-scope.ts`：`listTargets` 按渠道分流 —— 携程走 masterHotelId，美团遍历凭证下已绑定门店并填 `channelExtra.otaPartnerId`
- [x] 6.2 同上：`mappers` 与 `reportBuilders` 各加美团一项
- [x] 6.3 `channels/meituan/inventory-scan-payload.ts`：端点标识与上报体构造，`changeType` 沿用 `inventoryDiff`
- [x] 6.4 `channels/registry.ts`：美团 adapter 注册 `inventoryScan`
- [x] 6.5 `app-config/defaults.ts`：`channels` 加 `meituan: { enabled: true }`（总闸仍默认关）
- [x] 6.6 单测：枚举口径按渠道分流、缺 `otaPartnerId` 的门店被跳过（9 项）。
      ⚠️ 顺带把 `scanTargetsOf` 从 app-scope 闭包提成独立模块 `composition/scan-targets.ts`
      —— 原本够不到、只能靠真机验证，而它每条分支的失效都是静默的（少扫一家店、
      或把格子写到别家店头上）。这解决了 `add-ota-inventory-scan` ISSUE-2 的同类问题。
      ⚠️ registry 注册未加测试：`channel-registry.test.ts` 因 `__APP_ENV__` 未注入
      本就跑不起来（基线失败文件之一），加了也验证不了

## 7. 文档与服务端对接

- [x] 7.1 `服务端需求.md` —— 分派键、两个 ID 空间怎么分、四条反直觉约定、四类上报对照
- [x] 7.2 ⚠️ **不做**：`change_type` 列宽由服务端处理（用户确认）
- [x] 7.3 更新 `add-meituan-inventory-readback/端点与回读对照.md`，补第六类上报
- [x] 7.4 ⚠️ **改为直接发**（用户确认）：不摘 report 回调。摘掉的收益不大 ——
      desktop 侧日志两种做法都一样看不出服务端消费得对不对，要验证得去服务端查台账，
      而那与 desktop 发不发无关
- [x] 7.5 ⭐ 同步携程文档：`add-ota-inventory-scan/服务端需求.md` 第 4.2 节原先写
      「desktop 不会加类型标记字段，看字段特征判断」，**该论断已被本次改动推翻**，
      已改写并标注变更缘由；`ctrip/inventory-scan-payload.ts` 文件头同步

## 6b. ⭐ 门店清单随登录写入（用户提出，2026-09-21 追加）

**起因**：真机跑起来后一条美团扫描日志都没有 —— 凭证有两个，`ota_hotel` 里一条美团
记录都没有。按原设计美团只扫已绑定门店，于是「登录了却什么都不扫，还得手动绑店」。

**用户方案**：discovery 时顺手把 `poiInfos` 记进 `credentialExtra`，扫描仍然遍历凭证。
不动登录编排、不动 `ota_hotel`、不动携程。

⚠️ 这也与其余三条链路对齐了 —— 改价上报、回读、自然读的 `otaHotelId` **都从报文里取**
（用户操作本身带着「他在哪家店」）。只有扫描由定时器触发、没有报文，所以才要在登录时记下来。

- [x] 6b.1 `poi-infos.ts`：加 `MeituanPoiEntry` / `MEITUAN_POIS_FIELD` / `toPoiEntries`。
      ⚠️ 门店级字段叫 `otaPartnerId` 而非 `partnerId` —— 与 `bindExtra` 的叫法对齐，
      且避免与 `credentialExtra` 外层那个**账号级** `partnerId` 在同一个对象里看混
- [x] 6b.2 `discovery.ts`：读完账号身份后再读一次门店清单，写进 `credentialExtra.pois`。
      ⚠️ 失败不阻断登录（账号身份才是这一步的交付物）；取不到写**空数组**而非省略该键
      —— 空数组说明「探测过，没有门店」，省略说明「没探测过」
- [x] 6b.3 更新 `discovery.ts` 文件头：说明这次读门店是**给扫描用的**，与
      `hotel-prob.ts` 那条「探测 → 候选 → 用户确认 → `ota_hotel`」的路并存不替代，
      `split-ota-hotel-prob-feature` 决策 3 的边界仍然成立
- [x] 6b.4 `scan-targets.ts`：美团改为从 `credentialExtra.pois` 展开，不再查 `ota_hotel`
- [x] 6b.5 单测：清单展开、缺字段跳过、账号级/门店级 partnerId 不混、空清单记 info（10 项）
- [x] 6b.6 discovery 单测：两次 `executeJavaScript`、门店取不到仍返回身份、多店记多条（4 项）
- [ ] 6b.7 ⏸️ **已登录的美团账号需要重新登录一次**才会写入 `pois`（不做回填）

## 8. 真机验证

⚠️ 绝大多数轮次本就应该零上报，「跑起来没报错」说明不了任何问题 —— 8.4 是唯一能证明
链路有效的验证。

### ✅ 2026-09-21 已通过

两家店（云朵 1834077877 / 三豆 942804505），**数字全部对得上**：

| | goodsCount | priceRows | roomCount | statusRows | cells |
|---|---|---|---|---|---|
| 云朵 | 18 | **270** = 18×15 | 6 | **90** = 6×15 | 360 |
| 三豆 | 8 | **120** = 8×15 | 7 | **105** = 7×15 | 225 |

- [x] 8.1 开总闸（改为 dev 默认开），美团凭证进入扫描目标
- [x] 8.2 单门店一轮扫完，基线库出现两类格子
- [x] 8.3 ⭐ **一个账号多门店逐个扫**（16:23:16 / 16:23:17 串行），`otaHotelId` 正确分属
- [x] 8.4 ⭐ **已通过（16:29:02）**：在浏览器改云享三人间今天的房量 → 下一轮
      `changed: 1`，**360 格里精确命中那一格**，上报 HTTP 200
      ```json
      { "roomName":"云享三人间", "date":"2026-09-21", "roomId":493882496,
        "limitRemain":6, "roomStatus":1, "invSwitch":1, "itemType":"roomStatus" }
      ```
      ⚠️ 只验了房量，**改价那一半未验**
- [x] 8.5 自然读打底已在工作 —— 云朵首轮 `baseline: 186` 就是自然读写的
- [x] 8.6 间接验证：8.4 那轮 `addedBaseline: 0` —— 若回读与扫描写的格子键不同，
      扫描会把回读写过的格子当成「首次见到」，`addedBaseline` 不可能是 0
- [x] 8.7 无 `pois` 的凭证被跳过并记 info（三豆重新注入 cookie 前就是这个状态）
- [x] 8.8 耗时 733 / 748 ms，房型条数 6+18 / 7+8，单页足够，**②不需要分页**

### ⛔ 踩到并修掉的坑：价格请求 `roomIds` 不能给空

```
priceRows: 'failed'  reason: PARSE_ERROR    ← 给 roomIds: [] 时
priceRows: 270                              ← 传真实 roomIds 后
```

当初写成空数组时的注释是「接口要求同时给，但价格按 goodsId 回，给空即可」——
**那是没根据的假设**，RPA 踩点样本（`RPA-房价信息.md` §4.1）两者都传真实值。
已修并补测试钉住（房态房量那条路当时正常，所以只丢了价格，是「单边失败仍报另一边」
那条设计救下来的）。

### 📌 其余真机观察

- `hourlySkipped: 3` 两家都有，且**④的响应侧又各挡了 3 行** —— 实证了「②已在源头筛过，
  ④仍会夹带同 roomId 的钟点房那一行」，响应侧判据不能省
- `changed: 0` —— 首轮只建基线不上报，符合设计
- 三豆 `baseline: 0`（新凭证），云朵 `baseline: 186`（自然读 + 上一轮扫描）

## 9. 收尾

- [x] 9.1 类型检查 + 受影响模块测试全绿（`tsc` 零错误；1004 passed，与基线同为
      11 failed files / 1 failed test —— `__APP_ENV__` 等构建期常量未注入）
- [x] 9.2 反向验证：**12 条关键判据各改坏一次，全部变红且红的用例数各不相同**（非恒红）

      | 改坏什么 | 变红 |
      |---|---|
      | ①源头不筛钟点房 / 不筛不可售商品 | 3 / 1 |
      | ②价格请求 `roomIds` 给空（真机踩的坑） | 1 |
      | ③展平层不筛钟点房 | 扫描 1 / 回读 2 |
      | cells 房态误填 `sale` / 两类共用一组 hash | 2 / 2 |
      | scan-targets 误用账号级 `partnerId` | 4 |
      | scan-to-report 不带 `itemType` | 1 |
      | session-expiry 业务码 401 当失效 | 1 |
      | discovery 门店探测失败就整体失败 | 1 |
      | adapter 读端点当写端点 / 无 poiId 仍产出行 | 1 / 1 |

      ⚠️ 过程中脚本有 bug（多文件参数被当成一个路径，vitest 没跑任何用例却报
      「0 failed」），差点误判成覆盖缺口。已修正重跑。
- [x] 9.3 code-review（独立 pass，high 档）—— 7 条发现，修 4 条、待办 2 条、确认 1 条。
      详见 `STATUS.md`。⭐ 其中一条是**代码与自己的 design 决策 3.1 矛盾**
- [ ] 9.4 ⏸️ 完成门禁：本次触及跨模块接口（`InventoryScan` 签名、`ScanTarget`、
      `onReadResponse` 加参），**需同步 `openspec/specs/`** —— 但扫描的主 spec 尚在
      `add-ota-inventory-scan`（未归档），待那个 change 归档后一并处理
