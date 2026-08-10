# 员工用户名/密码登录（staffAuth）

## 1. 目标与边界

新建一套基于 **RMS 员工用户名 + 密码** 的登录体系，desktop **直连 rms-server**（Spring Boot），
不经过 `apps/server`。

| 项 | 决定 |
|---|---|
| 密码校验方 | rms-server `POST /api/v1/auth/login`，desktop 不碰 BCrypt |
| 凭证形态 | RMS 签发的 JWT（access + refresh），desktop 主进程持有 |
| 命名空间 | 新建 `staffAuth`，与现有 `auth`（手机验证码）**完全并列、互不引用** |
| 现有 `auth` 链路 | **不改、不删、不复用**（renderer 侧改由 `staffAuth` 驱动，见 §7） |
| 返回内容 | 严格等于 rms-server 现有 `MeResponse` / `TokenResponse` 字段，不自造字段 |
| 测试 | 不写单测（RMS 侧已成熟）；交付靠真机验证 |

**不在本次范围：** 酒店切换（`rms_current_hotel` cookie）、权限下发到 renderer 的消费、
`apps/server` 的任何改动、RMS 侧 Java 代码的任何改动。

---

## 2. 现状与目标态

```
现状（手机验证码，保持不动）
  renderer ──IPC auth:*──▶ main/ipc/auth-handlers
                            └▶ main/services/auth-service
                                 └▶ tRPC ──▶ apps/server ──▶ RMS MySQL(只读 employee)
                                             └ Set-Cookie: __Host-xiaozhi_desktop_session

新增（用户名密码，本次要做）
  renderer ──IPC staff-auth:*──▶ main/ipc/staff-auth-handlers
                                  └▶ main/services/staff-auth-service
                                       ├▶ main/staff-auth/rms-auth-client   (HTTP)
                                       │    └▶ rms-server  POST /api/v1/auth/login
                                       │                   POST /api/v1/auth/refresh
                                       │                   POST /api/v1/auth/logout
                                       │                   GET  /api/v1/me
                                       └▶ main/staff-auth/token-store       (safeStorage 加密落盘)
```

两条链路唯一的共享物是 `renderer/App.svelte` 的门禁位置——由它二选一决定渲染
`LoginPage`（旧）还是 `StaffLoginPage`（新）。

---

## 3. 与 rms-server 的接口契约（照抄，不加戏）

所有响应统一包在 `ApiResponse<T>`：`{ code: number, message: string, data: T | null }`，
`code === 0` 为成功。**HTTP 状态码也会是非 200**（如 401/423），两者都要处理。

### 3.1 `POST /api/v1/auth/login`（免鉴权）

```ts
// 请求体（对齐 LoginRequest.java）
{ username: string /* 1..64 */, password: string /* 6..128 */ }

// data（对齐 TokenResponse.java）
{
  accessToken: string
  refreshToken: string
  accessExpiresInSeconds: number   // 默认 8h
  refreshExpiresInSeconds: number  // 默认 7d
}
```

响应还会带 `Set-Cookie: rms_current_hotel=<id>; HttpOnly; SameSite=Lax`。
**本次不消费该 cookie**，但 desktop 用的 fetch 必须不丢它（见 §5.3）。

### 3.2 `POST /api/v1/auth/refresh`（免鉴权）

```ts
{ refreshToken: string }  →  data: TokenResponse   // 同上，新的一对
```

### 3.3 `GET /api/v1/me`（需 `Authorization: Bearer <access>`）

```ts
// data（对齐 MeResponse.java）
{
  userId: number
  username: string
  fullName: string | null
  role: string
  orgId: number
  currentHotelId: number | null
  accessibleHotelIds: number[]
  permissions: string[]   // Java 侧是 Set<String>，JSON 里是数组
}
```

### 3.4 `POST /api/v1/auth/logout`（需 Bearer）

`data: null`。把 access 的 jti 拉黑并清 `rms_current_hotel`。

