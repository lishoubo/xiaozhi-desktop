# 短信登录接入设计

## 决策

### D1：运行时切换 vs 编译期变体

服务端对接文档推荐「改造 `phone` 变体语义」（编译期二选一），但那是在不知道产品诉求的前提下写的。产品要求同一个包同时服务两类用户，编译期方案做不到。

| 方案 | 一个包支持两类用户 | 代价 | 结论 |
|---|---|---|---|
| A. 改造 `phone` 变体语义 | ✗ | — | 否决：与需求直接冲突 |
| B. 新增第三个变体 `staff-phone` | ✗ | 三套并存 | 否决：同上，且更复杂 |
| C. staff 变体内运行时两个 Tab | ✓ | 两套登录 UI 都进产物 | **采纳** |

文档给 C 标的缺点是「破坏『编译期常量让 Rollup 摇掉未选中分支』的现有设计」。这一条在本次不成立：

```
__AUTH_VARIANT__ 真正摇掉的是 ↓ 这一整套（保持不变）
  auth IPC 通道 + AuthService + server-client tRPC + LoginPage.svelte

本次新增的短信登录在 staff 侧 ↓（与密码登录共用）
  staffAuth 通道 + StaffAuthService + 整个 token 栈
  增量 = 2 个 client 方法 + 1 个表单组件
```

DCE 的收益对象原样保留，新增量只有几 KB。**`XIAOZHI_AUTH_VARIANT` 语义不变，vite 插件、`shared/auth-variant.ts`、`window-scope.ts` 的分支全部不动。**

### D2：不复用 `LoginPage.svelte`

旧手机号登录走 `auth` 通道 → `AuthService` → `apps/server` tRPC → mysql2 读 RMS 库，返回 `EmployeeIdentity`（`id: string`）。新的走 `staffAuth` → RMS HTTP，返回 `StaffIdentity`（`userId: number`）。两条链路的通道、服务、契约类型全不同，复用只能复用到 UI 骨架，而 UI 骨架恰好是要重做的部分（要加类型切换、要拆两个倒计时、要透传错误文案）。

旧 `phone` 变体原样保留，不删不改。

### D3：`userType` 只存不用

契约必须加（`strictObject` 严格校验，服务端已在返回，不加则 `/api/v1/me` 解析直接失败）。但本期不据它做界面分流——两类用户登录后界面无差异。将来要分流时按 `userType` 而非 `role`：`HOTEL_STAFF` 在服务商侧也在用。

## 数据流

```
                    ┌─────────────── StaffLoginPage.svelte ───────────────┐
                    │  用户类型切换（$state，纯本地）                        │
                    │    酒店用户(默认) ──┐            ┌── 服务商用户        │
                    └────────────────────│────────────│───────────────────┘
                                         │            │
  preload/namespaces/staff-auth.ts       ▼            ▼
    requestPhoneCode ─┐         loginWithPhoneCode   login（现有，零改动）
                      │                  │            │
  ipc/staff-auth-handlers.ts             │            │
    校验 phoneNumberSchema/phoneCodeSchema，调恰好一个 service
                      │                  │            │
  services/staff-auth-service.ts         ▼            ▼
    requestPhoneCode        loginWithPhoneCode      login
      （直通，无编排）          └──── 同一段编排 ────┘
                                         │
                                  ┌──────▼──────────────────────┐
                                  │ tokens.adopt(pair)          │
                                  │ client.me() 取身份           │
                                  │ 失败 → tokens.clear()        │
                                  └──────┬──────────────────────┘
                                         │
  staff-auth/rms-auth-client.ts          ▼
    call() ── ASCII UA + X-App-Version + X-Device-Id ──→ rms-server
```

登录成功后回到既有路径：`App.svelte` 的 `loginWithStaff` 收 `StaffIdentity`，两条路产出同一形状，**`App.svelte` 无需改动**。

## 契约改动（`packages/api/src/contracts.ts`）

⚠️ 两个 schema 都是 `z.strictObject`，服务端多返回一个字段就抛校验异常，不是忽略。不改则登录直接失败。

```ts
export const staffIdentitySchema = z.strictObject({
  userId: z.number().int().positive(),
  username: z.string().min(1),
  phone: z.string().nullable(),        // ← 新增：服务商员工可为 null
  userType: z.string().min(1),         // ← 新增：'STAFF' | 'HOTEL'，本期只存不用
  fullName: z.string().nullable(),
  role: z.string().min(1),
  orgId: z.number().int().positive(),
  currentHotelId: z.number().int().positive().nullable(),
  accessibleHotelIds: z.array(z.number().int().positive()),
  permissions: z.array(z.string()),
});

// 新增独立 schema，不改动旧的 phoneCodeRequestResponseSchema
export const staffPhoneCodeRequestResponseSchema = z.strictObject({
  accepted: z.literal(true),
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().positive(),
});
```

**为什么新建 schema 而不是给 `phoneCodeRequestResponseSchema` 加字段**（对接文档建议的做法）：该 schema 是旧 `phone` 变体在用的，其生产方 `packages/api/src/router.ts:351` 只返回 `{ accepted, expiresInSeconds }`。它是 `strictObject`，直接加一个必填 `resendAfterSeconds` 会让旧变体的发码解析当场失败。

