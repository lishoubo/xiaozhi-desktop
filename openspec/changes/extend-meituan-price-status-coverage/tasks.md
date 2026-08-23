## 1. 模型

- [x] 1.1 ~~新建 `meituan/calc-update-check.ts`~~ —— **已作废**，见 1.1b
- [x] 1.1b **删除** `meituan/calc-update-check.ts` 整个文件（决策 3：不做对账）
- [x] 1.2 ~~定义 `MeituanCalcUpdateCheck` 等三个类型~~ —— 随 1.1b 一并删除
- [x] 1.3 ~~`MeituanAmountChangeRaw` 加 `calcUpdateCheck` 字段~~ —— **已作废**，见 1.3b
- [x] 1.3b **移除** `MeituanAmountChangeRaw.calcUpdateCheck` 字段，并从
      `amount-change-payload.ts` 文件头的 changeRaw 结构图里删掉这一行
- [x] 1.4 扩写 `CalcContext`：`changeRaw` 换成 `cells: Record<键, CalcCell>` +
      `globalPricePrompt`；⚠️ 走 `JsonObject` 通道故**不能用 `Map`**。它是**进程内暂存、
      永不外发**，注释里写明这一点，避免被误认为契约的一部分
- [x] 1.5 同步改 `isCalcContext` 的校验 —— 否则旧形状的 context 会被当成合法值放行

## 2. 累积素材（决策 1、2、7）

- [x] 2.1 在 `meituan/amount-change-payload.ts` 新增累积键的提取：从 calc 响应展开出
      `(goodsId, startDate, endDate, inWeek)`，两种日期形状（`unifiedDatePriceInfos` 与
      `priceInfos`）都要认，`inWeek` 升序 join 后入键
- [x] 2.2 实现同键合并：**改前价保留首次、改后价取最新**（决策 2）。跳过 `priceInfo` 为
      null 的档（既有约定，非异常）
- [x] 2.3 跨门店防护：试算阶段发现 `poiId` 变了就重置累积（比原计划的「提交时过滤」更早）
- [x] 2.4 实现累积上限 500 项，超限丢最早并记 warn（决策：Risks 表）
- [x] 2.5 从累积结果重建 `goodsDetails[]`，形状与 calc 响应一致（RMS 现有解析逻辑必须继续
      有效）。⚠️ **整条 `weekPriceInfos[]` 元素原样放回** —— 不只 `salePrice`，还有
      `basePrice`/`subRatio`/`priceFactorInfos` 等（语义未确认的更要留）
- [x] 2.6 ~~按提交体过滤过期日期区间~~ —— **已废弃**，改用 `unified` 清空累积，见 2.9
- [x] 2.9 ⚠️ **认 `unified/calcPriceV2`，到达即清空累积**（决策 3b）：用户增删日期段时
      页面重发它，带改动后的全量日期列表。**必须交出空 context，不能 `return null`** ——
      机制层对 null 是「什么都不做」，旧累积会留着
- [x] 2.7 改 `amount-change-adapter.ts` 的 `parse`：`calcPriceV2` 分支由「整条覆盖」改为
      「读入旧 context → 合并 → 交出新 context」
- [x] 2.8 `createFlag: true` 且已产出 report 后清空累积；`createFlag: false`（预检）**不清**

## 3. 删除对账 + 补齐两种提交体形状（决策 3、5）

原第 3 节「对账」整节作废 —— 服务端不消费，desktop 也不该复现美团的定价计算。

- [x] 3.1 ~~展开提交体成键值表用于对账~~ —— **已作废**
- [x] 3.2 ~~`operateType` 可比性判定~~ —— **已作废**
- [x] 3.3 ~~逐 cell 产出四种 status~~ —— **已作废**
- [x] 3.4 跨门店防护已前移到 2.3（试算阶段重置），此处不再需要
- [x] 3.5 ~~把 `calcUpdateCheck` 挂进 `changeRaw`~~ —— **已作废**
- [x] 3.6 ~~确认对账不改变是否上报~~ —— **已作废**（无对账，本就照常上报）
- [x] 3.7 **删除** `extractUpdateCells()` 与 `buildMeituanCalcUpdateCheck()` 的调用，
      `amount-change-adapter.ts` 的 `updatePriceV2` 分支回到「成功即上报累积素材」