### 3.5 错误码映射（`ErrorCode.java`）

| code | 含义 | desktop 文案 |
|---|---|---|
| 11002 | 用户名或密码错误 | 用户名或密码错误 |
| 11003 | 账号已被锁定 | 账号已被锁定，请联系管理员 |
| 11004 / 11005 | access token 过期/无效 | （内部信号 → 触发 refresh） |
| 11006 | refresh token 无效 | 登录已过期，请重新登录 |
| 10002 | 未授权 | 登录已过期，请重新登录 |
| 10001 | 参数无效 | 请检查用户名和密码 |
| 其他 / 网络错误 | — | 登录失败，请稍后重试 |

**注意**：`ACCOUNT_LOCKED`（`LoginAttemptService`）的锁定标记**无 TTL、不会自动解锁**
（见 `RmsSecurityProperties.Lockout` 注释）。文案必须提示"联系管理员"，不能写"稍后再试"。

---

## 4. 数据类型（`packages/api/src/contracts.ts` 新增）

放 `packages/api` 而非 desktop 本地，理由：preload 需要用 zod schema 校验 IPC 返回值，
现有 `auth` 就是这么做的，保持一致。**只加 schema，不加 tRPC procedure**
（本次不经过 `apps/server`，`router.ts` 一行不动）。

```ts
// packages/api/src/contracts.ts —— 追加

export const staffUsernameSchema = z.string().min(1).max(64);
export const staffPasswordSchema = z.string().min(6).max(128);

/** 对齐 rms-server MeResponse；数值 id 在 JSON 里是 number，不做 string 转换。 */
export const staffIdentitySchema = z.strictObject({
  userId: z.number().int().positive(),
  username: z.string().min(1),
  fullName: z.string().nullable(),
  role: z.string().min(1),
  orgId: z.number().int().positive(),
  currentHotelId: z.number().int().positive().nullable(),
  accessibleHotelIds: z.array(z.number().int().positive()),
  permissions: z.array(z.string()),
});
export type StaffIdentity = Readonly<z.infer<typeof staffIdentitySchema>>;

export const staffLogoutResponseSchema = z.strictObject({ success: z.literal(true) });
```

> `employeeIdentitySchema` 用 `z.string().regex(/^\d+$/)` 是因为 `apps/server` 走
> mysql2 的 `bigNumberStrings: true`。这里是 rms-server 的 JSON，Jackson 序列化
> `Long` 就是 number，所以用 `z.number()`。两套 schema 刻意不共用。

---

## 5. main 进程实现

### 5.1 目录

```
apps/desktop/src/main/
├── staff-auth/
│   ├── rms-auth-client.ts     # 纯 HTTP 适配器：ApiResponse 拆包 + 错误码 → RmsAuthError
│   ├── rms-auth-errors.ts     # RmsAuthError（携带 rms code）+ 错误码→文案表
│   ├── rms-endpoint.ts        # resolveRmsOrigin(env)
│   └── token-store.ts         # safeStorage 加密的 token 持久化
├── services/
│   └── staff-auth-service.ts  # 编排：登录/恢复/静默刷新/登出
└── ipc/
    └── staff-auth-handlers.ts # 边界层
```

分层遵守 `openspec/specs/desktop-main-layering/spec.md`：`ipc` 只声明端口 + 参数校验 +
调恰好一个 service；`staff-auth/` 是基础设施，只被 service 依赖；只有
`composition/window-scope.ts` 能 `new` 实现类。

### 5.2 `rms-endpoint.ts` —— 必须放宽 HTTPS 限制

现有 `server-client/config.ts` 的 `resolveServerOrigin` **强制 `https:`**，直接抛错。
rms-server 本地跑在 `http://localhost:8080`，所以**不能复用它**，新写一个：

