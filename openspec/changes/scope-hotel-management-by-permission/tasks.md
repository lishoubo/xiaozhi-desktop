## 1. 能力判断模块

- [x] 1.1 新建 `apps/desktop/src/renderer/permissions.ts`，按 design.md D1 的骨架实现
      `capabilitiesOf(session)`：`SessionLike` 联合类型、`HOTEL_MANAGE` 常量、
      `NONE` 默认拒绝、用 `'permissions' in session` 收窄（不用类型断言、不用 `IS_STAFF_AUTH`）
- [x] 1.2 新建 `apps/desktop/tests/unit/renderer-permissions.test.ts`，覆盖 4 条：
      含 `hotel:manage` → true；只含只读码 → false；空数组 → false；`session` 为 null → false
- [x] 1.3 补一条 `phone` 变体用例：传入无 `permissions` 字段的 `EmployeeIdentity` 形状对象
      → `manageHotel` 为 false（对应 spec「权限码集合缺失时判定为否」）
- [x] 1.4 运行 `npx vitest run --config vitest.unit.config.mts tests/unit/renderer-permissions.test.ts`
      （定向，勿跑全量），确认全绿

## 2. 子组件入口收口（入口 4、5）

- [x] 2.1 `BoundOtaAccountCard.svelte` 新增**必填** prop `canManage: boolean`（design.md D4，
      必填是刻意的，漏传即编译失败）
- [x] 2.2 在卡片内按 `canManage` 隐藏「解绑」与「重新认证」两个入口；账号名称、
      状态等只读信息不受影响

## 3. 页面入口收口（入口 1、2、3）

- [x] 3.1 `HotelManagementPage.svelte` 引入 `capabilitiesOf`，挂载后读一次会话派生能力
      （design.md D5：不引入响应式 store）；注意页面在两个变体下都可路由到，
      取会话时需兼容 staff / phone 两条来源
- [x] 3.2 按能力隐藏「新增酒店」（`:258` 附近）
- [x] 3.3 按能力隐藏行内「删除酒店」（`:341` 附近）
- [x] 3.4 按能力隐藏行内「新增绑定账号」（`:335` 附近）
- [x] 3.5 向 `BoundOtaAccountCard` 传入 `canManage`（`:311` 附近的 `{#each}` 内）
- [x] 3.6 确认无权限时「操作」列表头与该列布局不塌陷（网格是三列定宽
      `minmax(180px,0.8fr)_minmax(360px,2fr)_88px`，整列变空需检查观感）

## 4. 空态

- [x] 4.1 确认酒店列表为空时展示朴素空态，不含「联系管理员开通」一类引导文案，
      且不经空态暴露任何写入口（spec 末条要求）

## 5. 验证

- [x] 5.1 通读 5 个入口逐一核对：新增酒店 / 删除酒店 / 新增绑定账号 / 解绑 / 重新认证，
      确认无遗漏（易漏点是 4、5 两个在子组件内）
- [x] 5.2 `npm run lint` 与 `npx tsc --noEmit`（或项目既有 typecheck 入口）通过
- [ ] 5.3 真机验证（记忆「UI测试范围偏好」：renderer 交互改动优先真机，不做细粒度组件测试）：
      用酒店用户 `13693214089` 短信登录 → 打开酒店管理页 → 截图确认 5 个入口均不可见、
      只读信息正常展示
- [ ] 5.4 真机验证对照组：用服务商 `admin` 密码登录 → 同页面 → 截图确认 5 个入口均照常出现
- [ ] 5.5 会话恢复路径验证：以酒店用户登录后**重启应用**（走 `restoreSession` 而非登录），
      确认写入口仍不出现（spec 明确要求两条路径一致，此项最易漏）
- [x] 5.6 完成态跑一次受影响范围的单测，跑完即止

## 6. 收尾

- [x] 6.1 把验证证据（截图 + 命令输出）写入
      `openspec/changes/scope-hotel-management-by-permission/verification.md`
- [x] 6.2 判断是否触发完成门禁：本次不改跨模块接口/架构/部署，预期**不需要**同步
      `openspec/specs/`；由 `/opsx:archive` 时统一处理 delta 合并