- [x] 3.8 ~~`submittedGoodsDateKeys()` 补 `calcPriceModels[]` 分支~~ —— **已废弃**：
      整个 `keep` 方案被 `unified` 清空取代（决策 4），不再解析提交体
- [x] 3.10 **删除** `submittedGoodsDateKeys()`、`goodsDateKey()` 与 `rebuildGoodsDetails`
      的 `keep` 参数
- [x] 3.9 ~~确认 `unified/calcPriceV2` 不加入白名单~~ —— **已推翻**，见 2.9：它承载
      日期范围语义，必须认

## 4. 文档同步

- [x] 4.1 修正 `amount-change-adapter.ts` 文件头那段已被踩点推翻的注释 —— 「每条 calc 本来
      就带着当前页面上全量的房型，不存在算 A 算 B 提交 A」现在是错的，改写为累积语义
- [x] 4.2 ~~在 `amount-change-payload.ts` 文件头指路到 `calc-update-check.ts`~~
      —— **已作废**，随 1.1b 删除该指路
- [x] 4.3 ~~补记 `operateType` 已知取值表与「未知码不可比」口径~~ —— **已作废**
- [x] 4.4 在 `amount-change-payload.ts` 文件头补**两种提交体形状**的说明（决策 5），
      并写明判据落在「改价模式」而非「端点」上

## 5. 单测

- [x] 5.1 用 `批量改房价-基础改价.md` 的真实序列（req0-req5）钉住：3 个房型全部出现在上报里
- [x] 5.2 用 `批量改房价-高级改价.md` 的 calc0/calc2 钉住**同房型不同日期段不互相覆盖**
      （决策 1 的关键用例）
- [x] 5.3 钉住同键覆盖时改前价保留首次（`基础改价` req1 → req2）
- [x] 5.4 ~~钉住漂移场景 `mismatched`~~ —— **已作废**（服务端指出该踩点依据不成立，
      且对账整体删除）
- [x] 5.5 ~~钉住 `operateType: 1` 整份 `comparable: false`~~ —— **已作废**
- [x] 5.8 ⚠️ **钉住高级模式（`calcPriceModels`）真实序列**（`批量改房价-高级改价.md`）：
      4 次 `separate/calcPriceV2` 合并 → `updatePriceV2` 提交 → 4 格素材齐全、
      `goodsDetails` **非空**。这是 3.8 的回归用例
- [x] 5.9 **删除** `meituan-calc-update-check.test.ts`
- [x] 5.6 钉住上报后清空：连续两次改价，第二次不含第一次的素材
- [x] 5.7 钉住预检不清空：`createFlag: false` 后累积仍在

## 5b. 按改价模式分支处理（design-mode-split.md）

⚠️ code review 发现「删除 `keep`」在基础模式下造成回归 —— 追查后确认根因是**两种改价
模式的渠道行为不同，却被塞进同一条处理路径**。本节推翻决策 3b/4/5 的部分结论。

- [x] 5b.1 **模式判定**：从 calc 请求体取模式 —— `calcPriceUnifiedDateModel` = A（基础/
      日历），`calcPriceModels` = B（高级）。⚠️ 判据取**请求体字段**，不取端点路径
      （`separate/calcPriceV2` 两模式共用）
- [x] 5b.2 `CalcContext` 记录本次会话的模式；模式变了就清空重来（与门店切换同口径）
- [x] 5b.3 **模式 A：按 `goodsId` 整条覆盖**，不累积日期维度（决策 A1）——
      模式 A 的 calc 每次带当前全量日期段，累积日期段会让删掉的段永久残留
- [x] 5b.4 **模式 A：按 `update.goodsList` 裁掉被移除的房型**（决策 A2）——
      新函数 `dropRoomTypesNotSubmitted()`，复用已有的 `goodsIdsOf()`。
      ⚠️ 只用 `createFlag === true` 那条。**不是把 `keep` 加回来**：只裁 goodsId、
      不碰日期结构，故不存在 `keep` 那个「形状不认识→清零」的失效方式
