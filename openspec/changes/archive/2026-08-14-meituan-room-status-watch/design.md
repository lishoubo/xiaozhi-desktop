# 美团房态房量监听技术方案

> 动机见 `proposal.md`。行为契约见 `specs/ota-amount-change-report/spec.md`。
> 本文只讲**怎么落地**。

## Context

上一个 change（`ctrip-room-status-watch`）已把契约铺好，本次是**纯粹的适配器改动** ——
契约、机制层、页面路径全都不动：

```
shared/types/amount-change.ts      changeType / OtaChangeType   ✅ 已就位
channels/types.ts                  isSuccessful(body, endpointId) ✅ 已就位
channels/amount-save-capture.ts    传 endpointId                 ✅ 已就位
channels/amount-change-watcher.ts  —                             ✅ 从未改过
meituan/amount-change-adapter.ts   加两个端点 + parse 分流        🆕 本次唯一改动点
```

踩点事实（`docs/踩点/美团/单房态房量01.md`）：

| 项 | 单独改房态 | 改房量 |
|---|---|---|
| 端点 | `/api/gw/v1/product/goods/inventory/status/switch` | `/api/gw/v1/product/goods/inventory/update` |
| 页面 | `/ebooking/merchant/product#/index` | 同左 |
| 门店 | `poiId` 顶层 ✅ | `poiId` 顶层 ✅ |
| 房型 | `roomId` 顶层单值 | `modifyInventoryModelList[].modifyInventorySubjectsModel.dayRoomIdList[]` |
| 开关 | `status: 0\|1` | `invSwitch: 1\|0\|-1`（嵌在最深处） |
| 房量 | — | `countType` / `limitChangeValue` / `count` |
| 响应 | `{code:10000, data:true, success:true}` | 同左 |

两者请求体形状差异极大：

```
status/switch   扁平，单房型单日期
{poiId, roomId, startDate, endDate, status, containerId, pattern, limitType, roomCategory, partnerId}

inventory/update   嵌套四层，多房型多日期段
{poiId, partnerId, changeType, modifyInventoryModelList:[{
   modifyInventorySubjectsModel: { goodsIdList, dayRoomIdList, hourRoomIdList },
   separateOperateInvDateList: [{ startDate, endDate,
     modifyParamByEffectWeek: [{ effectWeek:[1..7],
       updateInventoryUnifyInvUnitParam: { invSwitch, countType, limitChangeValue, count }}]}]}]}
```

## Goals / Non-Goals

**Goals:**

- 美团单独改房态、改房量都能被观测并上报
- 一次用户操作只上报一次（不被 `check` 预检重复触发）
- `changeRaw` 原样透传，不因「看不懂」丢字段

**Non-Goals:**

- `countType` 等字段的语义踩点 —— 本期不纠结，原样上传
- 抖音房态房量 —— 三渠道里唯一还需放开 `WATCH_PATH` 的
- 契约、机制层、页面路径的任何改动

## Decisions

### 决策 1：两个端点各用自己的 endpointId

```
inventory-status-switch   /api/gw/v1/product/goods/inventory/status/switch
inventory-update          /api/gw/v1/product/goods/inventory/update
```

沿用既有惯例：`endpointId` 就是端点方法名，与 `updatePriceV2` / `calcPriceV2` /
`setbatchroombookablestatus` 同构。两者请求体形状完全不同（见 Context 对比），合并成一个
`endpointId` 会让 RMS 失去分辨依据，只能去猜字段 —— 与携程靠 `endpointId` 分辨新老模块的做法相悖。

命名用连字符（`inventory-status-switch`）而非原始路径分段，因为路径里的 `status/switch`
带斜杠，做标识符不合适。

### 决策 2：`inventory/check` 不拦

| 请求 | 请求体 | 拦吗 |
|---|---|---|
| `POST /inventory/check` | `{poiId, modifyInventoryModelList:[…]}` | ❌ |
| `POST /inventory/update` | **逐字节相同** | ✅ |

踩点里两份 curl 的 `--data-raw` 完全一致。两个都拦 = 一次改动上报两遍，而两条上报的
`operationId` 不同，RMS 的幂等挡不住 —— 会被当成用户改了两次。

这是本链路第三次遇到同一类问题，三种解法：

```
抖音     只收 save_*，不收 check_*        端点层面区分
美团改价 看 createFlag 是否为 true         同端点，靠字段区分
美团房量 只收 update，不收 check           端点层面区分（本次，与抖音同解）
```

### 决策 3：`changeRaw` 完全原样，不写 payload 模型

| 方案 | 结论 |
|---|---|
| 原样透传 `observed.requestBody` | ✅ 采用 |
| 写 `room-status-payload.ts` 做裁剪 | ❌ 没有该剔的东西 |

美团房量请求体里**没有**设备指纹、凭证串、静态字典这类噪音（`mtgsig` 那些在 URL 与请求头里，
本来就不进 `requestBody`）。唯一的候选是 `partnerId`（商户号），但它体积极小、也确实是这次
操作的上下文，剔它得不偿失。

