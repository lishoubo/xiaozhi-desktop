## 1. ✅ 连通性验证（已完成 2026-09-20）

整个方案压在「`session.fetch` 能带着 partition 的 cookie 打通携程」上。**已验证通过，
不需要降级**。结论见 design 决策 1.1。

- [x] 1.1 一次性探针（跑完已删，未进仓库）：`partitionName` → `sessionForAccount()`
      → `session.fetch` 两步请求
- [x] 1.2 ⚠️ **标签页关闭状态** —— ✅ 两账号均通，31 / 13 个房型
- [x] 1.3 ⚠️ **标签页打开状态** —— ✅ 与关闭时逐字节相同。用户只开了云朵那个，
      恰好构成对照：同一轮里开着的与没开的表现一致，cookie jar 不受标签页状态影响
- [x] 1.4 非登录页判定 —— ✅ `contentType: application/json`，四形态判据均未命中
- [x] 1.5 补头 —— ✅ **只需 `Referer` + `Origin`**，无需签名头
- [x] 1.6 结论回写 design 决策 1.1
- [x] 1.7 额外证实：探针请求**不被自己的 CDP 拦到**（基线库零写入，同期 page-read
      日志的时刻与探针不重合）—— 决策 1 的第三条理由成立

## 2. 失效判据抽取（**携程内部**复用，不跨渠道）

- [x] 2.1 从 `ctrip/inventory-readback.ts` 抽出四形态判据到**同目录**的独立模块
      （如 `ctrip/session-expiry.ts`），回读与扫描共用 —— ⚠️ 不复制一份（两份会漂）
- [x] 2.2 ⚠️ **不上升到 `channels/` 顶层、不做成渠道无关的公共函数**：这套判据全是
      携程形状（成功码 200、失效码表 `{401,300,-1}`、登录页标记 `htl-ebk-login-web`），
      美团是 `code: 10000` 且无样本。参数化成「支持所有渠道」会把判据挤回调用方
      —— 美团回读那份文件已记过同一教训（刻意不跨渠道复用 fetcher）
- [x] 2.3 ⚠️ 保持 403 与 401 分开（403 是没权限，重登无用）
- [x] 2.4 既有回读测试全绿（抽取不得改变行为）

## 3. 取数层

- [x] 3.1 新建 `channels/ctrip/inventory-scan.ts`：两步请求
      （`getRcProductList` → `getRoomInventoryInfo`）
- [x] 3.2 ⚠️ 注入 **`fetch` 函数**而非 `Session` 对象（design 决策 9.1）：
      `session-factory.ts` 声明它是全仓唯一能调 `session.fromPartition()` 的地方；
      且注入函数比注入 Session 权限更小、更好测，与既有 `CtripReadbackFetcher` 同形状
- [x] 3.2b ⚠️ `Referer` / `Origin` 由**渠道实现**给，不在注入的 fetcher 里写死
      —— 那是渠道知识。连通性验证已确认只需这两个头
- [x] 3.3 日期窗口从配置取，按 `window.kind` 分支（本期只有 `days`）
- [x] 3.4 复用 `inventory-snapshot/ctrip-cells.ts` 的行→格子映射，**不另写一份**
- [x] 3.5 ⚠️ 房态与价格两类格子都要产出（Change A 实证：同一响应含
      `roomStatusResult` 与 `roomPriceResult`）
- [x] 3.6 失效/超时/解析失败三态分开返回，不用「空数组表示失败」
- [x] 3.7 单测：两步请求的请求体形状；窗口计算；失效判定；空结果是合法结果

## 4. 调度器

- [x] 4.1 新建 `channels/inventory-scan-dispatcher.ts`（**第六种**触发模型，
      与既有五个 dispatcher 并列；渠道无关，不认识任何端点名）
- [x] 4.1b `channels/types.ts` 加 `InventoryScan` 接口；`registry.ts` 加可选字段
      `inventoryScan?` 与 `inventoryScans()` 投影（照 `inventoryReadbacks()` 的写法）
      —— 没这项能力的渠道不注册即可，本期只注册携程
- [x] 4.2 fixed-delay 自我重排：`setTimeout` 在 `finally` 里排下一轮
      —— ⚠️ **不用 `setInterval`**（会叠加并发打同一账号）
