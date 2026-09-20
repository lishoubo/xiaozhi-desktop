## 1. ⚠️ 连通性验证（前置，阻塞全部后续）

整个方案建立在「`session.fetch` 能带着 partition 的 cookie 打通携程」之上。这条不成立
则降级手拼 `Cookie:` 头（design 决策 1 方案 D），取数层形状会变。**先验再写。**

- [ ] 1.1 写一次性验证脚本（scratchpad，不进仓库）：取一个携程凭证的 `partitionName`
      → `sessionForAccount()` → `session.fetch(getRoomInventoryInfo)` → 打印响应
- [ ] 1.2 ⚠️ **标签页关闭状态**下验证（用户提出）—— 这是本能力的核心前提
- [ ] 1.3 ⚠️ **标签页打开状态**下验证（用户提出）—— cookie jar 是否已加载、是否受页面
      刷新态影响，两种状态可能不同；若只有开着时能用，等于退化成方案 B
- [ ] 1.4 判定返回的是 JSON 还是登录页 HTML（失效四形态之一）
- [ ] 1.5 若不带 cookie → 试补 `Referer` / `Origin` / `User-Agent` 再验
- [ ] 1.6 结论回写 design 决策 1；**不通则先与用户确认降级方案再继续**

## 2. 失效判据抽取（复用，不重写）

- [ ] 2.1 从 `ctrip/inventory-readback.ts` 抽出四形态判据成独立模块，
      回读与扫描共用 —— ⚠️ 不复制一份（两份判据会漂）
- [ ] 2.2 ⚠️ 保持 403 与 401 分开（403 是没权限，重登无用）
- [ ] 2.3 既有回读测试全绿（抽取不得改变行为）

## 3. 取数层

- [ ] 3.1 新建携程扫描取数实现：两步请求（`getRcProductList` → `getRoomInventoryInfo`）
- [ ] 3.2 走注入的 `fetch` 窄回调，**不直接 import `session`**（`session.fromPartition`
      的唯一持有者是 `session-factory.ts`）
- [ ] 3.3 日期窗口从配置取，按 `window.kind` 分支（本期只有 `days`）
- [ ] 3.4 复用 `inventory-snapshot/ctrip-cells.ts` 的行→格子映射，**不另写一份**
- [ ] 3.5 ⚠️ 房态与价格两类格子都要产出（Change A 实证：同一响应含
      `roomStatusResult` 与 `roomPriceResult`）
- [ ] 3.6 失效/超时/解析失败三态分开返回，不用「空数组表示失败」
- [ ] 3.7 单测：两步请求的请求体形状；窗口计算；失效判定；空结果是合法结果

## 4. 调度器

- [ ] 4.1 新建 `channels/inventory-scan-dispatcher.ts`（第六种触发模型）
- [ ] 4.2 fixed-delay 自我重排：`setTimeout` 在 `finally` 里排下一轮
      —— ⚠️ **不用 `setInterval`**（会叠加并发打同一账号）
- [ ] 4.2b ⚠️ 间隔**每轮重新读配置**，不在构造时取一次 —— 否则服务端下发的新值
      要等重启才生效（与既有 `config: () => appConfig().xxx` 同一手法）
- [ ] 4.3 ⚠️ 首轮延迟一个间隔，不在启动时立刻跑（不与迁移/登录/凭证发现抢）
- [ ] 4.4 单轮失败不中断循环（catch 后照常排下一轮）
- [ ] 4.5 空闲判据：距上次用户写操作 < N 分钟则跳过本轮（design 决策 4）
- [ ] 4.6 `dispose()`：置位 + `clearTimeout`；in-flight 结果丢弃
- [ ] 4.7 遍历凭证串行扫描；单账号失败不影响其余
- [ ] 4.8 ⚠️ `masterHotelId` 取不到 → 跳过该账号（与 Change A 同口径）
- [ ] 4.9 单测：不叠加（上轮未完不开下轮）；失败仍排下轮；dispose 后不再跑；
      空闲判据生效；单账号失败不影响其余

