# 任务：按 userType 分流 desktop 界面功能

设计见 [design.md](./design.md)，行为契约见 [specs/](./specs/)。按顺序执行——契约层先行，后三组都依赖 `userType` 的枚举类型收窄。

## 1. 共享契约

- [x] 1.1 `packages/api/src/contracts.ts`：`staffIdentitySchema.userType` 由 `z.string().min(1).optional()` 改为 `z.enum(['STAFF', 'HOTEL']).optional().catch(undefined)`（design 决策 1）
- [x] 1.2 更新该字段注释：删掉「当前只接收保存，不据它做界面分流」，改写为「模块可见性判据，不要用 `role`」；补充 `.catch(undefined)` 的理由（strictObject 下解析失败是登录级故障，服务端可能单方扩展枚举）
- [x] 1.3 跑 `npm run check:types --workspace @hotel-butler/desktop`，确认 `StaffIdentity['userType']` 推导为 `'STAFF' | 'HOTEL' | undefined`
- [x] 1.4 在 `apps/desktop/tests/unit/main/rms-auth-client.test.ts` 补两个用例：未知 userType（如 `'PARTNER'`）解析成功且降级为 `undefined`；`userType` 键缺失解析成功。**必须验证不抛 `RmsAuthError`**——这是本决策的核心保障

## 2. 能力派生

- [x] 2.1 `apps/desktop/src/renderer/permissions.ts`：`Capabilities` 新增 `showHotelManagement: boolean`，`NONE` 补 `showHotelManagement: false`
- [x] 2.2 `capabilitiesOf` 在既有 `permissions` 分支内计算 `showHotelManagement: session.userType !== 'HOTEL'`；`!('permissions' in session)` 提前返回的路径**逐字不动**（phone 变体行为不变）
- [x] 2.3 补文件头注释：说明两个判据的分工（userType 决定模块开放与否，权限码决定模块内能否写），以及为什么不能用 `role` 或 `hotel:view`
- [x] 2.4 `apps/desktop/tests/unit/renderer-permissions.test.ts` 扩充用例：`userType='HOTEL'` → `showHotelManagement` 为 false；`'STAFF'` → true；`userType` 缺失 → true（按 STAFF 处置）；phone 变体身份 → 两个能力均为 false
- [x] 2.5 验证既有 5 个 `manageHotel` 用例**全部未改动且仍通过**——`manageHotel` 语义不得改变
- [x] 2.6 跑 `npm run test:unit --workspace @hotel-butler/desktop -- tests/unit/renderer-permissions.test.ts`

## 3. 界面装配

- [x] 3.1 `apps/desktop/src/renderer/components/layout/AppFrame.svelte`：`$props()` 新增必填 `session: SessionLike`（类型从 `../../permissions` 导入，勿另造）
- [x] 3.2 同文件：侧栏「酒店管理」导航项（`:96-104`）包进 `{#if capabilitiesOf(session).showHotelManagement}`；其余导航项不动
- [x] 3.3 `apps/desktop/src/renderer/App.svelte:89`：`<AppFrame>` 传入 `{session}`。此处 `session` 已由 `{#if session}` 收窄为非空，无需断言
- [x] 3.4 跑 `npm run check:svelte --workspace @hotel-butler/desktop`，确认无 prop 缺失与类型错误

## 4. 页面收口

- [x] 4.1 `apps/desktop/src/renderer/pages/HotelManagementPage.svelte`：把 `:39-41` 的派生改为取整个 `Capabilities` 对象（`const caps = capabilitiesOf(...)`），`canManage` 从中取值，避免调用两次
- [x] 4.2 同文件 `onMount`（`:127` 附近）：`caps.showHotelManagement` 为 false 时 `replace('/')` 并**提前 return**，不得发起 `loadHotelManagement()`（design 决策 4：否则酒店用户会白发一次请求）。`replace` 从 `svelte-spa-router` 导入
- [x] 4.3 移除「新增酒店」按钮（`:281-286`）及其 `openCreateDialog` 触发路径上的新增酒店对话框
- [x] 4.4 移除行内「删除酒店」入口（`:371-386` 中删除酒店那一项）及其确认对话框；「新增绑定账号」保留且仍受 `canManage` 约束
- [x] 4.5 清理 4.3 / 4.4 遗留的无引用状态与函数（`createName`、`createHotel`/`deleteHotel` 的调用点等），保证 lint 无未使用告警
- [x] 4.6 在移除处留一条注释：这两个入口对应服务端 `AppHotelCrudController`，受 `rms.app.hotel-crud.enabled` 控制，生产不注册返回 404；**preload→IPC→service→gateway 五层调用链有意保留**，开关开启后可直接恢复（design 决策 5）
- [x] 4.7 重新核对 `gridColumns`（`:47`）与表头操作列（`:317`）：行内入口减少后，`canManage` 为真时操作列是否仍有内容、列宽是否仍匹配
- [x] 4.8 确认 `createHotel` / `deleteHotel` 的五层调用链与其 4 个测试文件**未被删除**（`hotel-management-handlers.test.ts`、`hotel-management-service.test.ts`、`rms-hotel-gateway-http.test.ts`、`preload/api.test.ts`）

## 5. 验证

- [x] 5.1 跑 `npm run check --workspace @hotel-butler/desktop`（types + svelte）
- [x] 5.2 跑 `npm run lint --workspace @hotel-butler/desktop`
- [x] 5.3 跑一次 `npm run test:unit --workspace @hotel-butler/desktop` 全量，确认无回归（尤其 hotel-management 相关四个测试文件仍通过）
- [x] 5.4 真机验证 · 酒店用户：手机号登录 → 侧栏无「酒店管理」→ 浏览器工作区可打开渠道网站并正常登录作业
- [ ] 5.5 真机验证 · 酒店用户兜底：登录状态下手动导航到 `/hotels` → 重定向回工作区首页 → 确认**没有**发出 `/api/v1/app/hotels` 请求（看 main 进程日志）
- [ ] 5.6 真机验证 · 直属员工：用 OWNER/ADMIN 登录 → 侧栏有「酒店管理」→ 进入后三个写入口（新增绑定账号/解绑/重新认证）在，新增酒店与删除酒店**不在**
- [ ] 5.7 真机验证 · OPERATOR：用只授权部分酒店的 OPERATOR 登录 → 侧栏有「酒店管理」→ 列表只含被授权的酒店 → 三个写入口按 `hotel:manage` 缺失而隐藏。**这条验证客户端不做酒店过滤、范围由服务端收敛**（design Context）
- [x] 5.8 真机验证 · 改价上报未受影响：酒店用户在渠道后台改一次价 → 确认上报请求正常发出（design Context 的「关掉酒店管理不影响作业」）
- [x] 5.9 把上述验证结果写入 `openspec/changes/desktop-user-type-ui-split/verification.md`，含实际命令输出与真机观察记录；**未执行的项如实标注原因，不得虚构**

## 6. 规范同步

- [ ] 6.1 完成门禁判断：本次改动了 `packages/api` 的共享契约（desktop ↔ server），触及跨模块接口 → **必须同步 `openspec/specs/`**
- [ ] 6.2 验收通过后合并两份 delta：`specs/desktop-permission-scoping/spec.md` 与 `specs/staff-password-auth/spec.md`
- [ ] 6.3 顺带修正 `openspec/specs/staff-password-auth/spec.md` 的 `MeResponse` 骨架（`:54-59`）——当前缺 `userType` 与 `phone` 两个已上线字段，本次补齐
