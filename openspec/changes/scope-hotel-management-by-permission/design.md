## Context

动机见 proposal.md — Why。以下是约束本设计的既有事实。

**两套登录变体并存，身份形状不同**（`shared/auth-variant.ts` 编译期常量分流）：

| 变体 | 类型 | 来源 | 有 `permissions`？ |
|---|---|---|---|
| `staff` | `StaffIdentity` | rms-server `/api/v1/me` | ✅ `string[]` |
| `phone` | `EmployeeIdentity` | `apps/server` | ❌ **字段根本不存在** |

`EmployeeIdentity`（`packages/api/src/contracts.ts:5-12`）只有 `id/orgId/username/fullName/phone/roleCode`。
能力模块必须能吃下两种身份，**不能假设 `permissions` 存在**。

**会话在渲染进程的现状**：

```
                    ┌─ 登录 ──────────► setStaffSession / setAuthSession ─┐
App.svelte                                                                 ├─► 模块级变量
                    └─ restoreSession ► setStaffSession / setAuthSession ─┘    (staff-auth.ts /
                                                                                auth.ts)
                                                                                     │
                       目前唯一读取方：StaffProfilePage.svelte（只取显示名）◄────────┘
```

两条写入路径已经都存在且都写同一个模块级变量，**`permissions` 天然已跟着身份进来了**，
无需改动 IPC / preload / main。

**酒店管理页 5 个写入口的实际位置**：

| # | 入口 | 位置 | 触发 |
|---|---|---|---|
| 1 | 新增酒店 | `HotelManagementPage.svelte:258` | `openCreateDialog` |
| 2 | 删除酒店 | `HotelManagementPage.svelte:341` | `deleteTarget = hotel` |
| 3 | 新增绑定账号 | `HotelManagementPage.svelte:335` | `addBindingTarget = hotel` |
| 4 | 解绑账号 | `BoundOtaAccountCard` 的 `onUnbind` 回调（页面 `:316` 接） | `unbindTarget = {...}` |
| 5 | 重新认证 | `BoundOtaAccountCard` 的 `onAction` 回调（页面 `:201` 接） | `reauthTarget = {...}` |

1–3 在页面自身模板里，4–5 在子组件 `BoundOtaAccountCard.svelte` 内部（props 见 `:18-23`）。

## Goals / Non-Goals

**Goals:**
- 能力判断只有一个产地，页面读布尔值
- 两个变体、两条会话路径下行为一致且默认拒绝
- 5 个入口的隐藏是编译期可检查的，不靠人肉记住"还有第 5 个"

**Non-Goals:**
- 不做 main 进程侧的权限校验（服务端已是最终防线，客户端只做界面收口）
- 不引入权限缓存/持久化 —— 能力永远从当前会话身份现算
- 不做通用 RBAC 框架，只收本次需要的能力；第二个能力出现时再抽象

## Decisions

### D1: 能力对象放在哪一层

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 各页面直接 `permissions.includes('hotel:manage')` | 零新增文件 | 5 处重复、码字符串散落、变体分支各写一遍 | ❌ 用户已明确否决 |
| B. 新增 `renderer/permissions.ts`，从身份派生能力对象 | 单一产地、变体差异收一处、可单测 | 多一个模块 | ✅ |
| C. 放进 main 进程随 IPC 下发能力 | 渲染侧最薄 | 跨进程改动大、与"只做界面收口"的范围冲突 | ❌ 超范围 |

**采用 B。** 新文件 `apps/desktop/src/renderer/permissions.ts`：

```ts
import type { StaffSession } from './staff-auth';
import type { AuthSession } from './auth';

export type SessionLike = StaffSession | AuthSession;

/** 本次只收敛一个能力；新增能力时在此扩展，不在页面里比字符串。 */
export type Capabilities = Readonly<{
  manageHotel: boolean;
}>;

const HOTEL_MANAGE = 'hotel:manage';

const NONE: Capabilities = { manageHotel: false };

/**
 * 从当前会话身份派生能力。
 *
 * `phone` 变体的 `EmployeeIdentity` 没有 `permissions` 字段，未登录时 session 为
 * null —— 两种情况都落到「全部不具备」，即默认拒绝。
 */
export function capabilitiesOf(session: SessionLike | null): Capabilities {
  if (!session) return NONE;
  const codes = 'permissions' in session ? session.permissions : null;
  if (!codes) return NONE;
  return { manageHotel: codes.includes(HOTEL_MANAGE) };
}
```

