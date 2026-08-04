## 1. Domain：模型与探测接口

- [ ] 1.1 新增 `domain/ota-account.ts`：`OtaAccount` 类型 `{ id, channel, otaHotelId, displayName, partitionName }` 及创建时的校验
- [ ] 1.2 新增 `domain/ports/discovery.ts`：`DiscoveryProbe` 接口、`DiscoveredOtaAccount`、`DiscoveryOutcome`（`single` | `multiple`）类型；新增 `LoginUrlMatcher` 接口 `{ channel, isPastLogin(url): boolean }`（见 design.md 决策 8）
- [ ] 1.3 扩展 `domain/ports/repositories.ts`：新增 `OtaAccountRepository` 接口（create、findByChannelAndHotelId）
- [ ] 1.4 修改 `domain/policy/partition-policy.ts`：`toPartitionName` 由 `(environment, channel, otaAccountId)` 三元组改为 `(environment, channel, 短id)`；`isCurrentLayoutPartition` 不改动
- [ ] 1.5 为 1.1-1.4 编写裸 vitest 单测（不 mock 任何框架依赖）

## 2. main/cookie-import：一次性导入所有渠道

- [ ] 2.1 新建 `src/main/cookie-import/` 目录，把 `main/browser/cookie-import.ts`、`main/browser/browser-cookie-importer.ts` 搬迁进来（对应测试文件同步搬迁）
- [ ] 2.2 修改导入逻辑：不再要求调用方传入单一渠道，一次性读取所有支持渠道的 cookie，按渠道拆分结果
- [ ] 2.3 新增 `src/main/cookie-import/store.ts`：按渠道写入 `<userData>/cookie-imports/<channel>/{manifest.json, cookies.json}`（同渠道覆盖），提供按渠道读取；不提供删除或清理能力
- [ ] 2.4 为 2.2、2.3 编写单测：一次导入产出多渠道文件的正确性、覆盖写入的正确性、读取不存在渠道时的行为

## 3. main/browser：登录标签页支持独立 partition + cookie 预注入 + URL 触发探测

- [x] 3.1 修改 `BrowserManager.create()`：不再写死绑定 `this.browserSession`，改为接受一个 partition 名字参数，调用方决定用哪个 session
- [x] 3.2 新增"开启登录标签页"的方法：生成 `environment:channel:短id` 的 partition 名，若 `cookie-imports/<channel>/` 存在文件则读出并注入这个新 partition，再创建标签页加载渠道后台页面
- [x] 3.3 在 `bindTabEvents` 的 `did-navigate` / `did-navigate-in-page` 里接入 URL 触发：若该 channel 注册了 `LoginUrlMatcher` 且 `isPastLogin(url)` 为 true，调用 `onUrlPastLogin?.(partitionName)`（见 design.md 决策 8，替代原"标签页关闭时触发"）；`close()` 不再调用探测层
- [x] 3.4 为 3.1-3.3 编写单测：不同标签页各自独立 session、cookie 注入正确性、URL 命中登录页特征时正确触发一次 `onUrlPastLogin`（mock 探测层）、未注册 matcher 的渠道不触发、标签页关闭不再触发

## 4. main/account-discovery：探测层（触发去重 + 执行 + 查重创建）

