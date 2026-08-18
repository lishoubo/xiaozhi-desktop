# 验证证据

日期：2026-08-18　平台：darwin arm64

## 自动化验证（已完成）

### 类型与静态检查

| 命令 | 结果 |
|---|---|
| `npm run check:desktop`（tsc + svelte-check） | ✅ `COMPLETED 1252 FILES 0 ERRORS 0 WARNINGS` |
| `npm run lint:desktop` | ✅ 无输出（通过） |
| `npm run check:api` / `npm run lint:api` | ✅ 通过 |

分层边界：`rms-auth-client.ts` 未 import `electron`；device id 读盘收在 `main/file-store/`，
经装配层以 `() => Promise<string>` 注入，client 层不碰文件系统。

### 单元测试

本次新增 3 个测试文件、扩充 2 个既有文件，共 39 个用例，全部通过：

```
✓ tests/unit/main/rms-auth-errors.test.ts   (10 tests)
✓ tests/unit/main/device-id.test.ts         ( 5 tests)
✓ tests/unit/main/staff-auth-service.test.ts(11 tests)
✓ tests/unit/main/rms-auth-client.test.ts   (13 tests)
  Test Files  4 passed (4)   Tests  39 passed (39)
```

覆盖的关键行为：

| 用例 | 保护的约束 |
|---|---|
| 取身份失败时 `tokens.clear()` 被调用 | 不留「有凭证无身份」的半截状态 |
| 发码响应缺 `resendAfterSeconds` 时显式失败 | 不把 60s 重发间隔误算成 300s |
| 11011 文案含「15 分钟」且不同于 11003 | 两种锁定的行动指引不得互抄 |
| 5 个短信错误码文案两两不同、均非兜底 | 错误可区分，不被 `catch {}` 压平 |
| 日志不含手机号与验证码 | 日志脱敏 |
| device id 跨调用稳定、损坏自愈、写不进也不抛 | 指纹头不得阻断登录 |
| 两个新头出现在密码登录与发码请求上 | 覆盖全部认证请求而非仅短信接口 |
| 身份响应缺 `currentHotelId` 时仍可解析 | 酒店用户未绑定酒店时能正常登录（联调实测缺陷） |

全量单测：desktop `682 passed / 1 failed`，api `24 passed`。

**唯一失败项 `app-env.test.ts > resolveRmsOriginForBuild` 与本次改动无关**——已在 `git stash`
后的干净树上复现同一失败（干净树 `651 passed / 1 failed`）。本次改动使通过数由 651 增至 682
（+31），未引入新失败。

`apps/server` 单测在本机因 Playwright 浏览器二进制缺失而报 unhandled error，同样在干净树上
复现，与本次改动无关（server 侧本次零改动）。

### 构建验证

两个变体均用 forge 正式入口打包成功（`npm run package:desktop:staff` / `:phone`）。

**staff 变体产物**：

```
preload.js  staff-auth:{current-session, login, login-with-phone-code, logout, request-phone-code}  ✓ 5 个通道齐全
main.js     /api/v1/auth/sms/request-code ✓   /api/v1/auth/sms/login ✓
            x-app-version ✓   x-device-id ✓   device-id.json ✓
renderer    「酒店用户」「服务商用户」两套 UI 均在 ✓
            旧 auth 通道 `auth:login-with-phone-code` 已被 DCE 摇掉 ✓
```

**phone 变体产物**：旧 `auth:*` 通道保留，行为与改动前一致。

> 关于「phone 包里也能看到 `staff-auth:*` 通道」：这是既有设计，非本次引入。已在干净树上取
> 基线复验——改动前 phone 包同样含 `staff-auth:login` 与 `/api/v1/auth/login`。规范
> `staff-password-auth/spec.md` 明确：*"`preload` 不做变体分流：它是 IPC 白名单，`auth` 与
> `staffAuth` 两个 namespace 长期共存；挂上不代表对端注册了 handler。真正的隔离在
> `composition/window-scope.ts`"*。本次未改动该隔离机制。

## 真机联调（2026-08-18，dev 环境 / 本机 rms-server `http://localhost:8080`）

### 联调中发现并修复的缺陷

**症状**：验证码正确，但登录后回到登录页，界面提示「登录失败，请稍后重试」。

**定位过程**（客户端日志 `~/Library/Logs/Electron/staff/main.log`）：

```
/api/v1/auth/sms/request-code  → 200 ✅ 发码成功
/api/v1/auth/sms/login         → 200 ✅ 换到 token
/api/v1/me                     → 200 ✅ 服务端正常返回
        ↓
RMS profile did not match the expected contract { operation: 'me' }
Staff authentication operation failed { operation: 'login-phone-profile', rmsCode: -1 }
```

三个远端调用全部 200，失败发生在**客户端自己的契约校验**上（`rmsCode: -1` 即
`TRANSPORT_ERROR_CODE`）。因取身份失败会 `tokens.clear()`，token 被清掉，于是表现为
"验证码明明对却回到登录页"。

**根因**：酒店用户以手机号登录（登录即注册）时尚未绑定酒店，服务端 `/api/v1/me`
**不返回 `currentHotelId` 这个 key**。而契约按对接文档写成 `.nullable()` ——
nullable 只允许值为 `null`，**不允许 key 缺失**，需要 `.optional()`。

**修复**：`currentHotelId` 改为 `.nullable().optional()`；同理放宽 `phone` 与
`userType`（三者均无业务消费方，本期本就是"只存不用"）。已补 2 个回归用例锁住这个
形状（`rms-auth-client.test.ts` 的「staffIdentitySchema 对手机号登录用户的兼容性」）。

**顺带修复的可观测性缺陷**：原先契约校验失败只记一句笼统的
"did not match the expected contract"，`parsed.error` 塞进了 `cause` 却没落盘，导致
定位只能靠猜（实际多花了两轮登录）。现新增 `describeSchemaIssues()`，把
`字段: code (message)` 记进日志，且只取结构信息不取字段值（响应里含手机号、姓名）。
修复后日志直接给出 `currentHotelId: invalid_type (Invalid input)`。

### 复验结果

修复后重新登录**通过**：手机号登录全流程走通，进入已登录状态。

### 仍待验证（需完整联调环境）

以下项**尚未执行**，需已在阿里云控制台绑定的测试手机号与真实短信通道：

- [x] 酒店用户手机号登录全流程 —— 本机 rms-server 已通过
- [ ] 60s 重发倒计时与 300s 验证码过期分别生效、互不干扰
- [ ] 5 个错误码文案在真实响应下的区分度
- [ ] 服务商用户密码登录回归
- [ ] 重启后会话恢复、登出
- [ ] 抓包确认 `X-App-Version` / `X-Device-Id` 已带上且 device id 跨重启稳定

联调前置条件（来自服务端对接文档）：测试手机号须先在阿里云控制台绑定（每账号限 5 个，
现已绑定 `136****4089`）；确认短信套餐包余量，耗尽会导致发送失败（11013）。

**在这些项完成前，本变更不应归档，也不应声称短信登录「已验证可用」。**
