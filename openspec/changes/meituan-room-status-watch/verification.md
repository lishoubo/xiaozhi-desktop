# 美团房态房量监听 —— 验证证据

> 记录时间：2026-08-13。自动化验证已完成；真机验证**开房已通过，关房/房量待复验**
> （关房端点在联调中才发现走独立路径，见下方「真机联调纠正」）。

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

### 真机验证进度

| 场景 | 状态 |
|---|---|
| 开房 `inventory-status-switch` | ✅ 通过（rmsChangeId 13/14/15/16，`status:1`，DISPATCHED） |
| 关房 `inventory-roomstatus-submitaudit` | ⬜ **端点已补，尚未真机复验** |
| 改房量 `inventory-update` | ⬜ 未验 |

## 未完成

| 任务 | 内容 | 阻塞原因 |
|---|---|---|
| 4.3 | **关房**与**改房量**各一次真机验证 | 关房端点刚补上，待复验 |
| 4.4 | 确认 `inventory/check` 没产生第二条上报（改房量时看） | 同上 |
| 4.4b | 确认关房时 `deductRoomCount` 没产生第二条上报 | 同上 —— 与 check 同一类风险 |
| 4.5 | 抓一次**被美团拒绝**的失败响应样本 | 需构造失败场景 |
| 5.1 | 与携程那份 delta 一并合并进 `openspec/specs/` | 携程已真机通过，等美团验完一并做 |

⚠️ **4.3 未完成前不得声称本变更「已验证可用」** —— 单测覆盖的是解析与判定逻辑，
拦不拦得到只有真机能证。

### 真机时重点看什么

```
1. 停在 /ebooking/merchant/product，日志应有 `Amount change watching started`
2. 开房一次     → endpointId=inventory-status-switch，changeRaw.status=1   ✅ 已验
3. 关房一次     → endpointId=inventory-roomstatus-submitaudit
                  changeRaw.status=0、date（单值）、goodsIds 有值
                  ⚠️ **只应有一条上报** —— 若出现两条（一条来自 deductRoomCount），
                     说明连带扣量被误拦
4. 改房量一次   → endpointId=inventory-update，changeType=roomStatus
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
