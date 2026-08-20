# 设计：按 userType 分流 desktop 界面功能

动机见 [proposal.md](./proposal.md)，行为契约见 [specs/](./specs/)。本文只讲怎么做。

## Context

### 现状：字段已经端到端可用，只差消费

```
rms-server                          packages/api              apps/desktop
─────────                           ────────────              ────────────
MeResponse.java:40                  contracts.ts:50           staff-auth.ts:3
  userType ────────────────────────► z.string()      ────────► StaffSession
  = isHotelDirect() ? HOTEL : STAFF    .min(1)                   = StaffIdentity
    ▲                                  .optional()                  │
    └─ 恒有值（存量 null 归 STAFF）                                  │
                                                                    ▼
                                                          全仓零处读取 session.userType
                                                          （contracts.ts:47 注释自陈
                                                           「当前只接收保存」）
```

服务端注释（`MeResponse.java:34-39`）已经把判据说死：

> 客户端据此决定界面形态……靠 `role` 判断不可靠：`HOTEL_STAFF` 在服务商侧也在用。

### 两条判据必须并存，不能合并

| | 判据 | 回答的问题 | 数据源 |
|---|---|---|---|
| 模块可见性 | `userType` | 这个模块对该类用户开放吗 | `MeResponse.userType` |
| 写入口 | `permissions` | 进去之后能不能改 | `role_permission` 表 |

拿权限码当模块开关会误伤 OPERATOR——他是直属员工，该看到酒店管理，但权限矩阵里没有 `hotel:manage`：

| 角色 | userType | `hotel:manage` | 期望看到酒店管理 | 期望能写 |
|---|---|---|---|---|
| OWNER | STAFF | ✅ | ✅ | ✅ |
| ADMIN | STAFF | ✅ | ✅ | ✅ |
| **OPERATOR** | STAFF | ❌ | **✅** | ❌ |
| HOTEL_STAFF（服务商侧） | STAFF | ❌ | ✅ | ❌ |
| HOTEL_STAFF（App 用户） | **HOTEL** | ❌ | **❌** | ❌ |

最后两行是关键：**角色码相同，userType 不同，期望相反**。这就是服务端注释警告不要用 `role` 的原因。

`hotel:view` 同样不能当开关——四个角色全有。

### OPERATOR 的酒店范围收敛由服务端负责，客户端不参与

```
desktop ──► /api/v1/app/**  (AppOtaAccountBindController，8 个接口零 @RequirePermission)
                  │
                  ▼
            currentEmployee()  只解析 JWT 身份
                  │
                  ▼
            AppOtaBindAppService.assertHotelAccessible(employee, hotelId)   :502
                  │
                  ▼
            HotelAccessService.resolveAccessibleHotels(employee)            :41-50
                  ├─ OWNER / ADMIN        → org 子树全部酒店
                  └─ OPERATOR/HOTEL_STAFF → hotel_user_access 显式授权
```

运营负责三家店 = 后台给他授权三家 → 桌面端酒店列表就只有三家。**客户端不需要任何按酒店的过滤逻辑。**

### 为什么关掉酒店管理不影响酒店用户作业

改价上报链路对酒店数据零硬依赖，`amount-change-report-service.ts:8` 文件头写死了这条：

> desktop 不查本地绑定、不算 hotelId，反查绑定是 RMS 的职责

```
点渠道图标 → openForNewLogin(channel, 硬编码URL)   intent = undefined
                   │                                    │
                   │  partition = sessionForLogin(channelId)   ← 只认 channel
                   │                                    │
                   ▼                                    ▼
             用户手动登录 ──► LoginDetector ──► 写本地凭证（不含酒店信息）
                   │
                   ▼
             AmountChangeWatcher（按 URL 匹配自动挂载）
                   │
                   ▼
             POST /api/v1/app/ota-changes   otaHotelId 允许空串，RMS 按渠道房型 id 反查
```

三处软降级都不阻断上报：

| 缺什么 | 位置 | 处置 |
|---|---|---|
| 携程 `masterHotelId` | `:144` | warn 后透传报文原值 |
| staff 身份 | `:64-69` | `loginUserId: null`（且该字段根本不发给服务端） |
| 本地凭证 | `:79-80` | `channelAccountId: null` |

**副作用是正向的**：不走绑定 → `HotelProbeDispatcher:59` 直接 return 不探测 → 不占独占的 debugger → 改价监听反而比员工绑定流程更不容易丢事件（对比 `amount-change-watcher.ts:117-124`）。