| 方案 | 结论 |
|---|---|
| 给旧 schema 加必填字段 | 否决：打破旧 `phone` 变体 |
| 给旧 schema 加 optional 字段 | 否决：两条链路的契约差异被抹平，短信侧丢失「必有此字段」的保证 |
| **新建 `staffPhoneCodeRequestResponseSchema`** | **采纳**：与 `staffIdentitySchema` / `employeeIdentitySchema` 刻意不共用是同一个理由——两条链路的响应本就不同形状 |

`phoneNumberSchema`（`^1\d{10}$`）、`phoneCodeSchema`（`^\d{6}$`）现成可用。

## main 侧改动

### 接口契约（`rms-auth-client.ts`）

```ts
export interface RmsAuthClient {
  login(username: string, password: string): Promise<RmsTokenPair>;
  requestPhoneCode(phone: string): Promise<PhoneCodeRequestResponse>;   // 新增
  loginWithPhoneCode(phone: string, code: string): Promise<RmsTokenPair>; // 新增
  refresh(refreshToken: string): Promise<RmsTokenPair>;
  me(accessToken: string): Promise<StaffIdentity>;
  logout(accessToken: string): Promise<void>;
}
```

⚠️ **必须走现成的 `call()`，不要另起 fetch。** `RMS_USER_AGENT` 是 ASCII UA —— Electron 默认 UA 带中文应用名「小智酒店管家」，会被 rms-server 的 `StrictHttpFirewall` 在进 controller 前拒掉，表现为「验证码正确却返回 INTERNAL_ERROR(10000)」。这个坑密码登录已经踩过并修好了。

发码响应需要新增一个 `requirePhoneCodeResponse()` 守卫（对应现有的 `requireTokenPair()`），用 `staffPhoneCodeRequestResponseSchema` 校验。

### 两个新请求头

在 `call()` 的 `headers` 里统一加，覆盖所有认证请求（含 login/refresh/me/logout），不只是短信接口：

```ts
const headers: Record<string, string> = {
  accept: 'application/json',
  'user-agent': RMS_USER_AGENT,
  'x-app-version': deps.appVersion,
  'x-device-id': deps.deviceId,
};
```

两者作为 `RmsAuthClientDependencies` 的字段注入 —— client 层不 import `electron`，也不碰文件系统。

### device id 持久化

新增 `main/file-store/device-id.ts`（与 `partition-ledger.ts` 同目录同介质，明文 JSON）：

```ts
/** `<userData>/device-id.json`；不含用户身份信息，明文即可，不进 safeStorage。 */
export function readOrCreateDeviceId(userDataDir: string, logger: AppLogger): Promise<string>
```

| 决策点 | 选择 | 理由 |
|---|---|---|
| 存储介质 | `<userData>/device-id.json` 明文 | 非凭证、非身份信息；不值得 safeStorage 的不可用降级复杂度 |
| 不进 SQLite | 同 token-store 的理由 | 「清空业务库」不应牵连设备标识 |
| 读写失败 | 返回一次性随机 uuid，记 warn，不抛 | 这两个头不带也能登录，不得因它阻断登录 |
| 生成方式 | `node:crypto` 的 `randomUUID()` | 已在 `rms-auth-client.ts` 使用 |

注入方式：`deviceId` 作为 `() => Promise<string>` 而非值传入 —— `createAppScope` 是同步函数，
其调用链（`index.ts` 的 `initializeApplication`）也是同步的。为一个"不带也能登录"的头把整条
启动路径改成异步不划算，所以做成惰性 + 记忆化：装配层持有 promise 缓存，首次请求时才读盘，
之后所有并发请求共用同一个 promise。`appVersion` 直接取 `app.getVersion()`（`main/index.ts:39` 已在用）。

### service 编排（`staff-auth-service.ts`）

```ts
async requestPhoneCode(phone: string): Promise<PhoneCodeRequestResponse> {
  return this.translate('request-phone-code', '验证码发送失败，请稍后再试',
    () => this.deps.client.requestPhoneCode(phone));
}

async loginWithPhoneCode(phone: string, code: string): Promise<StaffIdentity> {
  const pair = await this.translate('login-phone', '登录失败，请稍后重试',
    () => this.deps.client.loginWithPhoneCode(phone, code));
  await this.deps.tokens.adopt(pair);
  try {
    return await this.deps.client.me(pair.accessToken);
  } catch (error) {
    await this.deps.tokens.clear();   // 不留「有凭证无身份」的半截状态
    throw this.toUserFacingError('login-phone-profile', '登录失败，请稍后重试', error);
  }
}
```

`currentSession()` / `logout()` **不动** —— 两种登录产出同一形状的 token 对，恢复与登出路径天然共用。

### 错误码（`rms-auth-errors.ts`）

```ts
export const RMS_ERROR = {
  // …现有 7 个不变…
  phoneCodeSendTooFrequent: 11009,
  phoneCodeInvalid: 11010,
  phoneCodeAttemptsExceeded: 11011,
  phoneNumberUnavailable: 11012,
  phoneCodeSendFailed: 11013,
} as const;
```

