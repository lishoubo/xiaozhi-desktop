# 美团房态房量监听 —— 验证证据

> 记录时间：2026-08-13。自动化验证已完成；**真机验证尚未进行**（见「未完成」）。

## 自动化验证

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run check:types` | ✅ 通过，无输出 |
| Lint（含分层约束） | `npm run lint` | ✅ 通过，无输出 |
| 单测（全量） | `npm run test:unit` | ✅ **79 个文件 / 519 tests passed** |

美团适配器测试：**37 tests**（本次新增 14 条）。

全量数从上一个 change 的 505 → 519，增量 14 全部来自本次新增用例，无既有用例被改动或删除。

## 改动面

本次是**纯适配器改动**，契约与机制层一行未改：

```
meituan/amount-change-adapter.ts        端点 +2、parse 分流、房型取值、注释   🆕 唯一改动的源文件
meituan-amount-change-adapter.test.ts   +14 用例
─────────────────────────────────────────────────────────────
shared/types/amount-change.ts           未改（changeType 上个 change 已就位）
channels/types.ts                       未改（isSuccessful 形参已就位）
channels/amount-save-capture.ts         未改
channels/amount-change-watcher.ts       未改
WATCH_PATH                              未改（前缀已覆盖，见下）
payload 模型文件                        未新建（原样透传，无需转换）
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
3. **四个端点片段互不为子串 + 各自只命中自己的 URL** —— `matchEndpoint` 是首个命中即返回，
   串了会把房量当改价解析。

## 未完成（需真机）

| 任务 | 内容 | 阻塞原因 |
|---|---|---|
| 4.3 | 美团商品页单独改房态、改房量各一次 | 需真实美团账号与登录态 |
| 4.4 | 确认 `inventory/check` 确实没产生第二条上报 | 同上 |
| 4.5 | 抓一次**被美团拒绝**的失败响应样本 | 同上；且需构造失败场景 |
| 5.1 | 与携程那份 delta 一并合并进 `openspec/specs/` | 应在两个 change 都真机验收后做 |

⚠️ **4.3 未完成前不得声称本变更「已验证可用」** —— 单测覆盖的是解析与判定逻辑，
拦不拦得到只有真机能证。

### 真机时重点看什么

```
1. 停在 /ebooking/merchant/product，日志应有 `Amount change watching started`
2. 单独关房一次 → endpointId=inventory-status-switch，changeType=roomStatus
                  changeRaw.status=0、changeRaw.roomId 有值
3. 改房量一次   → endpointId=inventory-update，changeType=roomStatus
                  ⚠️ **只应有一条上报** —— 若出现两条（一条来自 check），
                     说明 check 被误拦，属严重问题
4. changeRaw 里 countType/invSwitch/limitChangeValue/count 应完整保留
5. 顺带改一次价 → changeType=price，证明两条路互不干扰
```

若第 3 步出现两条上报，先查 `watchedEndpoints` 是否被改动过 —— 单测 3.3 应该已经挡住这种情况。