启动/登录后不拉酒店列表——`hotelManagement.load()` 唯一调用点是 `HotelManagementPage.svelte:100` 的 `onMount`，页面进不去就永远不发这个请求。

## Goals / Non-Goals

**Goals**

- 让 `userType` 成为模块可见性的判据，且只在一处出现（延续 `permissions.ts` 的「单一产地」）
- 保持 `manageHotel` 既有语义与其写入口收口不变
- 兜底路径覆盖「非导航进入」——旧跳转、历史地址、手敲

**Non-Goals**

- 不改服务端（含权限矩阵）
- 不动改价/房态上报、OTA 标签页、partition
- 不管 `phone` 变体（`employeeIdentitySchema` 无 `userType` 也无 `permissions`），但不得破坏其既有默认拒绝行为
- 不做路由守卫框架——只此一处，不值得
- 不删 `createHotel` / `deleteHotel` 五层调用链（见决策 5）

## Decisions

### 1. `userType` 收成枚举，但用 `catch` 而非裸 `z.enum`

```ts
// packages/api/src/contracts.ts
const userTypeSchema = z
  .enum(['STAFF', 'HOTEL'])
  .optional()
  .catch(undefined);          // ← 未知值降级为 undefined，不是解析失败
```

| 写法 | 服务端加第三种类型时 | 结论 |
|---|---|---|
| `z.string().optional()`（现状） | 正常 | 但拿不到类型收窄，判断处得比字符串 |
| `z.enum([...]).optional()` | **整个身份解析失败 → 清 token → 登录不上** | 否决 |
| `z.enum([...]).optional().catch(undefined)` | 降级为 `undefined` → 按 STAFF 处置 | **采纳** |

`staffIdentitySchema` 是 `strictObject`，且 `rms-auth-client.ts:272` 的 `safeParse` 失败会整体抛 `RmsAuthError` → `staff-auth-service.ts:36-40` 清 token。所以任何字段的解析失败都是**登录级故障**，不是局部降级。`currentHotelId` 当初踩过的就是这个坑（注释 `contracts.ts:56-60`：「表现为验证码明明对却回到登录页」）。

未知值降级为 `undefined` 后按 STAFF 处置，符合规范里「字段缺失不收窄可见范围」——宁可多显示一个员工才用的模块，也不能把人锁在门外。

### 2. 能力派生：扩展 `permissions.ts`，两个判据并列

```ts
export type Capabilities = Readonly<{
  /** 按权限码：模块内能否执行写操作。 */
  manageHotel: boolean;
  /** 按用户类型：模块是否对该类用户开放。 */
  showHotelManagement: boolean;
}>;

const NONE: Capabilities = { manageHotel: false, showHotelManagement: false };

export function capabilitiesOf(session: SessionLike | null): Capabilities {
  if (!session) return NONE;
  if (!('permissions' in session)) return NONE;      // phone 变体，维持现状
  return {
    manageHotel: session.permissions.includes(HOTEL_MANAGE),
    // 未携带 userType 按 STAFF 处置：宁可多显示，不可锁死。
    showHotelManagement: session.userType !== 'HOTEL',
  };
}
```

`NONE` 里 `showHotelManagement: false` 是刻意的——未登录时整个 `AppFrame` 都不渲染（`App.svelte:88`），这个值取不到；真取到了说明状态异常，默认拒绝更安全。

phone 变体走 `!('permissions' in session)` 提前返回，行为与现在**逐字相同**，既有测试用例不动。

### 3. session 经 prop 传给 `AppFrame`，不新造 store

```
App.svelte:17  session = $state<Session|null>       ← 已是响应式，已喂 greeting($effect :22-24)
      │
      │  {#if session}
      ▼
  <AppFrame {session}>          ← 本次新增 prop
      │
      ▼
  navigation: {#if capabilitiesOf(session).showHotelManagement}
```

| 方案 | 评价 |
|---|---|
| 新建 capabilities store | 多一层状态，且 `App.svelte` 的 `session` 已经是唯一事实来源 |
| `AppFrame` 自己调 `readStaffSession()` | 非响应式模块变量，登录后不重渲染；且要按变体分支 |
| **prop 传入** | **采纳**——沿用 greeting 已经验证过的同一条通路 |

`AppFrame` 当前只有 `{ children }: { children: Snippet }`，新增 `session` 为必填 prop，漏传即编译失败（延续 `canManage` 设必填 prop 的做法）。

### 4. `/hotels` 兜底用页面内重定向，不改路由表

