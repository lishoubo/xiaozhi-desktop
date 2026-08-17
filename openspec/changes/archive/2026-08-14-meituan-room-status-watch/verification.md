# 美团房态房量监听 —— 验证证据

> 记录时间：2026-08-13。自动化验证 + **房态真机验证均已通过**。
> 房量（`inventory-update`）经用户决定本期不验，见「未完成」。

## 自动化验证

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run check:types` | ✅ 通过，无输出 |
| Lint（含分层约束） | `npm run lint` | ✅ 通过，无输出 |
| 单测（全量） | `npm run test:unit` | ✅ **79 个文件 / 523 tests passed**（含关房修正后的 +4） |

美团适配器测试：**41 tests**（本次新增 18 条 —— 14 条初版 + 4 条关房端点修正）。

全量数从上一个 change 的 505 → 523，增量 18 全部来自本次新增用例，无既有用例被改动或删除。

## 改动面

本次是**纯适配器改动**，契约与机制层一行未改：

```
meituan/amount-change-adapter.ts        端点 +3、parse 分流、房型取值、注释
meituan/room-close-payload.ts           🆕 关房的 changeRaw 规格
meituan-amount-change-adapter.test.ts   +18 用例
─────────────────────────────────────────────────────────────
shared/types/amount-change.ts           未改（changeType 上个 change 已就位）
channels/types.ts                       未改（isSuccessful 形参已就位）
channels/amount-save-capture.ts         未改
channels/amount-change-watcher.ts       未改
WATCH_PATH                              未改（前缀已覆盖，见下）
开房/房量的 payload 模型             未新建（原样透传，无需转换；关房因形状不同单独立了一份）
```

### 页面路径无需改动（已核对）

房态房量的 referer 实测是 `https://me.meituan.com/ebooking/merchant/product`，现有
`WATCH_PATH` 正是该前缀。`#/index` 是 hash 路由，不参与 `pathname` 匹配 —— 改价（批量/
非批量）与房态房量三种场景的页面级 URL 实为同一个。

三渠道对照：**只有抖音房态需要放开页面路径**（在 `/hotel/status`），携程与美团都不用。

## 三条关键回归护栏

1. **`inventory/check` 不在 `watchedEndpoints` 里** —— 它与 `update` 请求体逐字节相同，
   拦了会让一次改动上报两遍，而两条的 `operationId` 不同、RMS 幂等挡不住。
2. **房量语义字段全部原样保留**（`countType`/`invSwitch`/`limitChangeValue`/`count`）——
   用 `toEqual` 全等断言钉住，防止日后有人「顺手清理」看不懂的字段。
3. **五个端点片段互不为子串 + 各自只命中自己的 URL** —— `matchEndpoint` 是首个命中即返回，
   串了会把房量当改价解析。
4. **关房端点独立于开房端点** —— 钉住本次联调发现的那个坑，防止日后被合并回一个端点。
5. **`deductRoomCount` 不在 `watchedEndpoints` 里** —— 关房后的连带扣量，拦了会重复上报。

## ⚠️ 真机联调纠正：开房与关房不是同一个端点（2026-08-13）

**这是本 change 最重要的一处修正**，原始踩点 `单房态房量01.md` 里看不出来。

```
开房  /goods/inventory/status/switch           {status:1, startDate, endDate, syncChecked}
关房  /goods/inventory/roomstatus/submitaudit  {status:0, date, goodsIds[], reason, roomName}
```

初版只认了 `status/switch`，导致**关房一次都拦不到**。修正见 commit `1c5c888`，
规格见 `channels/meituan/room-close-payload.ts`。

### 失效方式为什么难查

用户连点四次「关房」，日志里出现的却全是 `status: 1` 的上报（rmsChangeId 13/14/15/16）
—— 那是**之前开房**留下的报文。表面看「有上报、链路正常」，实际关房全部丢失。

排查中一度误判为「页面没发请求」：`AmountSaveCapture.matchEndpoint` 未命中的请求**静默
跳过、不留任何日志**，所以「页面没发」与「我们漏拦」在日志上完全一样，都是一片空白。
最终靠给 OTA 标签页临时开 DevTools 抓到真实 URL 才定位（诊断代码验证后已撤除）。

