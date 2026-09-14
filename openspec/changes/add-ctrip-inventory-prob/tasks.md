## 1. 接口契约与字段语义固化

- [ ] 1.1 新建 `channels/ctrip/inventory-payload.ts`：两个端点的请求体骨架、`CtripRoomRef` 6 字段、`roomStatusResult`/`roomPriceResult` 关键字段类型与语义注释（照 `room-status-quantity-payload.ts` 的风格，纯类型+注释，给 RMS 对接看）
- [ ] 1.2 在 1.1 里写明三条反直觉约定：`limitSale:"F"` 时房量 0 不代表没房、金额单位是元的浮点、取 `price` 不取 `originalPrice`
- [ ] 1.3 新建 `channels/ctrip/cookie-header.ts`：`toCookieHeader(cookies)` 纯函数，入参只收 `{ name, value }[]`
- [ ] 1.4 `cookie-header.ts` 单测：正常拼接、空数组、值含分号/空格的转义；**一条回归用例**断言输出不是 JSON 形态（守 2026-08-09 事故）

## 2. 解析与映射（纯函数，全部可单测）

- [ ] 2.1 Step 1 响应解析：只读 `data[].roomInfos[]`，忽略物理层与 `roomPPInfos`/`roomFGInfos`；zod schema 用 `looseObject`
- [ ] 2.2 源头过滤 `hourRoom===true` / `advanceSale===true`，**在去重前**；判据「明确为 true 才排除」，标记缺失不排除
- [ ] 2.3 按 `roomTypeID` 去重，保留 `rateCodeID`
- [ ] 2.4 单测 2.1-2.3：含钟点房与预售的清单、标记缺失的房型（应保留）、重复房型
- [ ] 2.5 `roomStatus` 映射：`"G"→OPEN`、`"N"|"Y"→CLOSED`、未知→`CLOSED` + warn
- [ ] 2.6 Step 2 响应合并：以 `roomStatusResult` 为骨架，按 `${roomTypeID}:${effectDate}` 索引挂价格，价格缺失填 `null`（不丢整行）
- [ ] 2.7 单测 2.5-2.6：用 `docs/携程/踩点/房态2.md` 的 4 个人工标注样本（限量剩7 / FS / FS剩1 / 不限）逐条断言；另加「价格未覆盖某 cell」用例断言房态仍产出
- [ ] 2.8 登录失效四形态判定 + 403 单列，返回 design.md 决策 5 的 tagged union；单测覆盖四形态各一例 + 403 不得归为 `COOKIE_EXPIRED`
- [ ] 2.9 形态 2 的 HTML 登录页判定单测：用 `rms-rpa-worker/tests/fixtures/ctrip/login_page.html` 作为输入，断言命中；另断言「靠 title 判断」会漏（回归守护）

## 3. Probe 与 port

- [ ] 3.1 `channels/types.ts` 加 `InventoryProbe` 接口（`probeOnce(ctx): Promise<InventoryOutcome>`，`InventoryOutcome` 为 tagged union，不用空数组表失败）
- [ ] 3.2 新建 `channels/ctrip/inventory-prob.ts`：`createCtripInventoryProbe(logger)`，串起两步请求 + 第 2 组的解析；超时 30s
- [ ] 3.3 请求头按 design.md 决策 3 只发 4 个；确认 cookie 不出现在任何日志参数里
- [ ] 3.4 `registry.ts`：`ChannelAdapter` 加可选 `inventoryProbe`，携程一行接上，新增 `inventoryProbes()` 投影（照 `amountChangeAdapters()` 跳过无此能力渠道的写法）
- [ ] 3.5 `inventory-prob.ts` 单测：用 fixture 驱动两步请求（fetch 注入替身），覆盖成功、cookie 失效、403、网络失败

## 4. 调度与装配

- [ ] 4.1 新建 `channels/inventory-poll-dispatcher.ts`：构造参数为 design.md 决策 7 的三个窄回调 + `intervalMs` / `windowDays`；`start()` 返回 dispose 句柄
- [ ] 4.2 实现 design.md 决策 8 的 `tick()`：无凭证直接返回不发请求、`inFlight` 按凭证去重、`disposed` 后丢弃 in-flight 结果
- [ ] 4.3 `window-scope.ts` 装配 dispatcher，注入三个窄回调（`readCookies` 直接转 `SessionFactory.readInjectableCookies` 并裁成 `{name,value}[]`，**不新增 SessionFactory 方法**），`onDispose` 接上 dispose 句柄
- [ ] 4.4 第一阶段 `report` 实现为汇总日志：`channel`/`credentialId`/`hotelId`/`windowDays`/`roomTypeCount`/`cellCount`/`durationMs`/`reason`
- [ ] 4.5 加环境开关：第一阶段默认只在开发环境启用（参考 `2d8794f` 的处理方式），不进正式包
- [ ] 4.6 dispatcher 单测：无凭证不发请求、`inFlight` 去重、dispose 后不再起新轮且 in-flight 结果被丢弃

## 5. 验证与收口

- [ ] 5.1 `npm run -s typecheck` + lint，确认 `channels/` 层无越界 import（eslint zone 会拦）
- [ ] 5.2 跑本 change 受影响模块的测试（第 1-4 组新增的用例）
- [ ] 5.3 **连通性判定**（design.md Risks 第一行）：登录携程 → 等一个间隔 → 确认两步请求返回 `code === 200`。若返回登录页 HTML 或 401，说明携程不接受该 cookie 串 → 停下汇报，按降级方案 B 改 design 与本组后续任务
- [ ] 5.4 真机验证：日志汇总行的房型数与日期窗口，与携程页面人工核对一致
- [ ] 5.5 真机验证：切到其他渠道标签页 / 最小化窗口 / **完全不开携程页**，确认抓取照常发生（spec 的核心场景）
- [ ] 5.6 真机验证：关闭窗口后确认不再有抓取日志（定时器已释放）
- [ ] 5.7 真机验证登录失效路径：手动清掉该 partition 的 cookie 或等会话过期，确认判定为 `COOKIE_EXPIRED` 而非解析失败或空数据
- [ ] 5.8 把 5.3-5.7 的证据写入 `openspec/changes/add-ctrip-inventory-prob/verification.md`
- [ ] 5.9 同步 `openspec/specs/`：本次触及跨模块接口（新 port）与架构（新触发模型），按完成门禁合并三份 delta