`messageForRmsError` 加 5 个分支：

| code | 文案 |
|---|---|
| 11009 | 发送太频繁了，请 60 秒后再试 |
| 11010 | 验证码错误或已过期 |
| 11011 | 错误次数过多，请 15 分钟后再试 |
| 11012 | 该手机号不可用，请联系管理员 |
| 11013 | 验证码发送失败，请稍后再试 |

⚠️ 11011 的锁定 **15 分钟自动解除**，文案必须写时长。这与 11003（密码登录账号锁定，无 TTL、需管理员）是不同的行动指引，两者文案不得互抄。

`isAccessTokenRejected` 不动 —— 这几个码都不是 access token 失效信号。

### IPC 边界

```ts
// shared/ipc-channels.ts
staffAuth: {
  currentSession: 'staff-auth:current-session',
  login: 'staff-auth:login',
  logout: 'staff-auth:logout',
  requestPhoneCode: 'staff-auth:request-phone-code',      // 新增
  loginWithPhoneCode: 'staff-auth:login-with-phone-code', // 新增
},
```

handler 入参校验直接复用现成的 `phoneNumberSchema` / `phoneCodeSchema`。`StaffAuthOrchestrator` 接口同步加两个方法。

**为什么不复用现有 `auth` 通道**：`auth` 绑定 `EmployeeIdentity`（`id: string`，来自 apps/server 经 mysql2 读出的行），`staffAuth` 绑定 `StaffIdentity`（`userId: number`，Jackson 序列化的 Long）。字段名和类型都不同，`contracts.ts:28-34` 有注释明确「刻意不共用」。

## UI（`StaffLoginPage.svelte`）

左侧品牌区不动。右侧表单区加类型切换，两套表单条件渲染：

```
┌─ 右侧表单卡片 ────────────────────────────────┐
│                          ┌──────────────────┐│  ← 右上角切换
│                          │ 酒店用户 │服务商用户 ││
│                          └──────────────────┘│
│                                              │
│  ┌ 酒店用户 ────────┐   ┌ 服务商用户 ───────┐ │
│  │ 手机号           │   │ 用户名           │ │
│  │ 验证码 [获取(60s)]│   │ 密码             │ │
│  │ [ 登录 ]         │   │ [ 登录 ]         │ │
│  └──────────────────┘   └──────────────────┘ │
└──────────────────────────────────────────────┘
```

```ts
let userType = $state<'hotel' | 'staff'>('hotel');   // 默认酒店用户

// 两个倒计时，不得混用（旧 LoginPage 只有一个 codeExpiresAt，是要修的点）
let resendAvailableAt = $state(0);   // ← resendAfterSeconds (60s)：控按钮
let codeExpiresAt = $state(0);       // ← expiresInSeconds  (300s)：控验证码有效性
```

| 位置 | 与旧 `LoginPage.svelte` 的差异 |
|---|---|
| 通道 | `staffAuth.*` 而非 `auth.*` |
| 类型 | `StaffIdentity` 而非 `EmployeeIdentity` |
| 倒计时 | 拆成两个值 |
| 错误 | 透传 main 的可读文案（照现有 `StaffLoginPage.svelte:27-30`），不 `catch {}` 吞掉 |
| 协议勾选 | 沿用旧页的用户协议/隐私政策勾选 |

切换类型只改 `$state`，不发请求、不碰已保存的登录态。

`App.svelte`、`routes.ts`、`StaffProfilePage.svelte` **均不改** —— 两条路都产出 `StaffIdentity`。

## 零改动清单

| 文件 | 提供的能力 |
|---|---|
| `staff-auth/token-store.ts` | safeStorage 加密落盘 |
| `staff-auth/rms-token-provider.ts` | 过期预留 30s + 按 refresh token 键控的并发去重 |
| `staff-auth/authenticated-rms-fetch.ts` | Bearer 注入 + 401 自动刷新重试一次 |
| `staff-auth/rms-endpoint.ts`、`rms-http-logging.ts` | origin 解析、日志脱敏 |
| `main/gateway/rms/**` | 全部业务 gateway |
| `renderer/App.svelte`、`routes.ts` | 会话出口与路由 |
| `vite-plugins/auth-variant.ts`、`shared/auth-variant.ts`、`window-scope.ts` 变体分支 | 构建变体机制 |

前提是短信登录返回同形状的 `TokenResponse` —— 服务端已按此契约设计。

## 风险

| 风险 | 处置 |
|---|---|
| ~~给 `phoneCodeRequestResponseSchema` 加必填字段会打破旧 `phone` 变体~~ | 已确认成立（`router.ts:351` 只返回两个字段），已改为新建独立 schema 规避，见「契约改动」 |
| 联调手机号需先在阿里云控制台绑定（每账号限 5 个） | 已绑定 `136****4089`；用未绑定号码发送会失败 |
| 60s 发送间隔由阿里云侧执行 | 客户端倒计时只是 UI 提示，绕过倒计时直接调接口仍会被拒 |
| 套餐包余量耗尽导致发送失败（11013） | 联调前确认余量 |