```ts
const DEFAULT_RMS_ORIGIN = 'http://localhost:8080';

/**
 * 本地开发允许 http（rms-server 默认无 TLS）；非 loopback 一律要求 https，
 * 避免把 JWT 明文发到局域网/公网。
 */
export function resolveRmsOrigin(env: NodeJS.ProcessEnv): string {
  const url = new URL(env.XIAOZHI_RMS_SERVER_URL ?? DEFAULT_RMS_ORIGIN);
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !isLoopback) {
    throw new Error('远端 RMS 地址必须使用 HTTPS');
  }
  return url.origin;
}
```

线上通过 `XIAOZHI_RMS_SERVER_URL=https://...` 配置，无需改代码。

### 5.3 `rms-auth-client.ts`

```ts
export interface RmsAuthClient {
  login(username: string, password: string): Promise<RmsTokenPair>;
  refresh(refreshToken: string): Promise<RmsTokenPair>;
  me(accessToken: string): Promise<StaffIdentity>;
  logout(accessToken: string): Promise<void>;
}

export type RmsTokenPair = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessExpiresInSeconds: number;
  refreshExpiresInSeconds: number;
}>;

export function createRmsAuthClient(deps: Readonly<{
  origin: string;
  fetch: typeof globalThis.fetch;   // 注入 Electron session.fetch
  logger: AppLogger;
}>): RmsAuthClient;
```

要点：

- **fetch 用独立 session**：新增 `sessionFactory.sessionForRmsApi()`，partition
  `'persist:xiaozhi:rms-api'`。与 `server-api` 和所有 OTA 浏览 session 隔离；
  用 session.fetch 而非 `net.fetch` 是为了让 `rms_current_hotel` cookie 有地方存
  （本次不读它，但下一步接酒店上下文时就在原地）。
- **统一拆包**：读 `res.json()` → 若 `body.code !== 0` 抛 `RmsAuthError(body.code, body.message)`；
  HTTP 非 2xx 但 body 不是 `ApiResponse` 形状（如 Spring 默认 error 页）→ 抛
  `RmsAuthError(INTERNAL, ...)`。
- **绝不记录** username / password / token 到日志，只记 `rms code` 与操作名。

### 5.4 `token-store.ts`

```ts
export interface StaffTokenStore {
  read(): Promise<StoredStaffTokens | null>;
  write(tokens: StoredStaffTokens): Promise<void>;
  clear(): Promise<void>;
}

export type StoredStaffTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;   // epoch ms，由 accessExpiresInSeconds 换算
  refreshExpiresAt: number;
}>;
```

| 决策 | 结论 | 理由 |
|---|---|---|
| 存哪 | `userData/staff-auth.json` | 与现有 `file-store/` 同级，不进 SQLite（SQLite 是业务数据，token 是凭证） |
| 加密 | `electron.safeStorage.encryptString` → base64 落盘 | 明文落盘等于把 8h 有效的 JWT 送人 |
| safeStorage 不可用 | **不降级为明文**，`write` 静默跳过、`read` 返回 null | 后果只是每次启动要重登，可接受；明文落盘不可接受 |
| renderer 可见性 | **token 绝不过 IPC 边界** | 与现有 `auth` 一致：renderer 只拿身份对象 |

### 5.5 `staff-auth-service.ts`

```ts
export class StaffAuthService {
  login(username: string, password: string): Promise<StaffIdentity>;
  currentSession(): Promise<StaffIdentity | null>;
  logout(): Promise<{ success: true }>;
}
```

**`login`**
```
client.login(u, p)  →  写 token-store  →  client.me(access)  →  返回 StaffIdentity
                                             └ 失败则清 store 并抛，不留半截状态
```

**`currentSession`**（应用启动时调）
```
读 store ─ 无 ────────────────────────────────────▶ null
        └ 有 ─ access 未过期 ─▶ me(access) ─ 成功 ─▶ StaffIdentity
                              │             └ 11004/11005 ─┐
                              └ access 已过期 ─────────────┤
                                                           ▼
                                                  refresh(refreshToken)
                                                    ├ 成功 ─▶ 写 store ─▶ me() ─▶ StaffIdentity
                                                    └ 失败 ─▶ clear() ─▶ null
```