- [x] 5b.5 **模式 B 维持现状**（三维累积 + `unified` 清空），不需要 8.4 的裁剪 ——
      两条路各自闭环，不要交叉
- [x] 5b.6 ⚠️ **空素材不得上报**（决策 C，本 change 引入的回归）：`unified` 交出的空
      context 通过了 `isCalcContext()`，导致空 `goodsDetails` 照样上报。改为按
      「没有试算结果」处理，`return null` + warn
- [x] 5b.7 `unified` 重置时**不写 `endpointUrl`**（留空串），由后续 `separate` 填 ——
      现在上报体的 `endpointUrl` 指向 unified 而 `endpointId` 写 `calcPriceV2`，自相矛盾
- [x] 5b.8 ⚠️ **订正 `originalPriceInfo` 注释**（决策 D，代码不变）：`design.md` 决策 2
      与 `MeituanCalcCell.originalSalePrice` 编造了「65159→65100→65000」的序列。
      实测 `original` 恒为 65159 不随重算变化，注释必须改
- [x] 5b.9 单测：模式 A 真实序列（`批量改房价-基础改价`）—— 用户改日期范围后，
      废弃的 `08-27~08-28` **不在**上报里（这是 review 发现的回归，A/B 已实测）
- [x] 5b.10 单测：模式 A 删房型（`批量改房价-基础模式02`）—— `update.goodsList` 少一个
      房型时，累积里那个房型被裁掉
- [x] 5b.11 单测：空素材不上报；`unified` 后直接提交返回 null
- [x] 5b.12 文档同步：`design.md` 决策 3b/4/5 标注被 `design-mode-split.md` 修订；
      `proposal.md` 仍列着已删的 `submittedGoodsDateKeys()`（review #5）；
      `amount-change-adapter.ts` 文件头 118 行仍写「唯一做的过滤是 keep」（review #4）

## 6. 真机验证

- [ ] 6.1 批量改价页：改 3 个房型 × 区分周末，确认上报覆盖全部 6 个价格档
- [ ] 6.2 ⚠️ **高级模式**改动范围变更：选两个日期段 → 各改价 → **删掉一个** → 提交，
      确认上报里没有被删那段的格子（决策 3b：`unified` 清空）
- [ ] 6.7 同上，改为**删掉一个房型**（`unified` 一律清空，不区分维度）
- [ ] 6.8 基础模式**增加房型**是否触发 calc（未实证；不触发则新增房型少报）
- [ ] 6.9 **基础模式删房型**：选两个房型 → 各改价 → 删掉一个 → 提交，
      确认上报里没有被删的房型（决策 A2）
- [ ] 6.6 高级模式（「日期分开改价」）真机验证：改 2 房型 × 2 日期段，确认 4 格齐全
- [ ] 6.3 确认连续两次改价互不污染
- [ ] 6.4 确认关房仍只产生一条上报（回归，本次未改动关房链路）
- [ ] 6.5 把验证证据写入 `verification.md`

## 7. 完成门禁

- [x] 7.1 跑一次 desktop 全量单测（2026-08-23：`npm run test:unit` 100 文件 764 用例全过）（5b 完成后需重跑）
- [x] 7.4 ⚠️ 5b 完成后重新核对 `openspec/specs/ota-amount-change-report/spec.md` ——
      「同一渠道的多种操作形态」那条 Requirement 现在只描述了「靠范围快照重置」，
      需补上「渠道不提供该信号时靠提交清单裁剪」这一支
- [x] 7.2 ⚠️ 本次**不再新增契约字段** —— 重新核对
      `openspec/specs/ota-amount-change-report/spec.md`，删除已写入的对账相关规格，
      只保留「跨请求累积」这一条
- [x] 7.3 ~~RMS 侧对接说明：`calcUpdateCheck` 的结构与降级建议~~ —— 已改写为
      「服务端零改动」，见 `server-integration.md`