- [x] 4.1 新增 `main/account-discovery/discovery-probe.ts`：channel → `DiscoveryProbe` 实现的 registry，查不到时返回明确的"不支持"结果；新增 `main/account-discovery/login-url-matcher.ts`：channel → `LoginUrlMatcher` 的 registry
- [x] 4.2 新增 `main/account-discovery/douyin-discovery.ts`——**已用真实抖音账号做真机验证（2026-08-04），阻塞解除**：`Discovery outcome { channel: 'douyin', kind: 'single' }` + `Discovery bound OtaAccount { channel: 'douyin', otaHotelId: '7220335839249696827' }`。不要照抄 design.md 决策 9 的"两步 getAccountDetail 接口调用"方案，那套方案已被证伪。当前实现（CDP 响应拦截）：
  - `douyin-login-url-matcher.ts`：`isPastLogin(url)` 要求命中 `/p/home` 且带 `groupid` 参数（对齐 `session.py:81-90`），此判据已验证有效
  - **真正的根因**：`dsl/get` 不是能自己拼参数调用的公共接口——真机抓包证实"门店管理"页面（`/poi-manage/home`）自己发的真实请求是 **POST**，body 为 `{"params":{"id":"SceneID_Shop_Manager_Pc","id_type":2,"extra_param":{"router_back":"...(URL 编码 JSON，含 groupid)..."}}}`，且带一批 `x-secsdk-csrf-token` 之类的风控请求头；此前自己拼 GET 请求（不带 body）稳定返回 `status_code: 106711142 "invalid param"` 正是因为没传这个 body。中途还误判过要点击"商家信息"菜单（场景 `MerchantInfo_Page_Pc`），抓到的只是该页面外壳布局 DSL，不含门店数据——真正要点的是"门店管理"（场景 `Single_Shop_Home_Page_Pc` / `SceneID_Shop_Manager_Pc`，两者是同一 `dsl/get` 接口下不同调用时机的场景 id）
  - **最终方案**：不再自己拼请求，改用 `webContents.debugger`（CDP）监听 `Network.responseReceived` 定位"门店管理"页面自己发出的 `dsl/get` 请求，再用 `Network.getResponseBody` 取出真实响应体解析——点击左侧"门店管理"菜单驱动 SPA 路由后被动拦截，不侵入页面 JS 上下文，不需要拼请求头/body。字段提取对齐 RPA 参照实现 `poi_fetch.py::parse_poi_from_dsl` 的两层解析：先 `JSON.parse` 响应体、从 `dsl.extra`（嵌套 JSON 字符串）二次解析拿 `poi_id`；拿不到再正则兜底扫 `poiId`/`poiName`（响应体里这两个字段因服务端把内层 props 当字符串转义嵌入，前后引号天然带一个反斜杠，正则里已处理）
  - 因为 `discover()` 需要接收登录标签页的 `WebContents` 引用，`DiscoveryProbe`/`DiscoveryOutcome`/`DiscoveredOtaHotel` 已从 `domain/ports/discovery.ts` 移到新建的 `main/account-discovery/discovery-probe-port.ts`（domain 层不能 import electron 类型）；`LoginUrlMatcher` 仍留在 domain。`discover()` 签名从 `(partitionName, landingUrl)` 变为 `(partitionName, landingUrl, webContents)`，携程实现忽略第三参数，未受影响
- [x] 4.3 新增 `main/account-discovery/ctrip-discovery.ts`：在给定 partition 上创建 `WebContentsView`，加载携程登录后落地页，用 `executeJavaScript` 解析 `a.he-ctrip-hotel-title-link` 元素（文本为门店名、href 用 `/hotels?/(\d+)` 正则提取 otaHotelId），返回 `DiscoveryOutcome`（接口未踩点，DOM 选择器抄自 `rms-rpa-worker/.../ctrip/init_hotel_info.py` 已验证实现，见 design.md 决策 2）；同时新增 `ctrip-login-url-matcher.ts`：`isPastLogin(url) = !url.includes('/login/')`（抄自同仓库 `ctrip/login.py:30`，已验证判据）。**已用真实携程账号做真机验证（2026-08-04）**：URL 判定、探测触发、DOM 解析、建号全链路打通，`ota_account` 表已落地一条真实记录；同时实测到移动布局分支导致的一次 `none` 结果，已记录进 design.md 风险列表
- [ ] 4.3b 新增 `main/account-discovery/meituan-discovery.ts` 占位：返回"暂不支持"，不实现真实探测逻辑（美团 `LoginUrlMatcher` 同样不注册）
- [ ] 4.3c `CtripDiscoveryProbe.discover()` 轮询改为最多 3 轮、每轮 15 秒，轮次间不重新 `loadURL`（见 design.md 决策 8.1，真机验证暴露移动布局导致单轮 `none`）；补单测覆盖"第 1 轮无结果、第 2 轮拿到"的场景
- [x] 4.4 新增 `main/account-discovery/discover-and-create.ts`：探测层主流程——用内存 `Set<partitionName>` 做探测防重入（同一 partition 探测进行中直接跳过，见 design.md 决策 8）；按 `(channel, otaHotelId)` 查重；不存在则创建 `OtaAccount`；已存在则更新该账号的 `partitionName` 为本次新 partition，并删除旧 partition 的 session 目录（见 design.md 决策 7/8，URL 触发场景下旧 partition 可能仍被占用，删除失败不阻断账号更新）；已绑定的 partition（已存在关联 `OtaAccount` 且本次未查重命中新账号变化）不重复探测
- [x] 4.5a 携程部分：`ctrip-discovery.test.ts` 覆盖 DOM 解析、单店/多店判定，已随 discover 签名新增 `webContents` 参数同步更新，通过
- [x] 4.5b `discover-and-create.test.ts` 覆盖查重命中更新/删除旧 partition、防重入、已绑定不重复探测，已随 `trigger()` 签名新增 `webContents` 参数同步更新，通过
- [ ] 4.5c 抖音部分单测待补齐（`tests/unit/main/douyin-discovery.test.ts` 已删除，探测逻辑在本次会话内多次推翻重写、旧测试假设已被真机验证证伪）。**探测逻辑已于 2026-08-04 真机验证通过并稳定**（见 4.2），现在应该覆盖：CDP `Network.responseReceived`/`getResponseBody` mock 下命中 `dsl/get` 正确解析出 `poiId`/`poiName`；`extractHotelFromDslBody` 的两层解析（`dsl.extra.poi_id` 优先、正则兜底、转义引号兼容）；菜单点击失败/响应超时时返回 `none`

