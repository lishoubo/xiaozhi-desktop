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
- [ ] 4.2 新增 `main/account-discovery/douyin-discovery.ts`——**未完成，dsl/get 稳定返回 invalid param，见下方「阻塞记录」，不要照抄 design.md 决策 9 的"两步 getAccountDetail 接口调用"方案，那套方案在 2026-08-04 真机验证中已被证伪**。当前代码（已提交到工作区，未合并）实际做法：
  - `douyin-login-url-matcher.ts`：`isPastLogin(url)` 要求命中 `/p/home` 且带 `groupid` 参数（对齐 `session.py:81-90`），此判据已验证有效，可保留
  - `douyin-discovery.ts`：探测层改为直接在**用户可见的登录标签页**（而非新开隐藏 WebContentsView）上操作，因为 `getAccountDetail` 数据只在真实渲染过的页面里才会出现；`root_life_account_id` 来源确认为 `sessionStorage.PartnerPrefetchStorage.getAccountDetail.data.detail.root_life_account_id`（轮询等待，非立即可读）；`dsl/get` 请求 URL 已核对与 `docs/抖音/踩点/门店信息踩点.md` 真实踩点记录逐字符一致（不带 groupid），但仍然稳定失败——阻塞，见下
  - 因为 `discover()` 现在需要接收登录标签页的 `WebContents` 引用，`DiscoveryProbe`/`DiscoveryOutcome`/`DiscoveredOtaHotel` 已从 `domain/ports/discovery.ts` 移到新建的 `main/account-discovery/discovery-probe-port.ts`（domain 层不能 import electron 类型）；`LoginUrlMatcher` 仍留在 domain。`discover()` 签名从 `(partitionName, landingUrl)` 变为 `(partitionName, landingUrl, webContents)`，携程实现忽略第三参数，未受影响
  - **阻塞记录（2026-08-04）**：`dsl/get` 请求（URL 参数已与真实踩点记录核对一致：`root_life_account_id=xxx&life_biz_view_id=22&life_account_biz_ids=`，不带 groupid）稳定返回 `status_code: 106711142 "invalid param"`，重试 4 次（每次间隔 2 秒，对齐 RPA 脚本 `fetch_poi_dsl` 重试参数）结果不变，说明不是"瞬时未就绪"。**最后发现的关键线索**：真实踩点记录（`门店信息踩点.md`）开头明确写着"首先，点击左侧导航：店铺管理/门店管理"——即该请求的踩点样本是在用户已进入 `/poi-manage/home` 门店管理页之后才发起并成功的；而当前实现是在 `/p/home` 页面上、且未经过点击菜单这一步、纯靠 Prefetch 轮询就已经解析出 `root_life_account_id` 并直接发起 `dsl/get`。**这个"是否必须先进入门店管理页才能成功调用 dsl/get"的假设尚未验证**，是下次会话最应该优先验证的方向，而不是继续在参数/重试上打转
  - 下次接手时：先重启应用+真机账号验证"手动点击门店管理菜单进入 `/poi-manage/home` 之后再发起 dsl/get 是否成功"，如成立则把 `resolveRootLifeAccountId` 里"仅在 Prefetch 双轮都失败后才点菜单"的逻辑，改为不管是否已拿到 `root_life_account_id`，都先确保导航到 `/poi-manage/home` 再请求 `dsl/get`（对齐 RPA 脚本 `fetch_poi_store_info` 里"先在当前页尝试失败后才导航"的完整分支，当前实现只做了前半段）