`'permissions' in session` 是这里唯一可行的判别方式：两个类型没有公共的判别字段
（`StaffIdentity.userType` 是 optional，不能靠它）。用 `in` 而非 `IS_STAFF_AUTH`
的原因见 D2。

### D2: 变体分支用 `in` 收窄，不用 `IS_STAFF_AUTH`

`IS_STAFF_AUTH` 是编译期常量，用它做分支能让 Rollup 摇树 —— 但**它不参与类型收窄**：
`if (IS_STAFF_AUTH) session.permissions` 在 `SessionLike` 上仍是类型错误，得靠断言，
与"避免类型断言"的编程约束冲突。`in` 操作符是 TS 原生的收窄手段，零断言。

代价：`phone` 变体产物里会留下一行 `includes` 分支。可忽略。

### D3: 隐藏而非禁用

用户已定「不展示」。禁用态会让只读用户反复尝试并追问原因，且空态不加引导文案的决策
（见 spec）意味着我们不打算解释权限从何而来 —— 那么展示一个不可点的按钮只会制造疑问。

### D4: 第 4/5 个入口（子组件内）怎么收

| 方案 | 缺点 | 结论 |
|---|---|---|
| A. `BoundOtaAccountCard` 内部自己调 `capabilitiesOf` | 组件依赖全局会话，变成不纯的展示组件，难测 | ❌ |
| B. 页面传 `canManage: boolean` prop 进卡片 | 多一个 prop | ✅ |
| C. 页面不传回调（`onUnbind`/`onAction` 设为可选） | 隐式约定，卡片得判断回调在不在，易漏 | ❌ |

**采用 B。** 卡片新增必填 prop `canManage: boolean`，内部据此隐藏解绑与重新认证入口。
必填是刻意的：将来出现第二个使用方时，编译器会强制它做出选择，而不是默认放行。

```
HotelManagementPage.svelte
  const caps = $derived(capabilitiesOf(readStaffSession()))
        │
        ├── {#if caps.manageHotel} ──► 新增酒店 / 删除酒店 / 新增绑定账号   (入口 1-3)
        │
        └── <BoundOtaAccountCard canManage={caps.manageHotel} ... />
                                        │
                                        └─ {#if canManage} ─► 解绑 / 重新认证 (入口 4-5)
```

### D5: 会话在页面里怎么读

现有 `readStaffSession()` 返回模块级变量，**不是响应式的**。酒店管理页在挂载后读一次
即可：能力在一次会话内不变，变了必然经过登出→重新登录，届时整页重建。

不引入响应式 store —— 那是为"会话中途变化"准备的，本次没有这种场景。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 漏掉第 5 个入口（子组件内那两个最易漏） | `canManage` 设为**必填** prop，漏传即编译失败；tasks 里逐条列 5 个入口并各配一条验证 |
| 权限码 `hotel:manage` 若与服务端语义不符 | 码集中在 `permissions.ts` 一个常量，改一处即可；本次已与用户确认用该码 |
| 只读用户仍可经 IPC 直呼写操作 | 本次明确不管：服务端是最终防线，且 `hotel-crud` 端点当前整个未注册 |
| `phone` 变体一律无写能力 | 该变体是历史遗留（见记忆：server-client 是 phone 变体死代码），当前不装该变体的产物；若将来复活需补 `permissions` |

## Migration Plan

无数据迁移、无 IPC 契约变更。纯渲染层改动，回滚 = 还原三个文件。

服务商用户（持 `hotel:manage`）界面与当前完全一致，无感知。

## Open Questions

无。权限码与隐藏策略均已确认。