**教训**：踩点文档里两个操作看着走同一端点时，不能假定就是同一端点 —— `submitaudit`
这种带审核语义的操作，渠道往往会单独开一条链路。

### 真机验证进度 ✅（2026-08-13，账号 278040373 / yinjijiudian，门店 1756785213）

| 场景 | endpointId | rmsChangeId | 结果 |
|---|---|---|---|
| 开房 | `inventory-status-switch` | 13-16, 22 | ✅ `status:1`，DISPATCHED |
| **关房** | `inventory-roomstatus-submitaudit` | **21** | ✅ `status:0`，DISPATCHED |
| 改房量 | `inventory-update` | — | ⬜ 本期不验（用户决定） |

关房实际上报的 `changeRaw`，与踩点逐字段对上：

```json
{"partnerId":4720332,"poiId":"1756785213","pattern":1,"containerId":282464264,
 "date":"2026-08-17","status":0,"roomId":413866969,
 "goodsIds":[952161333,2429288289,2429295192],
 "limitType":1,"roomName":"悦享大床房","roomCategory":1,"reason":""}
```

### 逐条兑现的设计决策

- **关房走独立端点**（本次修正）—— `endpointId` 正确落在 `inventory-roomstatus-submitaudit`，
  与开房的 `status/switch` 分得干净。修正前这条路一次都拦不到。
- **`deductRoomCount` 没有被误拦** —— 关房只产生**一条**上报（21）。这是设计时标为风险的
  一条：拦了会让一次关房出两条、两个 `operationId`，RMS 会以为改了两次。
- **`goodsIds` 完整带出** —— 三个售卖商品都在，RMS 可直接用它反查（比 `roomId` 直接）。
- **单值 `date` 与开房的 `startDate`/`endDate` 形状差异**在报文里如实体现，未被强行归一。
- **`changeRaw` 原样透传** —— `containerId`/`pattern`/`limitType`/`roomCategory` 这些语义
  未确认的字段全部保留。

### 一个观察：discovery 失败不影响已有凭证

本次启动时出现 `Meituan discovery outcome { kind: 'none' }`（页面尚未就绪），但上报体里
`channelAccountId` / `channelAccountName` 照常带上 —— 凭证取自此前已保存的记录，
discovery 失败不影响存量。

## 未完成

| 任务 | 内容 | 阻塞原因 |
|---|---|---|
| 4.3b | **改房量** `inventory-update` 真机验证 | **本期不验**（用户决定）。代码与单测已就位，未经真机 |
| 4.4 | 确认 `inventory/check` 没产生第二条上报 | 依赖 4.3b，一并搁置 |
| 4.5 | 抓一次**被美团拒绝**的失败响应样本 | 需构造失败场景，本次未遇到 |

⚠️ **房量这条路未经真机**：单测覆盖了解析逻辑，但「`check` 会不会被误拦」只有真机能证。
真要启用房量监听前，应先补这一验。

### 真机时重点看什么

```
1. 停在 /ebooking/merchant/product，日志应有 `Amount change watching started`
2. 开房一次     → endpointId=inventory-status-switch，changeRaw.status=1   ✅ 已验
3. 关房一次     → endpointId=inventory-roomstatus-submitaudit
                  changeRaw.status=0、date（单值）、goodsIds 有值           ✅ 已验
                  只有一条上报，deductRoomCount 未被误拦                    ✅ 已验
4. 改房量一次   → endpointId=inventory-update，changeType=roomStatus        ⬜ 本期不验
                  ⚠️ **只应有一条上报** —— 若出现两条（一条来自 check），
                     说明 check 被误拦，属严重问题
5. changeRaw 里 countType/invSwitch/limitChangeValue/count 应完整保留
6. 顺带改一次价 → changeType=price，证明两条路互不干扰
```

若第 3/4 步出现两条上报，先查 `watchedEndpoints` 是否被改动过 —— 单测已钉住 `check` 与
`deductRoomCount` 都不在列表里。

⚠️ **若某个操作「什么日志都没有」，不要先怀疑解析** —— `matchEndpoint` 未命中的请求静默
跳过、不留痕迹，这与「页面没发请求」在日志上无法区分。本次关房的坑正是如此。判定方法：
给 OTA 标签页临时开 DevTools（`browser-manager.ts` 里加一行 `openDevTools`）看真实 URL。
