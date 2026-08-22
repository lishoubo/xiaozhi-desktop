# 补充设计：按改价模式分支处理累积

> 本文补充 `design.md`，**推翻其中决策 3b / 4 / 5 的部分结论**。
> 起因：code review 发现「删除 `keep` 过滤」在基础模式下造成回归，追查后发现
> 根因是**两种改价模式的渠道行为完全不同，却被塞进了同一条处理路径**。

## 为什么要重做

`design.md` 的演进路径是「发现一个问题 → 打一个补丁」，四轮下来累积逻辑里混着
三套互相打架的机制：

| 轮次 | 加了什么 | 为了解决 | 结果 |
|---|---|---|---|
| 1 | 按 `(goodsId,日期段,周次)` 累积 | 一次改 3 房型只报 1 个 | ✅ 保留 |
| 2 | `keep`：按提交体裁掉过期日期段 | 用户改日期范围 | ❌ 后被删 |
| 3 | 删 `keep`，改用 `unified` 清空 | `keep` 读不懂高级模式提交体会清零 | ⚠️ 只对高级模式有效 |
| 4 | **本文** | 基础模式不发 `unified`，轮次 3 造成回归 | — |

轮次 3 的致命假设是「所有模式都会发 `unified`」。实测五份踩点：

```
批量改房价-基础改价        separate ×4, unified ×0
批量改房价-基础模式02      separate ×2, unified ×0
房价房量日历踩点           separate ×4, unified ×0
批量改房价-高级改价        separate ×4, unified ×1
批量改房价-高级改价-时间段改变  separate ×2, unified ×2
```

**`unified` 只在高级模式出现。** 基础/日历模式没有任何范围变更信号，轮次 3 删掉
`keep` 之后它们裸奔。A/B 实测（`批量改房价-基础改价` 真实序列，用户中途把日期范围
从 `08-27~08-28` 改成 `08-26~08-29`）：

```
删 keep 前（0b672ef）  上报 2 个房型，日期段只有 08-26~08-29          ✅
删 keep 后（fc9f952）  上报 3 个房型，08-27~08-28 与 08-26~08-29 并存  ❌
```

用户已放弃的日期段被上报了。

## 核心洞察：两种模式的渠道行为不同，判据是请求体字段

```
模式 A「基础 / 日历」          模式 B「高级（日期分开改价）」
├ 请求体 calcPriceUnifiedDateModel   ├ 请求体 calcPriceModels[]
├ calc 每次带**当前全量日期段**       ├ calc 每次**只带当次触碰的一段**
├ 无 unified 端点                    ├ 有 unified（范围快照）
└ 响应 unifiedDatePriceInfos         └ 响应 priceInfos[]
```

五份踩点**零重叠**，两个字段从不同时出现 —— 每条请求自己就说明了自己属于哪个模式。

⚠️ 判据取**请求体字段**而非端点路径：`separate/calcPriceV2` 两个模式共用，
端点区分不了。这是本 change 反复踩的坑（见 `design.md` 决策 5 的教训）。

## 决策 A1：模式 A 按 `goodsId` 整条覆盖，不累积日期维度

模式 A 的 calc **每次都带当前完整的日期列表**，不是增量。
踩点 `批量改房价-基础模式02` 实证：

```
calc#0  请求 dates=[09-08~09]              响应 dates=[09-08~09]
calc#1  请求 dates=[09-08~09, 09-11~12]    响应 dates=[09-08~09, 09-11~12]  ← 全量
```

**增删日期段都会触发 calc**（用户确认，2026-08-22），所以最后一次 calc 必然携带用户
当前选定的全部日期段。既然每次全量，就**不该累积日期段** —— 按 `goodsId` 整条覆盖即可。

### 模式 A 各操作是否触发 calc

| 操作 | 触发 calc | 依据 |
|---|---|---|
| 增加日期段 | ✅ | `基础模式02` 实证（calc#1 带两段） |
| 删除日期段 | ✅ | 用户确认 |
| 增加房型 | ✅（未实证，但触碰即重算） | 推定 |
| **删除房型** | ❌ | `基础模式02` 实证 —— 故需决策 A2 |

| 方案 | 删日期段能否自愈 | 结论 |
|---|---|---|
| 按 `(goodsId,日期段,周次)` 累积 | ❌ 旧日期段是独立键，不会被覆盖，永久残留 | ❌ |
| **按 `goodsId` 整条覆盖** | ✅ 新 calc 带的就是删完的列表 | ✅ |

⚠️ 仍需**跨房型累积** —— 美团只为当次触碰的房型发 calc（`基础改价` 实测一次改 3 个
房型只有 1 个在最后一条 calc 里）。覆盖的粒度是「一个 goodsId 的整条明细」，
不是「整个 context」。

## 决策 A2：模式 A 靠 `updatePriceV2` 的 `goodsList` 裁掉被移除的房型

**减少房型不触发任何请求**（`基础模式02` 实证：两条 `separate` 都只有 1 个房型，
而 `update` 有 2 个 —— 反向操作同理，删房型时美团不重算）。模式 A 又没有 `unified`，
所以累积里被删的房型无人清理。

