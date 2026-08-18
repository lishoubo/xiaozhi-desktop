## Why

RMS 在登录响应里返回了 `permissions`，但桌面端全仓零消费：酒店管理页的 5 个写操作入口
对所有登录用户无条件渲染。酒店用户拿到的是全只读权限，却仍看得到「新增酒店」「删除酒店」
「新增绑定/解绑/重新认证账号」，点下去只会撞上远端拒绝。服务端一旦开启 `hotel-crud`，
这些按钮就从「无效」变成「越权入口」。

## What Changes

- 新增 renderer 侧能力判断模块：把 `StaffIdentity.permissions: string[]` 收成能力对象，
  各页面读能力布尔值，不再散落字符串比较
- 酒店管理页 5 个写操作入口按 `hotel:manage` 隐藏（不是禁用）：
  新增酒店 / 删除酒店 / 新增绑定账号 / 解绑账号 / 重新认证账号
- 登录与会话恢复两条路径都要把 `permissions` 带进渲染进程会话
- 无权限用户的空态**不加引导文案**，简单展示空列表

明确不做（本次范围外）：
- 浏览区 OTA 凭据归属校验 —— 两类用户不共用电脑，威胁模型不成立
- main 进程、gateway、数据库一律不动；服务端仍是权限的最终防线，本次只做界面收口

## Capabilities

### New Capabilities
- `desktop-permission-scoping`: 渲染进程如何把 RMS 权限码收成能力判断，以及写操作入口
  按能力隐藏的规则

### Modified Capabilities
<!-- 无：现有 staff-password-auth / rms-employee-identity 描述的是「你是谁」（认证），
     本次新增的是「你能做什么」（授权），不改动既有认证要求。 -->

## Impact

| 范围 | 影响 |
|---|---|
| `apps/desktop/src/renderer/staff-auth.ts` | 会话读写处新增能力派生 |
| `apps/desktop/src/renderer/pages/HotelManagementPage.svelte` | 5 个写入口条件渲染 |
| `apps/desktop/src/renderer/components/hotel/BoundOtaAccountCard.svelte` | 解绑/重新认证入口收口 |
| `packages/api` | 无改动（`permissions` 契约已存在） |
| main 进程 / gateway / 数据库 | 无改动 |

非破坏性：服务商用户持有 `hotel:manage`，界面与当前完全一致。
