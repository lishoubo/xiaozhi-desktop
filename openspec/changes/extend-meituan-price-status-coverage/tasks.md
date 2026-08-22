## 1. 模型（决策 4）

- [x] 1.1 **新建** `meituan/calc-update-check.ts`，对齐 `room-close-payload.ts` 的规格文件
      标准（RMS 对接读这一份），文件头必须含：
      - **一句话摘要**：这是 calc 与 update 的逐格对照结果
      - ⚠️ **这是 desktop 计算产物，不是美团原始字段** —— 与 `changeRaw` 其余「忠实透传」
        的内容性质相反，放在同一层只为不动跨渠道契约
      - **完整 demo**：一份真实 JSON 样例，取自 `批量改房价-基础改价.md` 的 req0-req5
        序列，四种 status 尽量都出现
      - **逐字段含义表**：每个字段的取值、量纲（×100 字符串）、可能为 null 的条件
      - **四种 status 的判定依据**与 RMS 侧降级建议（只有 `matched` 可直接跟价）
      - **`operateType` 已知取值表**（6=直接设价可比 / 1=加价 / 3=不改 / 未知码不可比）
- [x] 1.2 在该文件定义三个类型：`MeituanCalcUpdateCheck`、`MeituanCalcUpdateCell`、
      `CalcUpdateCellStatus`（骨架见 design.md 决策 4）
- [x] 1.3 扩写 `MeituanAmountChangeRaw`：加可选字段 `calcUpdateCheck`。同时在
      `amount-change-payload.ts` **文件头的 changeRaw 结构图里补上这一行**并标注
      「desktop 计算产物，规格见 ./calc-update-check.ts」—— 那张图是 RMS 对接的入口，
      漏了会让人以为 changeRaw 全是美团原始字段
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

## 3. 对账（决策 3、5、6）

- [x] 3.1 展开提交体 `calcPriceUnifiedDateModel`（`dates[]` × `calcPriceWeekModels[]`）成
      与 2.1 同构的键值表（决策 6：归一只在对账内部发生）
- [x] 3.2 实现 `operateType` 可比性判定：`6` 可比；`1`/`3`/未知码整份 `comparable: false`
      且每 cell 标 `not-comparable`（决策 5）。只比 `salePrice`
- [x] 3.3 逐 cell 产出 `matched` / `mismatched` / `missing-calc` / `not-comparable`，
      `updateValue` 与 `calcValue` 保留 ×100 字符串原值，不换算
- [x] 3.4 跨门店防护已前移到 2.3（试算阶段重置），此处不再需要
- [x] 3.5 把 `calcUpdateCheck` 挂进 `changeRaw`（决策 3），**不动**
      `packages/api` 与 `OtaAmountChangeReport` 顶层字段
- [x] 3.6 确认对账不改变是否上报：`mismatched` / `missing-calc` 存在时仍照常上报

## 4. 文档同步

- [x] 4.1 修正 `amount-change-adapter.ts` 文件头那段已被踩点推翻的注释 —— 「每条 calc 本来
      就带着当前页面上全量的房型，不存在算 A 算 B 提交 A」现在是错的，改写为累积语义
- [x] 4.2 在 `amount-change-payload.ts` 文件头加一句**指路**到 `calc-update-check.ts`
      （规格本体在 1.1 那份文件里写，此处不重复）
- [x] 4.3 补记 `operateType` 已知取值表（1/3/6）与「未知码不可比」的口径

## 5. 单测

- [x] 5.1 用 `批量改房价-基础改价.md` 的真实序列（req0-req5）钉住：3 个房型全部出现在上报里
- [x] 5.2 用 `批量改房价-高级改价.md` 的 calc0/calc2 钉住**同房型不同日期段不互相覆盖**
      （决策 1 的关键用例）
- [x] 5.3 钉住同键覆盖时改前价保留首次（`基础改价` req1 → req2）
- [x] 5.4 钉住 `房价房量日历踩点.md` 的漂移场景：calc `47100→47000`、submit `47100`
      → 该 cell 为 `mismatched`，且**仍然上报**
- [x] 5.5 钉住 `operateType: 1`（`改价踩点.md`）整份 `comparable: false`
- [x] 5.6 钉住上报后清空：连续两次改价，第二次不含第一次的素材
- [x] 5.7 钉住预检不清空：`createFlag: false` 后累积仍在

## 6. 真机验证

- [ ] 6.1 批量改价页：改 3 个房型 × 区分周末，确认上报覆盖全部 6 个价格档
- [ ] 6.2 复现漂移：填价触发 calc 后改回原值直接提交，确认 cell 标 `mismatched`
      —— 这条是 design.md Risks 里标注的**未经真机确认项**
- [ ] 6.3 确认连续两次改价互不污染
- [ ] 6.4 确认关房仍只产生一条上报（回归，本次未改动关房链路）
- [ ] 6.5 把验证证据写入 `verification.md`

## 7. 完成门禁

- [x] 7.1 跑一次 desktop 全量单测
- [x] 7.2 本次改动触及跨模块契约（`changeRaw` 新增 key），按完成门禁同步
      `openspec/specs/ota-amount-change-report/spec.md`
- [x] 7.3 RMS 侧对接说明：`calcUpdateCheck` 的结构与降级建议
