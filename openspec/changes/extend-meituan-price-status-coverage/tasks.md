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
- [x] 2.6 **按提交体过滤过期日期区间**（决策 4b）：只保留提交体里出现过的
      (goodsId × 日期区间)，用户中途改日期范围留下的旧区间丢弃。⚠️ 只按日期区间过滤，
      **不按周次档** —— 周次档缺失是 `missing-calc` 的正常情况
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
- [x] 3.8 ⚠️ **`submittedGoodsDateKeys()` 补 `calcPriceModels[]` 分支**（决策 5）——
      提交体日期有两种挂载位置，只读 `calcPriceUnifiedDateModel` 会让高级模式
      `keep` 为空集、`goodsDetails` 上报为空。已以 `批量改房价-高级改价.md` 的报文
      为输入实测（单测级，非真机 —— 真机见 6.2）
- [x] 3.9 确认 `/product/price/unified/calcPriceV2` **不加入白名单**（决策 3b，零改动）

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

## 6. 真机验证

- [ ] 6.1 批量改价页：改 3 个房型 × 区分周末，确认上报覆盖全部 6 个价格档
- [ ] 6.2 ⚠️ **高级模式（「日期分开改价」）真机验证**：改 2 个房型 × 2 个日期段，
      确认上报的 `goodsDetails` 非空且覆盖全部 4 格 —— 这是 3.8 修复的场景
- [ ] 6.3 确认连续两次改价互不污染
- [ ] 6.4 确认关房仍只产生一条上报（回归，本次未改动关房链路）
- [ ] 6.5 把验证证据写入 `verification.md`

## 7. 完成门禁

- [x] 7.1 跑一次 desktop 全量单测
- [x] 7.2 ⚠️ 本次**不再新增契约字段** —— 重新核对
      `openspec/specs/ota-amount-change-report/spec.md`，删除已写入的对账相关规格，
      只保留「跨请求累积」这一条
- [x] 7.3 ~~RMS 侧对接说明：`calcUpdateCheck` 的结构与降级建议~~ —— 已改写为
      「服务端零改动」，见 `server-integration.md`