**refresh 并发**：`currentSession` 可能被并发调用。用一个模块内的
`inFlightRefresh: Promise<RmsTokenPair> | null` 去重——RMS 的 refresh 不是单次使用
（`AuthAppService.refresh` 只验签+查库，不作废旧 token），并发不会互相踢掉，但重复刷会
白白产生多对 token，去重更干净。

**`logout`**：与现有 `AuthService.logout` 同构——远端调用放 `try`，`clear()` 放 `finally`。
远端失败也必须清本地，否则用户停在"以为已登出、实际仍持有效 JWT"的状态。

**过期预留**：判断 access 是否过期时减 `30_000ms` 余量，避免请求在途中恰好跨过期点。

### 5.6 IPC

```ts
// shared/ipc-channels.ts 追加
staffAuth: {
  currentSession: 'staff-auth:current-session',
  login: 'staff-auth:login',
  logout: 'staff-auth:logout',
},
```

`staff-auth-handlers.ts` 照 `auth-handlers.ts` 写：声明 `StaffAuthOrchestrator` 端口接口，
入参 `z.tuple([staffUsernameSchema, staffPasswordSchema])`，不 import 实现类。

preload `namespaces/staff-auth.ts` 用 `staffIdentitySchema` / `staffLogoutResponseSchema`
校验返回值，与现有 `auth.ts` 同构。

### 5.7 装配（`composition/window-scope.ts`）—— 按构建变体二选一

```ts
if (AUTH_VARIANT === 'staff') {
  const rmsOrigin = resolveRmsOrigin(process.env);
  const rmsSession = scope.sessionFactory.sessionForRmsApi();
  onDispose(
    registerStaffAuthHandlers({
      window, logger,
      service: new StaffAuthService({
        client: createRmsAuthClient({
          origin: rmsOrigin,
          fetch: createElectronSessionFetch(rmsSession),
          logger,
        }),
        tokenStore: createStaffTokenStore({ userDataDir: scope.userDataDir, logger }),
        now: () => Date.now(),
        logger,
      }),
    }),
  );
} else {
  // 现有手机验证码装配，原样保留
  const serverOrigin = resolveServerOrigin(process.env);
  const apiSession = scope.sessionFactory.sessionForServerApi();
  onDispose(registerAuthHandlers({ /* …不变… */ }));
}
```

只注册命中的那一套 IPC handler：未选中的那套连 session 都不会创建。
`AUTH_VARIANT` 的来源见 §7.2。

---

## 6. 错误处理策略

| 层 | 职责 |
|---|---|
| `rms-auth-client` | HTTP/JSON → `RmsAuthError(code, message)`，保留 `cause` |
| `staff-auth-service` | 认到 11004/11005 → 内部触发 refresh（不外抛）；其余按 §3.5 转中文文案外抛 `Error(message)` |
| `ipc handler` | 由 `createHandlerRegistry` 统一兜底 |
| `renderer` | 直接展示 service 给的文案，不再二次判断 |

与现有 `AuthService.safeCall` 的差别：**不能把所有错误压成同一句话**——
"账号已被锁定"和"用户名或密码错误"对用户是完全不同的行动指引，必须区分。

---

## 7. 构建变体：打包时二选一

**两套登录不并存于同一个运行实例**，由构建期环境变量决定这个包里装哪一套。
未选中的那套走不到，也**不应被打进产物**。

### 7.0 开关设计

现有 `renderer/version-features.ts` 的 `isFeatureOff('auth')` **不能直接复用**，两个硬伤：