## 5. main/database：持久化

- [x] 5.1 新增 SQLite migration：`ota_account` 表，对 (channel, ota_hotel_id) 建唯一索引。**实际实现**：`src/main/database/application-database.ts` migration 数组 version 3（`create-ota-account`），不是独立 migration 文件；字段是 `id/channel/ota_hotel_id/ota_hotel_name/partition_name/created_at/updated_at`（不是任务描述里的 `discovered_at`），唯一索引 `ota_account_channel_hotel_idx(channel, ota_hotel_id)` 已建。真机验证已有真实数据落库（携程 + 抖音各一条）。**2026-08-04 追加 version 4 migration**（`rename-ota-account-display-name`）：`display_name` 列改名为 `ota_hotel_name`（`ALTER TABLE ... RENAME COLUMN`，不是重建表，已有真实数据无损保留），domain/main 层字段同步从 `displayName` 改名为 `otaHotelName`；真机验证 migration 正确升级已有本地库（`migrationsApplied: 1`），两条历史数据完整保留
- [x] 5.2 实现 `SqliteOtaAccountRepository`：`src/main/database/ota-account-repository.ts`，`create`、`findByChannelAndHotelId`，另加 `updatePartitionName`（design.md 决策 7 查重命中更新场景需要）
- [x] 5.3 为 5.2 编写测试：`tests/unit/main/database/ota-account-repository.test.ts`，覆盖新建查重、跨渠道/跨门店互不影响、唯一索引冲突抛错、`updatePartitionName` 更新与异常，6 个用例全部通过

## 6. IPC 与 preload

- [x] 6.1a 导入接口不再需要渠道入参（`cookies.import`，`cookieImportResultSchema` 不含 channel）；新增"开启登录标签页"IPC（`otaAccount.startLogin`）——**已完成**
- [x] 6.2a 导入（一次全部）、开启登录标签页（cookie 注入）、URL 触发探测（替代原"标签页关闭触发"，见任务 3.3）已接入 `src/main/ipc/browser-handlers.ts`——**已完成**

**6.1b/6.2b/6.3/6.4（探测结果为 `multiple` 时的选择确认 UI/IPC）不在本 change 范围内，明确不做**：见 `openspec/changes/douyin-multi-account-nav/design.md` §5、§8——`multiple` 结果目前仍不落库，是已知缺口，留给以后需要时单独立项，不在这个 change 里补。原因：抖音探测机制上不会产生 `multiple`（决策 9，选公司在登录标签页交互里完成），携程虽然理论上可能，但真机验证至今只遇到过单店，`multiple` 分支优先级低于账号二级导航（见下一个 change）。

## 7. renderer：导入结果展示 + 登录引导

- [ ] 7.1 修改导入相关 UI：导入完成后按渠道分组展示"已导入，待登录确认"，每项配"去登录"按钮
- [ ] 7.2 "去登录"打开内嵌标签页（复用现有 `BrowserWorkspace` 展示机制）
- [ ] 7.4 更新/新增组件测试覆盖：导入结果分组展示

**7.3（多店选择勾选列表）随上面 6.1b 一起明确不做，从本节移除。**

## 8. 收尾

- [ ] 8.1 全量运行受影响模块的测试（domain、main/cookie-import、main/browser、main/account-discovery、main/database、renderer 组件）
- [ ] 8.2 人工验证：使用真实抖音账号走完整链路（导入 → 去登录（cookie 已预注入）→ 关闭标签页 → 探测 → 确认门店 → 生成账号 → 验证不同账号 partition 互相独立），产出 verification.md
- [ ] 8.3 更新 `docs/arch/2026-08-03-domain-model.md` §7「现存缺陷」：标记 D1 已修复（一账号一 partition），说明 D2 不再视为缺陷（一次性导入所有渠道是设计决策，见本次 design.md）
- [ ] 8.4 走 code-review 通道（独立 pass，不与 verification 合并）