## 5. 比对与写入接线

- [ ] 5.1 ⚠️ **取完整批后**再读基线 + diff + 写入，三步之间不得 await（spec 硬要求）
- [ ] 5.2 复用 `repository.findByHotelAndDateRange` 一次读一批
- [ ] 5.3 复用 `snapshot-diff.diffSnapshots`
- [ ] 5.4 ⚠️ `added` **只写基线不上报**（Change A 已实现并单测，此处只是不要绕过它）
- [ ] 5.5 写入走 `SnapshotWriteQueue`，`sourceOfTruth: 'scan'`
- [ ] 5.6 单测：首轮全 added → 零上报；第二轮有变化 → 只报 changed

## 6. 上报

- [ ] 6.1 组上报体：`changeType` 沿用 `inventoryReadback`，`endpointId` 用新值
      `inventoryScan`，`trigger.kind = 'scheduledScan'`
- [ ] 6.2 ⚠️ **不带旧值**（已定）
- [ ] 6.3 复用 `AmountChangeReportService.report`，不新增 gateway
- [ ] 6.4 新建 payload 规格文件（RMS 侧对接读这份），说明与回读上报的异同
- [ ] 6.5 单测：上报体字段；无差异时不发上报

## 7. 配置与开关

- [ ] 7.1 `InventoryScanConfig` 加 `idleMs`（**默认 5 分钟**）与空闲阈值
      ⚠️ 注释写明它是 fixed-delay 的「歇多久」而非固定频率：实际间隔 =
      本轮耗时 + idleMs，恒大于 5 分钟。取名 `idleMs` 而非 `intervalMs` 正是为此
- [ ] 7.2 ⚠️ 加三层开关：`enabled`（总闸）/ `channels[source].enabled` /
      `byHotel[id].enabled`，逐层与，任一层关即不扫
- [ ] 7.3 ⚠️ **总闸默认 false** —— 有外部副作用的周期性行为不得因装新版本自行启用
- [ ] 7.4 ⚠️ 两处默认语义**刻意相反**：`channels` 未列出=**关**（加渠道是开发行为，
      必须显式开）；`byHotel` 未列出=**取上层值**（酒店是用户动态绑的，要求显式登记
      会让新店静默不扫）。注释写明，否则后来者会"统一"成一种
- [ ] 7.5 ⚠️ **扩展 `mergeConfig` 深度**（Change A 已标注的前置）：现有实现只深一层，
      `channels`/`byHotel` 会被整体替换 —— 服务端只想关一家店会抹掉其余店配置
- [ ] 7.6 开关判定在**调度层**，不在取数层；整轮跳过记一条 info
      （否则「开关关着」与「调度器挂了」日志上长得一样），单账号跳过不记 warn
- [ ] 7.7 单测：三层任一关闭即不扫；渠道未配置=关；酒店未配置=取上层；
      逐店覆盖不影响其余店（守住 mergeConfig 深度）
- [ ] 7.8 ⚠️ `window.days` 默认值 7 → **15**，与自然读实测范围对齐（design 决策 7）
- [ ] 7.9 ⚠️ 默认**只在开发环境启用**扫描（与 7.3 的总闸是两道独立的闸）
- [ ] 7.10 单测：默认值（含 idleMs = 5 分钟）；部分覆盖不影响同组其余项

## 8. 装配与失效上报

- [ ] 8.1 `app-scope` 建调度器（⚠️ 跨窗口，窗口关闭不停扫）
- [ ] 8.2 注入六个窄回调（listCredentials / sessionFor / readBaseline / enqueue /
      report / lastWriteAt）—— `channels/` 禁 import `database/` `services/`
      `inventory-snapshot/`
- [ ] 8.3 失效走既有 `reportError`（GlitchTip），与回读同一手法
- [ ] 8.4 `onDispose` 接入唯一 disposers 链
- [ ] 8.5 `npm run lint:desktop` 无新增错误（分层禁令生效）

## 9. 验证

- [ ] 9.1 类型检查 + 受影响模块测试全绿
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
