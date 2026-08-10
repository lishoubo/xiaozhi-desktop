# 员工用户名/密码登录（staffAuth）

桌面端**直连 rms-server** 的登录体系，与手机验证码登录（经 `apps/server`）并列，
由构建变体决定单个安装包里装哪一套。

## 边界

| 项 | 事实 |
|---|---|
| 密码校验方 | rms-server，desktop 不接触 BCrypt |
| 凭证 | RMS 签发的 JWT（access 8h / refresh 7d），只在 main 进程持有 |
| 不经过 | `apps/server`（无 tRPC procedure 参与） |
| 酒店上下文 | 登录响应带 `rms_current_hotel` cookie，**本期不消费** |

## 接口契约（rms-server）

响应统一包在 `ApiResponse<T>`：`{ code, message, data }`，`code === 0` 为成功。
HTTP 状态码可能同时为非 200，两者都要处理。

| 方法 | 路径 | 鉴权 | data |
|---|---|---|---|
| POST | `/api/v1/auth/login` | 免 | `TokenResponse` |
| POST | `/api/v1/auth/refresh` | 免 | `TokenResponse` |
| GET | `/api/v1/me` | Bearer | `MeResponse` |
| POST | `/api/v1/auth/logout` | Bearer | `null` |

```ts
type TokenResponse = {
  accessToken: string; refreshToken: string;
  accessExpiresInSeconds: number; refreshExpiresInSeconds: number;
};

type MeResponse = {           // = staffIdentitySchema（packages/api/src/contracts.ts）
  userId: number; username: string; fullName: string | null;
  role: string; orgId: number;
  currentHotelId: number | null;
  accessibleHotelIds: number[]; permissions: string[];
};
```

**id 类必须是 `number`**：rms-server 用 Jackson 序列化 `Long`。不要复用
`employeeIdentitySchema` 的 `string` 写法——那一套描述的是 `apps/server` 经 mysql2
（`bigNumberStrings: true`）读出的行，两者字段名与类型都不同，刻意不共用。

### 错误码 → 文案

| code | 文案 |
|---|---|
| 11002 | 用户名或密码错误 |
| 11003 | 账号已被锁定，请联系管理员 |
| 11004 / 11005 | （内部信号，触发 refresh，不外抛） |
| 11006 / 10002 | 登录已过期，请重新登录 |
| 10001 | 请检查用户名和密码 |
| 其他 / 传输失败 | 登录失败，请稍后重试 |

**11003 不得写"稍后再试"**：RMS 的 `LoginAttemptService` 锁定标记无 TTL、不会自动
解锁（见 `RmsSecurityProperties.Lockout`），只能由管理员处理。

错误文案**必须按码区分**，不得像旧 `AuthService.safeCall` 那样压成同一句——
"密码错误"和"账号锁定"对用户是不同的行动指引。

## 约束

### origin 协议

`resolveRmsOrigin`（`main/staff-auth/rms-endpoint.ts`）：
- 默认 `http://localhost:8080`，env 覆盖键 `XIAOZHI_RMS_SERVER_URL`
- **loopback（localhost / 127.0.0.1）允许 http；其余一律要求 https**，否则抛错

不复用 `server-client/config.ts` 的 `resolveServerOrigin`——那个强制 https，
而 rms-server 本地无 TLS。

### 凭证存储

`main/staff-auth/token-store.ts` → `<userData>/staff-auth.json`

- 内容经 `safeStorage.encryptString` 加密后写盘
- **safeStorage 不可用时不降级为明文**：`write` 跳过、`read` 返回 null
  （后果仅为重新登录；明文落盘不可接受）
- 解密失败或结构不符 → 删文件并当作未登录，不让坏数据每次启动都炸一次
- **token 不得跨 IPC 边界**，renderer 只拿身份对象

### 会话恢复

access 过期判断预留 30s 余量。仅当 RMS 返回 11004/11005 才刷新——网络故障不得
被误判成"登录失效"而清掉凭证。refresh 用模块内 in-flight promise 去重。
`logout` 的本地清理放 `finally`，远端失败也要清。

## 构建变体

单个包只装一套登录，由环境变量在**构建期**决定：

```
XIAOZHI_AUTH_VARIANT = 'staff' | 'phone'      缺省 staff
```

- 唯一事实来源：`apps/desktop/vite-plugins/auth-variant.ts`
- 三处构建（main / preload / renderer）各挂一次 `authVariantDefine()` 插件
  —— 它们是三次独立的 Rollup 构建，`define` 无法跨构建共享
- 注入编译期常量 `__AUTH_VARIANT__`，经 `src/shared/auth-variant.ts` 收口为
  `AUTH_VARIANT` / `IS_STAFF_AUTH`
- **非法取值抛错中断构建**，不做默认回退（静默回退会打出装错登录的包）

用 `define` 而非 `import.meta.env`：前者是字面量替换，分支条件被折叠成常量后
Rollup 才能把未选中那套连同 import 一起摇掉。已验证两个变体在 main 与 renderer
产物中互不残留。

`preload` **不做变体分流**：它是 IPC 白名单，`auth` 与 `staffAuth` 两个 namespace
长期共存；挂上不代表对端注册了 handler。真正的隔离在 `composition/window-scope.ts`
——只注册命中变体的那套，未命中的连 session 都不创建。

## 分层归属

| 层 | 文件 | 职责 |
|---|---|---|
| 基础设施 | `main/staff-auth/rms-auth-client.ts` | HTTP + 拆 `ApiResponse` + 转 `RmsAuthError` |
| | `main/staff-auth/token-store.ts` | 加密持久化 |
| | `main/staff-auth/rms-endpoint.ts` | origin 解析 |
| | `main/staff-auth/rms-auth-errors.ts` | 错误码与文案 |
| 编排 | `main/services/staff-auth-service.ts` | 登录/恢复/刷新/登出的顺序与半截状态 |
| 边界 | `main/ipc/staff-auth-handlers.ts` | 声明端口、校验入参、调一个 service |
| 装配 | `main/composition/window-scope.ts` | 按变体二选一 |

日志只记操作名与 `rmsCode`；用户名、密码、token 一律不得出现
（`shared/logging.ts` 另有兜底脱敏）。