唯一可靠的准绳是提交体：`updatePriceV2` 的 `goodsList` 是**用户实际提交的全量房型清单**。

```
上报前：把累积里 goodsId 不在 update.goodsList 中的条目丢弃
```

⚠️ 只用 `createFlag === true` 那条（用户点确认的）—— 预检那条本就 `return null`，
不参与。

### 与已废弃的 `keep` 的区别

这**不是**把 `keep` 加回来。两者维度与依赖都不同：

| | 已废弃的 `keep` | 本决策 |
|---|---|---|
| 裁剪维度 | `(goodsId, 日期段)` | **只裁 `goodsId`** |
| 解决什么 | 日期段变更残留 | **房型移除残留** |
| 依赖 | 解读提交体的**日期结构**（两种形状不同） | 只读 `goodsBaseInfo.goodsId`（**两种模式路径相同**） |
| 失效方式 | 形状不认识 → 空集 → **整条清零** | 读不出 goodsId 时上游守卫已 `return null`，走不到这里 |

`keep` 的致命缺陷源于「日期结构有两种形状」，而 `goodsId` 的取法两个模式完全一致，
该缺陷不复存在。复用已有的 `goodsIdsOf()`（`amount-change-adapter.ts` 内已实现，
上报前的守卫正在用它）。

命名不再用 `keep`（它描述实现而非意图）：

```ts
/** 丢弃不在提交清单里的房型 —— 用户移除房型时美团不重算，累积里会残留。 */
function dropRoomTypesNotSubmitted(
  cells: Readonly<Record<string, MeituanCalcCell>>,
  submittedGoodsIds: readonly string[],
): Readonly<Record<string, MeituanCalcCell>>;
```

## 决策 B1：模式 B 维持三维累积 + `unified` 清空（已实现，不动）

模式 B 的 `separate` 每次只带一段，必须按 `(goodsId, 日期段, 周次)` 累积；
增删范围（日期段或房型）都会重发 `unified`，见到即清空。

⚠️ 模式 B **不需要**决策 A2 的裁剪 —— `unified` 已覆盖房型移除的场景。
两条路各自闭环，不要交叉。

## 决策 C：`unified` 造出的空 context 不得产出上报

code review 发现的回归（本 change 引入）：`unified` 交出的空 context 结构合法，
**通过了** `isCalcContext()` 守卫（它只校验 `cells` 是对象），于是

```
unified → updatePriceV2(createFlag:true) 产出：
{ kind:'report', endpointId:'calcPriceV2',
  endpointUrl:'.../unified/calcPriceV2',   ← 与 endpointId 自相矛盾
  changeRaw:{ goodsDetails: [] } }          ← 空素材照样上报
```

改动前 context 为 `null` 会被守卫拦下丢弃，这是正确行为。

**结论：素材为空时按「没有试算结果」处理，`return null` 丢弃并 warn**，
与既有的 `!isCalcContext(context)` 分支同口径。

顺带修 `endpointUrl`：`unified` 重置时**不写入** `endpointUrl`（留空串），
由后续 `separate` 填写 —— 上报体的 `endpointId`/`endpointUrl` 必须同源。

## 决策 D：订正 `originalPriceInfo` 的注释（代码不变）

`design.md` 决策 2 与 `MeituanCalcCell.originalSalePrice` 的注释称「第二次 calc 的
`originalPriceInfo` 已是第一次改动的结果」，并给了一串「65159 → 65100 → 65000」
的所谓真实序列。

**实测该序列是错的。** `基础改价` 里 `787306` 被改三次，`original` 恒为 `65159`：

```
calc#0  original=65159  new=65000
calc#1  original=65159  new=65100    ← original 没有变成 65000
calc#2  original=65159  new=65100
```

美团给的 `originalPriceInfo` 始终是**用户本次操作前的真实起点**。
「保留首次」的实现无害（值恒定，保留首次与取最新等价），但注释编造了数据，
必须订正 —— 否则下一个人会据此做错误推断。

## 汇总

```
                    模式 A（基础/日历）          模式 B（高级）
判据           calcPriceUnifiedDateModel      calcPriceModels
累积粒度        按 goodsId 整条覆盖      按 (goodsId,日期段,周次) 累积
删日期段            覆盖自动解决               unified 清空
删房型          update.goodsList 裁剪         unified 清空
```

## 影响面

| 文件 | 改动 |
|---|---|
| `amount-change-payload.ts` | 新增模式判定；模式 A 的整条覆盖；`dropRoomTypesNotSubmitted()` |
| `amount-change-adapter.ts` | `parse` 按模式分支；空素材丢弃；`unified` 不写 `endpointUrl` |
| `CalcContext` | 需记录本次会话的模式（首条 calc 确定），避免混模式累积 |

⚠️ **契约仍然零变化** —— `changeRaw` 形状不变，服务端零改动。

## Open Questions

- 同一页面会话中模式会不会切换（用户在基础与高级之间来回切）—— 未踩点。
  保守处理：`CalcContext` 记录模式，发现模式变了就清空累积重来（与门店切换同口径）。
- 模式 A **增加房型**是否触发 calc —— 未实证。若不触发，新增房型的素材会缺失（少报，
  非错报）。列入真机验证。