⚠️ **`countType`（1526/1020/1620/1720）、`invSwitch`、`limitChangeValue`、`count` 一律保留。**
含义未踩清**正是不能剔的理由**：剔了永久丢失，留着 RMS 日后踩清就能直接用。裁剪的判据始终是
「与本次改动无关」，不是「我们看不看得懂」。

与抖音改价同一做法（那边也是 `changeRaw: observed.requestBody`），三渠道裁剪策略对照：

```
douyin    改价    原样            没有噪音
ctrip     改价    剔 3 个框架字段  设备指纹 + 凭证
ctrip     房态    剔 holidyInfo    静态字典
meituan   改价    重塑为试算结果   提交体算不出绝对价（特例）
meituan   房量    原样            没有噪音   ← 本次
```

### 决策 4：房态房量合并成一条上报

`inventory/update` 一次请求里 `invSwitch`（房态）与 `count`/`countType`（房量）都有。
按**请求**上报一条，不按维度拆。

拆分的两个问题：desktop 得先读懂 `invSwitch`/`countType` 的语义才拆得开（而这些恰恰没踩清），
且会生成两个 `operationId` 让 RMS 以为改了两次。

`changeType` 都报 `roomStatus`，实际改了什么由 RMS 从 `changeRaw` 读 —— 这正是上个 change
把 `roomStatus` 定为「意向标记而非精确分类」的场景，本次是那个决定的第一个验证。

### 决策 5：成功判定不必加分支

房态房量的响应与改价**同构**：

```json
{"code": 10000, "error": null, "traceId": "…", "data": true, "success": true}
```

现有 `isMeituanSaveSuccessful` 判 `code === 10000 && success === true`，直接适用。
`data` 从改价的任务串变成了 `true`，但判定本来就不看 `data`。

所以美团的 `isSuccessful` **继续忽略 `endpointId` 形参** —— 与携程三端点形状两两不同的处境
不一样，不必为对齐而强加分支。

### 决策 6：页面路径不动

```
WATCH_PATH = '/ebooking/merchant/product'      现有，不改
  ├── 改价（批量）   #/batch-price     ✅
  ├── 改价（非批量） #/index           ✅
  └── 房态房量       #/index           ✅  ← 本次，referer 实测就是 /product
```

`#/index` 是 **hash 路由**，hash 不参与 `pathname` 匹配，三种场景的页面级 URL 实为同一个。
这正是当初把 `WATCH_PATH` 写到 `/product` 而非 `/product/batch-price` 的用意（那条注释里
写了「多认几个兄弟路由成本是零，漏认的代价是整条监听被关掉」）。

⚠️ 三渠道对照：**只有抖音房态需要放开页面路径**（在 `/hotel/status`，另一条路由），携程与美团都不用。

### 决策 7：房型标识的取法

```
status/switch     roomId                                              顶层单值
inventory/update  modifyInventoryModelList[]
                    .modifyInventorySubjectsModel
                      .dayRoomIdList[]   ← 日房
                      .hourRoomIdList[]  ← 钟点房，一并收
                      .goodsIdList[]     ← 踩点里是空数组，但也收
```

三个列表都收：踩点样本里只有 `dayRoomIdList` 有值，但字段名摆明了另两类也是房型标识，
遇到钟点房场景不收就会误判成「没有房型标识」而丢弃。

用途仅限「拦到的是不是一次真实操作」的判定 —— 全空才丢弃。不进上报体（`changeRaw` 里有全量）。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **只有成功样本，没有失败样本** —— 美团拒绝房态房量操作时的响应形状未知 | 判定复用改价那套（`code` + `success` 双重确认，保守口径），已在改价链路上验证过。真机若能构造失败应抓样本 |
| `countType` 语义未知，**RMS 暂时无法解读房量改了多少** | 本期明确不纠结（用户决策）。原样透传保证了数据不丢，RMS 侧踩清后无需 desktop 再改 |
| `inventory/check` 与 `update` 请求体相同，**未来美团若让 check 也生效**会漏报 | 目前 check 明确是预检。加一条单测钉住「check 不在 watchedEndpoints 里」，改动时会被看见 |
| 钟点房 / `goodsIdList` 场景**无真实样本** | 三个列表都收（决策 7），宁可多认。真机若遇到钟点房应补样本 |
| 房态房量与改价共用页面，**同一 capture 要认四个端点** | `matchEndpoint` 首个命中即返回；四个片段互不为子串（`updatePriceV2`/`calcPriceV2`/`status/switch`/`inventory/update`）。加单测钉住 |

## Migration Plan

纯增量，无契约变更、无数据迁移：

1. 加两个端点常量 → `parse` 分流 → 补测试
2. 回滚 = 撤 commit

## Open Questions

- **`countType` 的四个取值含义**（1526/1020/1620/1720，踩点里分别对应房量设值/清零/+1/-1 四种操作）—— 本期明确不纠结，原样上传。RMS 侧需要展开房量语义时再踩。
- **美团拒绝房态房量时的响应形状** —— 只有成功样本。不阻塞实现（判定沿用改价那套），真机若能构造失败则抓样本回填。
