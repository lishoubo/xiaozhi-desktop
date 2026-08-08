# tasks — 员工用户名/密码登录（staffAuth）

依赖顺序：1 → 2 → 3 → 4 → 5 → 6 → 7。
1～3 之间无共享文件，可并行；4 起必须串行（都改 `composition/window-scope.ts` 与 `App.svelte`）。

按用户决定：**不写单元测试**，交付靠 §7 真机验证。

---

## 1. 契约（`packages/api`）

- [x] 1.1 `src/contracts.ts` 追加 `staffUsernameSchema`(1..64) / `staffPasswordSchema`(6..128)
- [x] 1.2 `src/contracts.ts` 追加 `staffIdentitySchema` + `StaffIdentity` 类型
      —— 字段严格对齐 rms-server `MeResponse`：`userId/username/fullName/role/orgId/currentHotelId/accessibleHotelIds/permissions`
      —— id 类**用 `z.number()`**（Jackson 序列化 Long 就是 number），不复用 `employeeIdentitySchema` 的 string 写法
- [x] 1.3 `src/contracts.ts` 追加 `staffLogoutResponseSchema`
- [x] 1.4 `src/router.ts` 顶部 re-export 上述符号（与现有 export 块同构）
      —— **不新增任何 tRPC procedure**，本次不经过 apps/server
- [x] 1.5 `npm run check --workspace @hotel-butler/api`（或等价类型检查）通过

## 2. 构建变体开关（`apps/desktop`）

- [x] 2.1 新建 `vite-plugins/auth-variant.ts`：`resolveAuthVariant()` + `authVariantDefine()`
      —— 非法值**抛错中断构建**，不做默认回退；缺省 `'staff'`
- [x] 2.2 `tsconfig.node.json` 的 `include` 补 `"vite-plugins/**/*.ts"`
      —— 否则该文件不被 `check:types` 覆盖（`build` 这个名字在 tsconfig `exclude` 里，故不用它）
- [x] 2.3 `forge.env.d.ts` 追加 `declare const __AUTH_VARIANT__: 'staff' | 'phone';`
- [x] 2.4 三处 vite config 各加 `plugins: [authVariantDefine(), …]`
      —— `vite.main.config.ts` / `vite.preload.config.ts` 目前无 `plugins` 字段，新增；
         `vite.renderer.config.mts` 已有数组，插到最前
- [x] 2.5 新建 `src/shared/auth-variant.ts`：`export const AUTH_VARIANT = __AUTH_VARIANT__` + `IS_STAFF_AUTH`
- [x] 2.6 验证：`check:types` 通过；两个变体的 main/renderer 构建均成功且互不残留；
      非法值 `stff` 如期中断构建。**`npm run dev` 未跑**（需起 rms-server，留到 §7 真机）

## 3. main —— RMS 认证基础设施（`apps/desktop/src/main/staff-auth/`）

- [x] 3.1 `rms-endpoint.ts`：`resolveRmsOrigin(env)`，默认 `http://localhost:8080`
      —— loopback 放行 http，非 loopback 强制 https；**不复用** `server-client/config.ts`（它硬性要求 https）
- [x] 3.2 `rms-auth-errors.ts`：`RmsAuthError(code, message)` + 错误码→中文文案表
      —— 覆盖 11002 / 11003 / 11004 / 11005 / 11006 / 10002 / 10001 + 兜底
      —— 11003 文案必须是"账号已被锁定，请联系管理员"（RMS 锁定标记无 TTL，不会自解）
- [x] 3.3 `rms-auth-client.ts`：`login` / `refresh` / `me` / `logout` 四个方法
      —— 统一拆 `ApiResponse<T>`：`code !== 0` 抛 `RmsAuthError`；非 `ApiResponse` 形状的 HTTP 错误也转成它
      —— **日志不得出现** username / password / accessToken / refreshToken，只记操作名与 rms code
- [x] 3.4 `token-store.ts`：`read` / `write` / `clear`，落 `userData/staff-auth.json`
      —— `safeStorage.encryptString` 加密后 base64 落盘
      —— safeStorage 不可用时：`write` 静默跳过、`read` 返回 null，**绝不明文落盘**
- [x] 3.5 `browser/session-factory.ts` 加 `sessionForRmsApi()`，partition `'persist:xiaozhi:rms-api'`

## 4. main —— 编排与 IPC

- [x] 4.1 `services/staff-auth-service.ts`：`login` / `currentSession` / `logout`
      —— `login`：拿 token → 写 store → 调 `me()`；`me` 失败要清 store 再抛，不留半截状态
      —— `currentSession`：按 design §5.5 流程图（access 过期或 11004/11005 → refresh → 再 me；refresh 失败 → clear → null）
      —— access 过期判断预留 `30_000ms` 余量
      —— 用模块内 `inFlightRefresh` 去重并发刷新
      —— `logout`：远端调用放 `try`，`clear()` 放 `finally`
- [x] 4.2 `shared/ipc-channels.ts` 追加 `staffAuth: { currentSession, login, logout }`
- [x] 4.3 `ipc/staff-auth-handlers.ts`：照 `auth-handlers.ts` 写
      —— 声明 `StaffAuthOrchestrator` 端口接口，不 import 实现类
      —— `login` 入参 `z.tuple([staffUsernameSchema, staffPasswordSchema])`