| 硬伤 | 说明 |
|---|---|
| 语义冲突 | 它当前含义是「跳过登录门禁用假身份进主界面」（`App.svelte:14` 的 `skipAuth`），不是「选哪套登录」。同一个 `'auth'` key 背两个互斥语义会打架 |
| 覆盖不到 main | `import.meta.env` 只在 renderer 的 Vite 构建里替换；main 进程读不到。而"只装一套"的重头在 main —— 注不注册 `auth:*` IPC、建不建 `server-api` session |

所以新增一个**独立的、main/preload/renderer 三侧可见**的构建常量
`XIAOZHI_AUTH_VARIANT = 'staff' | 'phone'`（缺省 `'staff'`）。

**为什么用 `define` 而不是 `import.meta.env`**：`define` 做的是编译期字面量替换，
`if (__AUTH_VARIANT__ === 'staff')` 会被压成 `if (true)`，Rollup 的 DCE 直接把另一分支
连同其 import 一起摇掉 —— 这正是"未选中的那套不进产物"所需要的。`import.meta.env`
在 main 进程构建里没有等价能力。

**能不能只配一处？** 不能完全只配一处，但**值和逻辑可以只写一处**。物理限制是：
forge 的 `VitePlugin` 跑的是**三次独立的 Rollup 构建**（main / preload / renderer 各一次，
见 `forge.config.ts` 的 `build[]` + `renderer[]`），`define` 是每次构建各自的编译期替换，
不存在跨构建共享的机制。所以三处必须各生效一次，问题只是那段代码写几遍。

做法：抽一个共享插件，**解析、校验、define 全在里面**，三个 config 各 import 一行。

**放哪**：`apps/desktop/vite-plugins/auth-variant.ts`，与三个 `vite.*.config.*` 同级。

```
apps/desktop/
├── vite-plugins/
│   └── auth-variant.ts        ← 唯一事实来源
├── vite.main.config.ts        ─┐
├── vite.preload.config.ts     ─┼─ 各 import 一行
├── vite.renderer.config.mts   ─┘
└── forge.env.d.ts             ← __AUTH_VARIANT__ 类型声明
```

> **不能叫 `build/`**：`tsconfig.json` 的 `exclude` 里就有 `"build"`，放那儿
> `npm run check:types` 会整个跳过这个文件，插件写错了也发现不了。
>
> 同时要在 `tsconfig.node.json` 的 `include` 补一条 `"vite-plugins/**/*.ts"` ——
> 现有 include 只有 `"*.ts"` / `"*.mts"`（仅根目录一层），子目录默认不覆盖。

```ts
// apps/desktop/vite-plugins/auth-variant.ts —— 唯一事实来源
import type { Plugin } from 'vite';

const VARIANTS = ['staff', 'phone'] as const;
export type AuthVariant = (typeof VARIANTS)[number];

export function resolveAuthVariant(env = process.env): AuthVariant {
  const raw = env.XIAOZHI_AUTH_VARIANT ?? 'staff';
  if (!VARIANTS.includes(raw as AuthVariant)) {
    // 拼错就中断构建。默认回退会打出一个"看起来正常、装错登录"的包，比构建失败危险得多。
    throw new Error(
      `XIAOZHI_AUTH_VARIANT 取值非法: ${raw}（可选 ${VARIANTS.join(' | ')}）`,
    );
  }
  return raw as AuthVariant;
}

/** 三个 vite config 共用；确保 main / preload / renderer 拿到同一个值。 */
export function authVariantDefine(): Plugin {
  const variant = resolveAuthVariant();
  return {
    name: 'xiaozhi-auth-variant',
    config: () => ({ define: { __AUTH_VARIANT__: JSON.stringify(variant) } }),
  };
}
```

三处各加一行（renderer 已有 `plugins` 数组；main/preload 目前没有该字段，新增）：

```ts
// vite.main.config.ts / vite.preload.config.ts / vite.renderer.config.mts
import { authVariantDefine } from './vite-plugins/auth-variant';
// …
plugins: [authVariantDefine(), /* …各自原有插件… */],
```

