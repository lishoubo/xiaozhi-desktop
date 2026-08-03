## 1. Domain：模型与探测接口

- [ ] 1.1 新增 `domain/ota-account.ts`：`OtaAccount` 类型 `{ id, channel, otaHotelId, displayName, partitionName }` 及创建时的校验
- [ ] 1.2 新增 `domain/ports/discovery.ts`：`DiscoveryProbe` 接口、`DiscoveredOtaAccount`、`DiscoveryOutcome`（`single` | `multiple`）类型
- [ ] 1.3 扩展 `domain/ports/repositories.ts`：新增 `OtaAccountRepository` 接口（create、findByChannelAndHotelId）
- [ ] 1.4 修改 `domain/policy/partition-policy.ts`：`toPartitionName` 由 `(environment, channel, otaAccountId)` 三元组改为 `(environment, channel, 短id)`；`isCurrentLayoutPartition` 不改动
- [ ] 1.5 为 1.1-1.4 编写裸 vitest 单测（不 mock 任何框架依赖）

## 2. main/cookie-import：一次性导入所有渠道

- [ ] 2.1 新建 `src/main/cookie-import/` 目录，把 `main/browser/cookie-import.ts`、`main/browser/browser-cookie-importer.ts` 搬迁进来（对应测试文件同步搬迁）
- [ ] 2.2 修改导入逻辑：不再要求调用方传入单一渠道，一次性读取所有支持渠道的 cookie，按渠道拆分结果
- [ ] 2.3 新增 `src/main/cookie-import/store.ts`：按渠道写入 `<userData>/cookie-imports/<channel>/{manifest.json, cookies.json}`（同渠道覆盖），提供按渠道读取；不提供删除或清理能力
- [ ] 2.4 为 2.2、2.3 编写单测：一次导入产出多渠道文件的正确性、覆盖写入的正确性、读取不存在渠道时的行为

## 3. main/browser：登录标签页支持独立 partition + cookie 预注入

- [ ] 3.1 修改 `BrowserManager.create()`：不再写死绑定 `this.browserSession`，改为接受一个 partition 名字参数，调用方决定用哪个 session
- [ ] 3.2 新增"开启登录标签页"的方法：生成 `environment:channel:短id` 的 partition 名，若 `cookie-imports/<channel>/` 存在文件则读出并注入这个新 partition，再创建标签页加载渠道后台页面
- [ ] 3.3 标签页关闭时触发账号探测（调用 Task 4 的探测层入口），探测结果与标签页生命周期解耦，不阻塞标签页关闭本身
- [ ] 3.4 为 3.1-3.3 编写单测：不同标签页各自独立 session、cookie 注入正确性、关闭时正确触发探测调用（mock 探测层）

## 4. main/account-discovery：探测层（触发判断 + 执行 + 查重创建）

- [ ] 4.1 新增 `main/account-discovery/discovery-probe.ts`：channel → `DiscoveryProbe` 实现的 registry，查不到时返回明确的"不支持"结果
- [ ] 4.2 新增 `main/account-discovery/douyin-discovery.ts`：复用已验证方式——在给定 partition 上创建 `WebContentsView`，加载 `life.douyin.com` 后台页面，`executeJavaScript` 调用 `groupAccountList` 接口并分页拉取全部门店，返回 `DiscoveryOutcome`
- [ ] 4.3 新增 `main/account-discovery/ctrip-discovery.ts`、`meituan-discovery.ts` 占位：返回"暂不支持"，不实现真实探测逻辑
- [ ] 4.4 **先解决 design.md Open Questions 里的查重命中处理方式**（是否更新 `partitionName` 到最新登录、旧 partition 如何处理），再新增 `main/account-discovery/discover-and-create.ts`：探测层的主流程——按 `(channel, otaHotelId)` 查重，不存在则创建 `OtaAccount`；已存在则按确定的处理方式执行，不能沿用"只写日志"的简化
- [ ] 4.5 为 4.1-4.4 编写单测：mock `WebContentsView`/session 边界，验证分页拉取逻辑、单店/多店的 `DiscoveryOutcome` 判定、查重命中时按 4.4 确定的处理方式的行为

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