- [x] 4.4 `preload/namespaces/staff-auth.ts`：用 `staffIdentitySchema` / `staffLogoutResponseSchema` 校验返回值
- [x] 4.5 preload 入口挂上 `staffAuth` namespace
      —— **两个 namespace 长期共存**，preload 不做变体分流（IPC 白名单性质）
- [x] 4.6 `composition/window-scope.ts` 按 `IS_STAFF_AUTH` 二选一装配
      —— `staff` 分支：`new StaffAuthService(...)` + `registerStaffAuthHandlers`
      —— `phone` 分支：现有 `registerAuthHandlers(...)` 整块原样搬进 else，**内容不改**
      —— 未命中的分支连 session 都不创建
- [x] 4.7 main 启动时打一行 `authVariant` 日志（便于排查三端不一致）

## 5. renderer

- [x] 5.1 新建 `renderer/staff-auth.ts`：`StaffSession` 类型 + `set/read/clearStaffSession`
      —— 不含 `maskPhone`（`MeResponse` 无 phone 字段）、不含 `EXPERIENCE_PHONE`
      —— **`renderer/auth.ts` 一行不动**
- [x] 5.2 新建 `pages/StaffLoginPage.svelte`：用户名 + 密码 + 提交
      —— 复用 `LoginPage.svelte` 左右分栏骨架；去掉验证码倒计时、协议勾选、体验账号提示
      —— 错误文案直接展示 service 给的字符串，不在页面里二次判断错误类型
- [x] 5.3 新建 `pages/StaffProfilePage.svelte`
      —— 版式照 `ProfilePage.svelte`；主标题 `fullName ?? username`；退出仍派发 `hotel-butler:logout`
      —— **`pages/ProfilePage.svelte` 一行不动**
- [x] 5.4 `routes.ts`：`'/profile': IS_STAFF_AUTH ? StaffProfilePage : ProfilePage`
- [x] 5.5 `App.svelte` 门禁按 `IS_STAFF_AUTH` 分流（`currentSession` / `logout` / 登录页组件三处）
      —— `session` 状态类型放宽为 `StaffSession | AuthSession | null`
- [x] 5.6 删除开发绕过：`App.svelte` 的 `skipAuth` / `DEV_BYPASS_SESSION` 分支
- [x] 5.7 删除 `renderer/version-features.ts`（删掉 5.6 后已无使用点）
- [x] 5.8 删除 `.env.local` 里的 `VITE_VERSION_FEATURE` 行

## 6. 质量门禁

- [x] 6.1 `npm run check`（types + svelte-check）通过
- [x] 6.2 `npm run lint` 通过 —— 重点确认 `ipc/staff-auth-handlers.ts` 没踩 `no-restricted-imports`
      （ipc 层禁止 import electron / 直连 `server-client`、基础设施）
- [x] 6.3 跑一次现有单测套件，确认无回归（本次不新增测试）

## 7. 真机验证（记录到 `verification.md`）

前置：本地起 rms-server（`SERVER_PORT=8080`），RMS MySQL 有一个 `status=1` 的 employee。

- [ ] 7.1 正确用户名密码登录 → 进主界面；`staff-auth.json` 生成且内容非明文
- [ ] 7.2 错误密码 → "用户名或密码错误"，停留登录页
- [ ] 7.3 连错 5 次后用正确密码 → "账号已被锁定，请联系管理员"
- [ ] 7.4 登录后重启应用 → 免登录直接进主界面
- [ ] 7.5 手改 `staff-auth.json` 令 access 失效后重启 → 静默 refresh 成功，仍进主界面
- [ ] 7.6 令 refresh 也失效后重启 → 回登录页，`staff-auth.json` 已清
- [ ] 7.7 点退出登录 → 回登录页；重启不会自动登录
- [ ] 7.8 rms-server 未启动时登录 → "登录失败，请稍后重试"，不崩
- [ ] 7.9 `XIAOZHI_AUTH_VARIANT=phone npm run make` → 起来是旧手机验证码登录页，行为与改动前一致
- [x] 7.10 DCE 已验证（构建产物 grep，四个方向都对）：
      —— staff renderer：无"获取验证码"，有"忘记密码请联系管理员"
      —— phone renderer：反之
      —— staff main：无 `auth:login-with-phone-code`，有 `staff-auth:login`
      —— phone main：反之；且 `__AUTH_VARIANT__` 无残留（已被字面量替换）

## 8. 规范同步（完成门禁要求）

本次触及跨模块接口（`packages/api` 新增 schema）与部署方式（新增两个环境变量、删除 `VITE_VERSION_FEATURE`）。

- [x] 8.1 新建 `openspec/specs/staff-password-auth/spec.md`
      —— 记录：rms-server 接口契约（design §3）、token 存储与加密约束（§5.4）、
         origin 协议约束（§5.2）、构建变体约定（§7.0）
- [x] 8.2 单文件 125 行，符合 ≤ 200 行约束