`__AUTH_VARIANT__` 在 `forge.env.d.ts` 追加一行类型声明：

```ts
declare const __AUTH_VARIANT__: 'staff' | 'phone';
```

> 走插件而不是各写各的 `define` 字面量，收益是：取值来源、合法值清单、拼错时的报错
> 都只有一份。三个 config 里剩下的那一行只是"接上"，不含任何可以写歪的逻辑。

### 7.0.1 怎么设置

命令行前缀即可，**不碰 `.env.local`**：

```bash
npm run make                              # 默认 staff
XIAOZHI_AUTH_VARIANT=phone npm run make   # 打旧的手机验证码版本
XIAOZHI_AUTH_VARIANT=phone npm run dev    # 开发同理
```

> **刻意不走 `.env.local`**：现有 `.env.local` 之所以生效，是 Vite 内建加载 `.env*`
> 并注入 `import.meta.env`（且只认 `VITE_` 前缀），**它不写 `process.env`**。
> 仓库也没装 `dotenv`。要让 `.env.local` 里的这个变量生效，就得在插件里额外调
> `loadEnv` —— 为一个每次打包顺手带一下的参数增加一条加载路径，不划算。
> 命令行前缀的变量本来就在 `process.env` 里，插件直接读得到。
>
> 相应地，**`XIAOZHI_RMS_SERVER_URL`（§5.2）也是同样的给法**——它在 main 进程运行期读
> `process.env`，开发时命令行带上即可：
> `XIAOZHI_RMS_SERVER_URL=http://localhost:8080 npm run dev`（该值本就是默认值，
> 本地通常不用带）。

统一收口在 `shared/auth-variant.ts`：

```ts
export const AUTH_VARIANT = __AUTH_VARIANT__;
export const IS_STAFF_AUTH = AUTH_VARIANT === 'staff';
```

> 现有 `version-features.ts` 与 `.env.local` 的 `offFeatures:["auth"]` **本次一并删除**
> ——用户已确认「去掉，一律走真实登录」。`App.svelte` 的 `skipAuth` /
> `DEV_BYPASS_SESSION` 分支随之删掉。本地开发必须先起 rms-server，行为与生产一致。
> `version-features.ts` 目前仅此一个使用点，删掉后文件本身也无引用，一并移除。

### 7.1 renderer session 持有

**`renderer/auth.ts` 一行不动**，新建并列的 `renderer/staff-auth.ts`：

```ts
import type { StaffIdentity } from '@hotel-butler/api';

export type StaffSession = StaffIdentity;

let currentSession: StaffSession | null = null;

export function setStaffSession(session: StaffSession): void { currentSession = session; }
export function readStaffSession(): StaffSession | null { return currentSession; }
export function clearStaffSession(): void { currentSession = null; }
```

不含 `maskPhone`（`MeResponse` 无 `phone` 字段）、不含 `EXPERIENCE_PHONE`（那是旧登录页的
体验账号提示，留在 `auth.ts` 给 `LoginPage` 用）。

`renderer/auth.ts` 的现有 3 个消费者，**没有一个需要修改内部实现**：

| 文件 | 用了什么 | 处置 |
|---|---|---|
| `pages/LoginPage.svelte:223` | `EXPERIENCE_PHONE` | **不动**，旧登录页自用自的 |
| `pages/ProfilePage.svelte` | `readAuthSession()` + `maskPhone(session.phone)` | **不动**，新建并列的 `StaffProfilePage.svelte` |
| `App.svelte` | `AuthSession` / `setAuthSession` / `clearAuthSession` | 改为按变体二选一（§7.3） |

### 7.2 新增页面（全部纯新增）

**`pages/StaffLoginPage.svelte`** —— 用户名 + 密码 + 提交。视觉复用 `LoginPage.svelte`
的左右分栏骨架（左侧品牌区、右侧卡片表单原样搬），去掉验证码倒计时、协议勾选、
体验账号提示三块。