- [x] 4.3 新增 `main/account-discovery/ctrip-discovery.ts`：在给定 partition 上创建 `WebContentsView`，加载携程登录后落地页，用 `executeJavaScript` 解析 `a.he-ctrip-hotel-title-link` 元素（文本为门店名、href 用 `/hotels?/(\d+)` 正则提取 otaHotelId），返回 `DiscoveryOutcome`（接口未踩点，DOM 选择器抄自 `rms-rpa-worker/.../ctrip/init_hotel_info.py` 已验证实现，见 design.md 决策 2）；同时新增 `ctrip-login-url-matcher.ts`：`isPastLogin(url) = !url.includes('/login/')`（抄自同仓库 `ctrip/login.py:30`，已验证判据）。**已用真实携程账号做真机验证（2026-08-04）**：URL 判定、探测触发、DOM 解析、建号全链路打通，`ota_account` 表已落地一条真实记录；同时实测到移动布局分支导致的一次 `none` 结果，已记录进 design.md 风险列表
- [ ] 4.3b 新增 `main/account-discovery/meituan-discovery.ts` 占位：返回"暂不支持"，不实现真实探测逻辑（美团 `LoginUrlMatcher` 同样不注册）
- [ ] 4.3c `CtripDiscoveryProbe.discover()` 轮询改为最多 3 轮、每轮 15 秒，轮次间不重新 `loadURL`（见 design.md 决策 8.1，真机验证暴露移动布局导致单轮 `none`）；补单测覆盖"第 1 轮无结果、第 2 轮拿到"的场景
- [x] 4.4 新增 `main/account-discovery/discover-and-create.ts`：探测层主流程——用内存 `Set<partitionName>` 做探测防重入（同一 partition 探测进行中直接跳过，见 design.md 决策 8）；按 `(channel, otaHotelId)` 查重；不存在则创建 `OtaAccount`；已存在则更新该账号的 `partitionName` 为本次新 partition，并删除旧 partition 的 session 目录（见 design.md 决策 7/8，URL 触发场景下旧 partition 可能仍被占用，删除失败不阻断账号更新）；已绑定的 partition（已存在关联 `OtaAccount` 且本次未查重命中新账号变化）不重复探测
- [x] 4.5a 携程部分：`ctrip-discovery.test.ts` 覆盖 DOM 解析、单店/多店判定，已随 discover 签名新增 `webContents` 参数同步更新，通过
- [x] 4.5b `discover-and-create.test.ts` 覆盖查重命中更新/删除旧 partition、防重入、已绑定不重复探测，已随 `trigger()` 签名新增 `webContents` 参数同步更新，通过
- [ ] 4.5c 抖音部分单测**已删除**（`tests/unit/main/douyin-discovery.test.ts`）——探测逻辑在本次会话内多次推翻重写，旧测试假设的数据结构/接口路径均已被真机验证证伪，留着会误导后续开发；`dsl/get` 阻塞解除、探测逻辑稳定后需要补齐

## 5. main/database：持久化

- [ ] 5.1 新增 SQLite migration：`ota_account` 表（id, channel, ota_hotel_id, display_name, partition_name, discovered_at），对 (channel, ota_hotel_id) 建唯一索引
- [ ] 5.2 实现 `SqliteOtaAccountRepository`
- [ ] 5.3 为 5.2 编写测试：新建、按渠道+门店查重、多账号并存互不影响

## 6. IPC 与 preload

- [ ] 6.1 更新 `shared/ipc-channels.ts`、`shared/browser.ts`：导入接口不再需要渠道入参；新增"开启某渠道登录标签页"的 IPC；探测结果为 multiple 时的选择确认走独立 IPC channel —— **BREAKING**，记录 preload API 变化
- [ ] 6.2 更新/新增 `main/ipc/` 下的 handler：串联导入（一次全部）、开启登录标签页（cookie 注入）、标签页关闭触发探测、multiple 场景下用户选择后创建账号
- [ ] 6.3 更新 `preload/api.ts`：暴露新的导入、开启登录标签页、确认门店选择 API
- [ ] 6.4 为 6.2 编写单测，尤其覆盖"探测返回 multiple 但用户未选择时不创建账号"

## 7. renderer：导入结果展示 + 登录引导 + 门店确认

- [ ] 7.1 修改导入相关 UI：导入完成后按渠道分组展示"已导入，待登录确认"，每项配"去登录"按钮
- [ ] 7.2 "去登录"打开内嵌标签页（复用现有 `BrowserWorkspace` 展示机制）
- [ ] 7.3 探测出多个门店时展示可勾选列表，用户确认后调用创建账号 API；单店场景自动确认
- [ ] 7.4 更新/新增组件测试覆盖：导入结果分组展示、单店自动确认、多店选择两条路径

## 8. 收尾

- [ ] 8.1 全量运行受影响模块的测试（domain、main/cookie-import、main/browser、main/account-discovery、main/database、renderer 组件）
- [ ] 8.2 人工验证：使用真实抖音账号走完整链路（导入 → 去登录（cookie 已预注入）→ 关闭标签页 → 探测 → 确认门店 → 生成账号 → 验证不同账号 partition 互相独立），产出 verification.md
- [ ] 8.3 更新 `docs/arch/2026-08-03-domain-model.md` §7「现存缺陷」：标记 D1 已修复（一账号一 partition），说明 D2 不再视为缺陷（一次性导入所有渠道是设计决策，见本次 design.md）
- [ ] 8.4 走 code-review 通道（独立 pass，不与 verification 合并）
