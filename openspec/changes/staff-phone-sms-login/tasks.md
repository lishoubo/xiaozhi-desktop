## 1. 契约（`packages/api/src/contracts.ts`）

- [x] 1.1 `staffIdentitySchema` 增加 `phone: z.string().nullable()` 与 `userType: z.string().min(1)`，注释说明 `userType` 本期只存不用、将来分流按它而非 `role`
- [x] 1.2 新增 `staffPhoneCodeRequestResponseSchema`（`accepted` / `expiresInSeconds` / `resendAfterSeconds`），注释说明为何不复用 `phoneCodeRequestResponseSchema`（旧 `phone` 变体的 `router.ts:351` 只返回两个字段）
- [x] 1.3 导出对应类型；确认旧 `phoneCodeRequestResponseSchema` 未被改动

## 2. device id 持久化

- [x] 2.1 新建 `main/file-store/device-id.ts`：`readOrCreateDeviceId(userDataDir, logger)`，`<userData>/device-id.json` 明文存储，`randomUUID()` 生成
- [x] 2.2 读写失败时返回一次性随机 uuid 并记 warn，不抛错——两个头不带也能登录，不得阻断登录流程
- [x] 2.3 单测：首次调用生成并落盘；二次调用返回同一值；文件损坏/不可写时不抛错

## 3. 认证客户端（`main/staff-auth/rms-auth-client.ts`）

- [x] 3.1 `RmsAuthClientDependencies` 增加 `appVersion` / `deviceId` 两个字段
- [x] 3.2 `call()` 的 headers 统一加 `x-app-version` / `x-device-id`，覆盖全部认证请求（login/refresh/me/logout 一并带上）
- [x] 3.3 新增 `requirePhoneCodeResponse()` 守卫，用 `staffPhoneCodeRequestResponseSchema` 校验发码响应
- [x] 3.4 实现 `requestPhoneCode(phone)` → `POST /api/v1/auth/sms/request-code`，走现成 `call()`，**不另起 fetch**（ASCII UA 约束）
- [x] 3.5 实现 `loginWithPhoneCode(phone, code)` → `POST /api/v1/auth/sms/login`，复用 `requireTokenPair()`
- [x] 3.6 单测：两个新方法的成功路径、错误码透出路径、两个新头确实出现在请求中

## 4. 错误码（`main/staff-auth/rms-auth-errors.ts`）

- [x] 4.1 `RMS_ERROR` 增加 11009 / 11010 / 11011 / 11012 / 11013
- [x] 4.2 `messageForRmsError` 加 5 个分支，文案按 design 表；11011 必须写明「15 分钟」自动解除，不得与 11003（无 TTL、需管理员）互抄
- [x] 4.3 确认 `isAccessTokenRejected` 未被改动——这几个码都不是 access token 失效信号
- [x] 4.4 单测：5 个新码各自映射到预期文案，且与密码登录的文案互不串扰

## 5. Service 编排（`main/services/staff-auth-service.ts`）

- [x] 5.1 `requestPhoneCode(phone)`：直通 client，用 `translate()` 转错误，fallback 文案「验证码发送失败，请稍后再试」
- [x] 5.2 `loginWithPhoneCode(phone, code)`：换 token → `tokens.adopt(pair)` → `client.me()`，**取身份失败必须 `tokens.clear()`**
- [x] 5.3 确认 `currentSession()` / `logout()` 未被改动
- [x] 5.4 单测：登录成功路径；取身份失败时凭证被清除（不留「有凭证无身份」半截状态）

## 6. IPC 与 preload

- [x] 6.1 `shared/ipc-channels.ts` 的 `staffAuth` 增加 `requestPhoneCode` / `loginWithPhoneCode` 两个通道
- [x] 6.2 `main/ipc/staff-auth-handlers.ts`：`StaffAuthOrchestrator` 接口加两个方法；注册两个 handler，入参复用 `phoneNumberSchema` / `phoneCodeSchema`
- [x] 6.3 `preload/namespaces/staff-auth.ts` 暴露两个方法，出参分别用 `staffPhoneCodeRequestResponseSchema` / `staffIdentitySchema` 校验
- [x] 6.4 确认 token 未跨 IPC 边界——renderer 只拿身份对象与发码响应

## 7. 装配（`main/composition/app-scope.ts`）

- [x] 7.1 装配时 `await readOrCreateDeviceId(userDataDir, logger)` 读取一次
- [x] 7.2 将 `deviceId` 与 `app.getVersion()` 注入 `createRmsAuthClient`
- [x] 7.3 确认认证栈装配结构与 `window-scope.ts` 的变体分支均未改动

## 8. UI（`renderer/pages/StaffLoginPage.svelte`）

- [x] 8.1 加 `userType = $state<'hotel' | 'staff'>('hotel')`，右上角切换控件，默认「酒店用户」
- [x] 8.2 保留现有用户名/密码表单为「服务商用户」分支，逻辑不改
- [x] 8.3 新增「酒店用户」手机号+验证码表单（不从 `LoginPage.svelte` 拷贝，按 `staffAuth` 链路新写）
- [x] 8.4 两个倒计时分开：`resendAvailableAt`（`resendAfterSeconds`，控按钮禁用）与 `codeExpiresAt`（`expiresInSeconds`，控验证码有效性），**不得混用**
- [x] 8.5 错误处理透传 main 的可读文案（照现有 `:27-30`），**不得 `catch {}` 吞掉**
- [x] 8.6 本地校验：手机号 `^1\d{10}$`、验证码 `^\d{6}$` 在发请求前拦截
- [x] 8.7 沿用用户协议/隐私政策勾选
- [x] 8.8 切换用户类型只改 `$state`：不发请求、不清登录态
- [x] 8.9 确认 `App.svelte` / `routes.ts` / `StaffProfilePage.svelte` 均无需改动

## 9. 验证

- [x] 9.1 跑受影响模块的单测（contracts、staff-auth、services、ipc、file-store）
- [x] 9.2 `npm run lint` 与类型检查通过，确认分层边界未被破坏（client 层未 import `electron`）
- [x] 9.3 构建两个变体各一次，确认 `phone` 变体产物不受影响、`staff` 变体产物包含两套登录 UI
- [ ] 9.4 真机验证（需联调环境）：酒店用户手机号登录全流程、60s 重发倒计时、300s 验证码过期、错误码文案区分度、服务商用户密码登录回归、重启后会话恢复、登出
- [ ] 9.5 抓包确认 `X-App-Version` / `X-Device-Id` 已带上，且 device id 跨重启稳定
- [x] 9.6 记录验证证据到 `openspec/changes/staff-phone-sms-login/verification.md`

## 10. 规范同步

- [ ] 10.1 本次改动触及跨模块接口（IPC 通道、契约），验收后将 delta 合并进 `openspec/specs/staff-password-auth/spec.md`
- [ ] 10.2 同步更新该 spec 中「构建变体」一节——`XIAOZHI_AUTH_VARIANT` 不再决定登录方式，只决定装哪套认证体系