**`pages/StaffProfilePage.svelte`** —— 照 `ProfilePage.svelte` 的版式，只换数据来源：

| 位置 | 旧 (`ProfilePage`) | 新 (`StaffProfilePage`) |
|---|---|---|
| 数据源 | `readAuthSession()` | `readStaffSession()` |
| 主标题 | `maskPhone(session.phone)` | `session.fullName ?? session.username` |
| 副标题 | `当前登录账号` | `当前登录账号` + 补一行 `session.username`（`fullName` 存在时才有意义） |
| 退出按钮 | `dispatchEvent('hotel-butler:logout')` | 同左，事件名与处理器都不变 |

`hotel-butler:logout` 这个自定义事件在两个变体里都用，事件名与 `AppFrame` 侧边栏都不用改。

### 7.3 门禁与路由按变体切换

`/profile` 只有一个入口（`AppFrame.svelte:102` 侧边栏链接），只能指向一个页面；
门禁位置同理。两处都用同一个常量分流，让 DCE 能摇掉未选中的那半边。

```ts
// routes.ts
import { IS_STAFF_AUTH } from './shared-auth-variant';
export const routes: RouteDefinition = {
  // …其余路由不变…
  '/profile': IS_STAFF_AUTH ? StaffProfilePage : ProfilePage,
};
```

```svelte
<!-- App.svelte —— 门禁 -->
session = IS_STAFF_AUTH
  ? await window.hotelButler.staffAuth.currentSession()
  : await window.hotelButler.auth.currentSession();
...
{:else if IS_STAFF_AUTH}
  <StaffLoginPage onLogin={login} />
{:else}
  <LoginPage onLogin={login} />
```

`App.svelte` 的 `session` 状态类型变成 `StaffSession | AuthSession | null`。
两个分支各自只碰自己那套 `set*/clear*Session`。

> **DCE 的边界要说清**：`routes.ts` 里三元表达式两边的 import 都是静态的，Rollup 只能
> 在常量折叠后摇掉未被引用的那个组件子树 —— 这对 `StaffProfilePage`/`ProfilePage`
> 这类叶子组件成立。但 `preload` 侧两个 namespace 都要挂（preload 是 IPC 白名单，
> 挂了但对端没注册 handler，调用时报错即可），所以 **preload 不做变体分流**，
> `window.hotelButler` 上 `auth` 和 `staffAuth` 两个 namespace 长期共存。
> 真正的隔离在 main：§5.7 只注册命中那套的 IPC handler。

---

## 8. 方案取舍

| 议题 | 候选 | 结论 |
|---|---|---|
| 校验放哪 | ① apps/server 读 MySQL 比 BCrypt ② apps/server 转发 rms-server ③ **desktop 直连 rms-server** | ③。用户已定。少一跳、复用 RMS 的锁定与 RBAC；代价是 desktop 需自管 token 生命周期 |
| 凭证载体 | ① 沿用 desktop_session cookie ② **RMS JWT** | ②。走 rms-server 就只有 JWT；cookie 方案要 apps/server 参与，与①矛盾 |
| token 存哪 | ① 内存 ② **safeStorage 加密文件** ③ SQLite | ②。①每次启动重登体验差；③把凭证混进业务库，清库风险 |
| 与旧 auth 关系 | ① 改造复用 ② 并列新建、运行期共存 ③ **并列新建、打包期二选一** | ③。用户定：打包读 env 只装一套。旧代码留在仓库但不进产物 |
| 变体开关载体 | ① 复用 `isFeatureOff('auth')` ② **新增 vite `define` 常量** | ②。旧开关语义是"跳过登录"且 renderer-only，管不到 main 的 IPC 注册 |
| id 类型 | ① 转 string 对齐 EmployeeIdentity ② **保持 number** | ②。rms-server JSON 里就是 number，转换只会引入不必要的映射层 |
| refresh 时机 | ① 定时后台刷 ② **按需（请求前判过期 + 401 兜底）** | ②。access 8h，桌面应用不需要后台定时器；少一个常驻定时任务 |