- [x] 4.2b ⚠️ 间隔**每轮重新读配置**，不在构造时取一次 —— 否则服务端下发的新值
      要等重启才生效（与既有 `config: () => appConfig().xxx` 同一手法）
- [x] 4.2c ⚠️ **加随机抖动**：`delayMs = idleMs + random() * jitterMs`。
      照抄 `services/updater-service.ts` 的既有手法（线上已跑）。没有抖动的话，
      集中部署的门店会长期同相位，每 5 分钟齐刷刷打一次携程 —— 正是触发风控的形状
- [x] 4.2d ⚠️ `random` **注入**（`random?: () => number`），与 updater-service 同一
      理由：否则「间隔落在 [idleMs, idleMs+jitterMs) 区间」断言不了，只能撞概率
- [x] 4.3 ⚠️ 首轮延迟一个间隔，不在启动时立刻跑（不与迁移/登录/凭证发现抢）
- [x] 4.4 单轮失败不中断循环（catch 后照常排下一轮）
- [x] 4.5 空闲判据：距上次用户写操作 < N 分钟则跳过本轮（design 决策 4）
- [x] 4.6 `dispose()`：置位 + `clearTimeout`；in-flight 结果丢弃
- [x] 4.7 遍历凭证串行扫描；单账号失败不影响其余
- [x] 4.8 ⚠️ `masterHotelId` 取不到 → 跳过该账号（与 Change A 同口径）
- [x] 4.9 单测：不叠加（上轮未完不开下轮）；失败仍排下轮；dispose 后不再跑；
      空闲判据生效；单账号失败不影响其余；⭐ 抖动落在
      `[idleMs, idleMs + jitterMs)` 区间（注入 random 钉死两端：0 → 恰好 idleMs，
      接近 1 → 接近上界）

## 5. 比对与写入接线

- [x] 5.1 ⚠️ **取完整批后**再读基线 + diff + 写入，三步之间不得 await（spec 硬要求）
- [x] 5.2 复用 `repository.findByHotelAndDateRange` 一次读一批
- [x] 5.3 复用 `snapshot-diff.diffSnapshots`
- [x] 5.4 ⚠️ `added` **只写基线不上报**（Change A 已实现并单测，此处只是不要绕过它）
- [x] 5.5 写入走 `SnapshotWriteQueue`，`sourceOfTruth: 'scan'`
- [x] 5.6 单测：首轮全 added → 零上报；第二轮有变化 → 只报 changed

## 6. 上报

- [x] 6.1 组上报体：`changeType` 沿用 `inventoryReadback`，`endpointId` 用新值
      `inventoryScan`，`trigger.kind = 'scheduledScan'`
- [x] 6.2 ⚠️ **不带旧值**（已定）
- [x] 6.3 复用 `AmountChangeReportService.report`，不新增 gateway
- [x] 6.4 新建 payload 规格文件 `channels/ctrip/inventory-scan-payload.ts`
      —— 照 `inventory-readback-payload.ts` 的形式：只导出常量 + 类型 + 组装函数，
      **重心在文件头注释**（RMS 侧对接读这份）。要写清：
      - 与回读上报的异同（`trigger` 形状不同，其余四字段同构）
      - ⚠️ 为何 `changeType` 沿用 `inventoryReadback` 而非新增值
      - ⚠️ `cells` 里**只含有差异的格子**，不是完整快照（与回读不同）
      - ⚠️ 无基线的格子不上报（首轮只建基线），所以「没报」≠「没变」
- [x] 6.6 ⚠️ **产出 `服务端需求.md`** —— `endpointId: 'inventoryScan'` 是新端点，
      服务端要写对应 Translator 才能消费。不写的话 desktop 照发、服务端回
      `PARSE_FAILED`/`SKIPPED`（那是正常响应，单向通知），**desktop 侧看不出问题**。
      照既有两次对接的先例（`add-ctrip-inventory-readback/服务端需求.md`）
- [ ] 6.7 ⚠️ 与服务端确认端点已就绪再开启上报；未就绪则先只写基线不上报
      （摘掉 report 回调即可，见 Migration Plan 阶段 4）
- [x] 6.5 单测：上报体字段；无差异时不发上报

## 7. 配置与开关