`routes.ts` 是编译期静态表，而 `userType` 登录后才知道——不能像 `:18` 的 `/profile` 那样用 `IS_STAFF_AUTH` 分支。

```ts
// HotelManagementPage.svelte —— 与既有 canManage 同一处派生
const caps = capabilitiesOf(IS_STAFF_AUTH ? readStaffSession() : readAuthSession());
const canManage = caps.manageHotel;

onMount(() => {
  if (!caps.showHotelManagement) {
    replace('/');
    return;          // ← 必须提前返回，不要发起 load()
  }
  void loadHotelManagement();
});
```

重定向 SHALL 先于 `load()`：否则酒店用户会白发一次 `/api/v1/app/hotels`（服务端 `hotel:view` 对 HOTEL_STAFF 放行，请求会成功，纯属浪费且日志噪音）。

**这不是访问控制**（`permissions.ts` 文件头原话：「这是界面收口，不是安全边界」）。服务端不会兜底拦——酒店用户真发请求能拿到只读列表。收口的目的是不把不属于他的功能摆在面前。

已知的非导航入口：`hotel-management/cross-route-intents.ts`（酒店管理页 ↔ 浏览器工作区跨路由跳转）、`BindHotelDialog.svelte:238` 的文案「请回到酒店管理页解绑」。这些在酒店用户身上本就不该触发，兜底防的是意外触发。

### 5. 新增/删除酒店：只隐界面入口，保留调用链

```
                    界面入口          调用链五层                服务端
新增酒店/删除酒店 ──► 本次移除  ──►  renderer→preload→IPC      AppHotelCrudController
                                    →service→gateway          @ConditionalOnProperty
                                    ★ 全部保留 ★              (rms.app.hotel-crud.enabled)
                                                              默认关闭 → Bean 不注册 → 404
```

| 方案 | 评价 |
|---|---|
| 五层 + 4 个测试文件一并删 | 符合「删除废弃代码」，但服务端开关一开就要整条重建 |
| **只隐界面入口** | **采纳**——服务端能力只是「未开放」不是「已废弃」，留着待恢复 |

`AppHotelCrudController.java:31` 类注释：「仅供用户测试，生产环境不开放」。全仓无任何环境配置该开关，`app-ota-bind-api/tasks.md:125` 还有一条验收项确认生产未配置。

代价写清楚：五层调用链与其测试成为**无界面引用**的代码。这是自觉的取舍，不是遗漏——在 `HotelManagementPage.svelte` 移除处留注释说明恢复条件。

### 6. 收口后写入口从 5 个减为 3 个

| 入口 | 位置 | 收口判据 |
|---|---|---|
| ~~新增酒店~~ | `:281-286` | **移除**（服务端生产不可用） |
| ~~删除酒店~~ | `:371-386` 行内 | **移除**（同上） |
| 新增绑定账号 | `:371-386` 行内 | `manageHotel`（不变） |
| 解绑账号 | `BoundOtaAccountCard:150` | `manageHotel`（不变） |
| 重新认证账号 | `BoundOtaAccountCard:150` | `manageHotel`（不变） |

`:47` 的 `gridColumns` 与 `:317` 的表头操作列需重新核对：两个行内入口去掉一个后，操作列在 `canManage` 为真时是否仍有内容。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 服务端将来新增第三种 userType → 枚举解析失败使全体登录不上 | 决策 1 的 `.catch(undefined)`，未知值降级按 STAFF 处置 |
| 五层调用链失去界面引用，后人误当死代码删掉 | 在移除处留注释写明「服务端 `rms.app.hotel-crud.enabled` 开启后恢复」 |
| 酒店用户仍能通过服务端接口读到酒店列表 | 已知且接受——这是界面收口不是安全边界，规范中明写 |
| `AppFrame` 新增必填 prop，遗漏调用点 | 必填 prop 漏传即编译失败；`AppFrame` 全仓仅 `App.svelte:89` 一处使用 |
| 重定向与 `load()` 竞争，酒店用户白发一次请求 | 决策 4 的提前返回；测试覆盖「HOTEL 用户不触发 load」 |

## Migration Plan

无数据迁移、无服务端改动、无配置变更。

**回滚**：单个 commit 回退即可——所有改动都是界面层的加法（新增能力字段、新增 prop、新增重定向）与两处删除（两个按钮）。

**验证顺序**：契约 → 能力派生 → 界面装配 → 页面。契约层先行，因为后三者都依赖 `userType` 的枚举类型收窄。

## Open Questions

无。边界已在提案阶段与用户确认：服务端不改、兜底用重定向、调用链保留。