---

## 9. 风险与已知缺口

| 风险 | 说明 | 处置 |
|---|---|---|
| 账号锁定不可自解 | `LoginAttemptService` 的锁定标记无 TTL | 文案明确"联系管理员"；不在本次改 RMS |
| 本地 http 明文 | 开发期 JWT 走 http | `resolveRmsOrigin` 只对 loopback 放行；线上强制 https |
| safeStorage 不可用 | Linux 无 keyring 时 | 降级为不持久化（每次重登），**不明文落盘** |
| `rms_current_hotel` 未消费 | 登录带回的酒店上下文本次丢弃 | 已用独立 session 存着，接酒店上下文时原地读取 |
| 三端变体不一致 | 若 main 与 renderer 的 `__AUTH_VARIANT__` 不同，会出现"渲染新登录页、main 没注册 handler"的白屏 | 三处共用 `authVariantDefine()` 插件，取值逻辑只有一份；漏挂插件会因 `__AUTH_VARIANT__` 未定义而在构建期/启动即报错，不会静默跑歪。main 启动再打一行 `authVariant` 日志 |
| 环境变量拼错 | `XIAOZHI_AUTH_VARIANT=stff` 静默回退默认值，打出装错登录的包 | `resolveAuthVariant` 对非法值**抛错中断构建**，不做默认回退 |
| 旧链路留在仓库 | `LoginPage`/`ProfilePage`/`auth.ts`/`auth-service.ts` 等在 `phone` 变体下仍可编译 | 有意为之：保留可回退的第二个变体。待 `staff` 变体稳定后单独提 change 一次性删净 |
| 去掉 skipAuth 后本地必须起 rms-server | 开发绕过被移除 | 用户已确认。rms-server 本地 `SERVER_PORT=8080` 起一次即可 |
| 无自动化测试 | 用户已确认不写 | 交付靠 §10 真机验证 |

---

## 10. 验证方式（真机）

前置：本地起 rms-server（`SERVER_PORT=8080`），RMS MySQL 里有一个 `status=1` 的 employee。

| # | 场景 | 期望 |
|---|---|---|
| 1 | 正确用户名密码登录 | 进主界面；`staff-auth.json` 生成且内容非明文 |
| 2 | 错误密码 | 提示"用户名或密码错误"，停留登录页 |
| 3 | 连错 5 次后再用正确密码 | 提示"账号已被锁定，请联系管理员" |
| 4 | 登录后重启应用 | 免登录直接进主界面（走 store + `/me`） |
| 5 | 手改 `staff-auth.json` 里的 access 使其失效后重启 | 静默 refresh 成功，仍进主界面 |
| 6 | 连 refresh 也失效后重启 | 回登录页，`staff-auth.json` 已清 |
| 7 | 点退出登录 | 回登录页；重启不会自动登录 |
| 8 | rms-server 未启动时登录 | 提示"登录失败，请稍后重试"，不崩 |
| 9 | `XIAOZHI_AUTH_VARIANT=phone` 打一个包 | 起来是旧的手机验证码登录页，行为与本次改动前一致 |
| 10 | `staff` 包里搜产物 | `LoginPage` 的"获取验证码"文案不在打包产物中（DCE 生效） |

---

## 11. 完成门禁

本次改动触及**跨模块接口**（`packages/api/contracts.ts` 新增 schema）与**部署方式**
（新增 `XIAOZHI_RMS_SERVER_URL`、`XIAOZHI_AUTH_VARIANT` 两个环境变量，删除
`VITE_VERSION_FEATURE`）→ 按项目规约需同步 `openspec/specs/` 对应 capability。
新建 `openspec/specs/staff-password-auth/spec.md`，记录：接口契约（§3）、
token 存储与加密约束（§5.4）、origin 协议约束（§5.2）、构建变体约定（§7.0）。