- [x] 7.1 `InventoryScanConfig` 加 `idleMs`（**默认 5 分钟**）、`jitterMs`
      （**默认 1 分钟**，即 20%）与空闲阈值
      ⚠️ 注释写明它是 fixed-delay 的「歇多久」而非固定频率：实际间隔 =
      本轮耗时 + idleMs，恒大于 5 分钟。取名 `idleMs` 而非 `intervalMs` 正是为此
- [x] 7.2 ⚠️ 加三层开关：`enabled`（总闸）/ `channels[source].enabled` /
      `byHotel[id].enabled`，逐层与，任一层关即不扫
- [x] 7.3 ⚠️ **总闸默认 false** —— 有外部副作用的周期性行为不得因装新版本自行启用
- [x] 7.4 ⚠️ 两处默认语义**刻意相反**：`channels` 未列出=**关**（加渠道是开发行为，
      必须显式开）；`byHotel` 未列出=**取上层值**（酒店是用户动态绑的，要求显式登记
      会让新店静默不扫）。注释写明，否则后来者会"统一"成一种
- [x] 7.5 ⚠️ **扩展 `mergeConfig` 深度**（Change A 已标注的前置）：现有实现只深一层，
      `channels`/`byHotel` 会被整体替换 —— 服务端只想关一家店会抹掉其余店配置
- [x] 7.6 开关判定在**调度层**，不在取数层；整轮跳过记一条 info
      （否则「开关关着」与「调度器挂了」日志上长得一样），单账号跳过不记 warn
- [x] 7.7 单测：三层任一关闭即不扫；渠道未配置=关；酒店未配置=取上层；
      逐店覆盖不影响其余店（守住 mergeConfig 深度）
- [x] 7.8 ⚠️ `window.days` 默认值 7 → **15**，与自然读实测范围对齐（design 决策 7）
- [x] 7.9 ⚠️ 默认**只在开发环境启用**扫描（与 7.3 的总闸是两道独立的闸）
- [x] 7.10 单测：默认值（含 idleMs = 5 分钟、jitterMs = 1 分钟）；
      部分覆盖不影响同组其余项

## 8. 装配与失效上报

- [x] 8.1 `app-scope` 建调度器（⚠️ 跨窗口，窗口关闭不停扫）
- [x] 8.2 注入六个窄回调（listCredentials / sessionFor / readBaseline / enqueue /
      report / lastWriteAt）—— `channels/` 禁 import `database/` `services/`
      `inventory-snapshot/`
- [x] 8.3 失效走既有 `reportError`（GlitchTip），与回读同一手法
- [x] 8.4 `onDispose` 接入唯一 disposers 链
- [x] 8.5 `npm run lint:desktop` 无新增错误（分层禁令生效）

## 9. 验证

- [x] 9.1 类型检查 + 受影响模块测试全绿 —— ✅ typecheck 干净；lint 12 个错误与基线
      持平；单测 1120 passed / 1 failed，与基线一致（既有 `__SERVER_ORIGIN__` 问题）。
      本次新增 72 项全绿
- [ ] 9.2 真机：不开任何标签页 → 等一轮扫描 → 查库确认 `sourceOfTruth='scan'` 的格子出现
- [ ] 9.3 真机：在渠道后台（**其他浏览器**）改一次房价 → 下一轮扫描应报出差异
      —— 这是本能力的立论场景，必须验
- [ ] 9.4 真机：无变化时连续两轮 → 第二轮零上报（不重复报）
- [ ] 9.5 真机：首轮全新窗口 → 只建基线零上报
- [ ] 9.6 真机：cookie 失效（手动清 partition cookie）→ 跳过该账号 + GlitchTip 有记录
- [ ] 9.7 真机：关掉某家酒店的开关 → 该店不再被扫，同渠道其余店照常
- [ ] 9.8 观察一轮耗时与请求数，确认 `idleMs` 默认 5 分钟是否合适；
      若渠道响应慢或有风控迹象则调整，结论回写 design
- [ ] 9.9 如实记录验证结果；未能执行的项说明原因，**不虚构输出**

## 10. 收尾

- [ ] 10.1 ⚠️ 回头处理 `issues.md` 的 ISSUE-1（读端点寄生在改动适配器里）：
      此时 `InventoryScan` 接口已落地，两边形状都摆出来了，一次性梳理命名与接口边界。
      **处理或明确判定不处理，不得沉默跳过**
