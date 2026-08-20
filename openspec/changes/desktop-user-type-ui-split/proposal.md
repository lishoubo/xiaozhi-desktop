# 按 userType 分流 desktop 界面功能

## Why

服务端已按 `user_type`（`STAFF` 服务商员工 / `HOTEL` 酒店 App 用户）完成授权改造，`GET /api/v1/me` 恒返回该字段，但 desktop 拿到后只存不用——酒店用户仍看得到「酒店管理」入口。同时「新增/删除酒店」两个按钮对应的服务端 Bean 生产环境不注册，管理员点了返回 404。

## What Changes

- `staffIdentitySchema.userType` 由 `z.string()` 收成 `z.enum(['STAFF', 'HOTEL'])`，使其可参与类型收窄
- `renderer/permissions.ts` 新增按 `userType` 判定的模块可见性能力，与既有按权限码判定的写能力**并存**（两者语义不同：前者决定「看不看得见这个模块」，后者决定「进去之后能不能改」）
- 侧边栏「酒店管理」导航项按 `userType` 显隐；`/hotels` 路由对 `HOTEL` 用户重定向回浏览器工作区
- 「新增酒店」「删除酒店」两个界面入口下线——它们对应的服务端 Bean 生产环境不注册，点了返回 404。其背后 renderer → preload → IPC → service → gateway 五层调用链**保留**，待服务端开放开关后可直接恢复
- **不改服务端**，不改改价上报链路，不改 `phone` 登录变体

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `desktop-permission-scoping`: 新增「按用户类型收敛模块可见性」这一层判据（原规范只有按权限码收敛写入口这一层）；受写能力约束的入口从五个减为三个（新增酒店、删除酒店整体下线）
- `staff-password-auth`: `MeResponse` 契约骨架补齐 `userType` 与 `phone` 字段，并约束 `userType` 的值域为封闭枚举

## Impact

| 范围 | 文件 |
|---|---|
| 共享契约 | `packages/api/src/contracts.ts` |
| 能力派生 | `apps/desktop/src/renderer/permissions.ts` |
| 界面装配 | `apps/desktop/src/renderer/App.svelte`、`components/layout/AppFrame.svelte` |
| 页面 | `apps/desktop/src/renderer/pages/HotelManagementPage.svelte` |
| 测试 | `apps/desktop/tests/unit/renderer-permissions.test.ts` |

**不受影响**：服务端（一行不改）、改价/房态上报链路、OTA 标签页与 partition、`phone` 登录变体、`createHotel` / `deleteHotel` 的五层调用链及其既有测试（保留待恢复）。
