## ADDED Requirements

### Requirement: Login method is chosen at runtime, not at build time

在 `staff` 变体内，桌面端 SHALL 同时提供「酒店用户」（手机号+验证码）与「服务商用户」（用户名+密码）两种登录方式，由用户在登录界面运行时切换，默认「酒店用户」。构建变体 `XIAOZHI_AUTH_VARIANT` SHALL NOT 决定使用哪种登录方式——它只决定装的是直连 RMS 的 `staffAuth` 体系还是经 `apps/server` 的旧 `auth` 体系。

两种方式 SHALL 产出同一种会话：同一个 `staffAuth` IPC 通道、同一份 token 存储、同一条会话恢复与登出路径。切换用户类型 SHALL NOT 影响已保存的登录态。

#### Scenario: Default login method on a fresh launch
- **WHEN** 用户首次打开 staff 变体的应用且无已保存会话
- **THEN** 登录界面展示「酒店用户」的手机号+验证码表单
- **AND** 界面提供切换到「服务商用户」的入口

#### Scenario: Switching user type mid-entry
- **WHEN** 用户在一种登录方式下已填入内容，随后切换到另一种
- **THEN** 展示另一种方式的表单
- **AND** 不发起任何网络请求，也不清除已保存的登录态

#### Scenario: Both methods yield an equivalent session
- **WHEN** 用户以短信验证码登录成功
- **THEN** 得到的会话与密码登录在形状与后续能力上完全一致
- **AND** 会话恢复、token 刷新、登出的行为与密码登录相同

### Requirement: Phone code request

桌面端 SHALL 提供发送验证码的能力，入参为 11 位手机号。请求 SHALL 走与密码登录相同的 rms-server origin 与 ASCII User-Agent 约束。

响应 SHALL 区分两个不同的时间值，且 MUST NOT 混用：

| 值 | 含义 | 用途 |
|---|---|---|
| `resendAfterSeconds` | 重发间隔（60s） | 「重新发送」按钮的倒计时 |
| `expiresInSeconds` | 验证码有效期（300s） | 验证码何时失效 |

任何手机号都会真实下发验证码（登录即注册），客户端 SHALL NOT 在发码阶段判断手机号是否已注册。

#### Scenario: Successful code request
- **WHEN** 用户输入合法手机号并请求验证码
- **THEN** 服务端下发验证码
- **AND** 重发按钮按 `resendAfterSeconds` 倒计时并在此期间不可点击
- **AND** 验证码的有效期按 `expiresInSeconds` 独立计算

#### Scenario: Malformed phone number
- **WHEN** 手机号不满足 11 位且以 1 开头
- **THEN** 客户端在本地拦截并提示，不发起请求

#### Scenario: Requesting too frequently
- **WHEN** 服务端返回发送过频
- **THEN** 界面提示「发送太频繁了，请 60 秒后再试」

### Requirement: Phone code login

桌面端 SHALL 提供验证码登录能力，入参为手机号与 6 位数字验证码。成功时服务端返回与密码登录**同形状**的凭证对，客户端 SHALL 用与密码登录完全相同的流程处理：先保存凭证，再取身份。

取身份失败时 SHALL 清除刚保存的凭证，MUST NOT 留下「有凭证无身份」的半截状态。

短信登录的 refresh 凭证有效期为 30 天（密码登录为 7 天）。客户端 SHALL 以服务端返回的实际值为准，MUST NOT 硬编码任一有效期。

#### Scenario: Successful phone login
- **WHEN** 用户提交正确的手机号与验证码
- **THEN** 客户端保存凭证并取回身份
- **AND** 进入已登录状态，与密码登录的结果一致

#### Scenario: Identity fetch fails after credentials are issued
- **WHEN** 凭证已换取成功但取身份失败
- **THEN** 客户端清除该凭证
- **AND** 停留在登录界面并提示失败原因

#### Scenario: Unknown phone number logs in
- **WHEN** 一个从未登录过的手机号提交正确验证码
- **THEN** 登录成功（登录即注册），不提示「未注册」

### Requirement: Phone authentication error messages are distinguishable

短信登录的失败 SHALL 按服务端错误码分别给出可读文案，MUST NOT 把不同失败压成同一句，也 MUST NOT 静默吞掉：

| 含义 | 文案 |
|---|---|
| 发送过于频繁 | 发送太频繁了，请 60 秒后再试 |
| 验证码错误或已过期 | 验证码错误或已过期 |
| 错误次数过多 | 错误次数过多，请 15 分钟后再试 |
| 手机号不可用 | 该手机号不可用，请联系管理员 |
| 验证码发送失败 | 验证码发送失败，请稍后再试 |
| 其他 / 传输失败 | 登录失败，请稍后重试 |

参数无效（10001）的文案 SHALL 同时适用于两种登录方式（由「请检查用户名和密码」改为「请检查输入的信息」）——同一个错误码现在会由两条链路触发，文案不得只提其中一条的字段名。

「错误次数过多」的锁定 15 分钟自动解除，文案 SHALL 说明时长，不得让用户以为账号被永久封禁——这与密码登录的账号锁定（无 TTL，需管理员处理）是不同的行动指引。

#### Scenario: Wrong verification code
- **WHEN** 用户提交错误或已过期的验证码
- **THEN** 界面提示「验证码错误或已过期」
- **AND** 不提示与发送频率或账号可用性相关的内容

#### Scenario: Too many failed attempts
- **WHEN** 服务端返回错误次数过多
- **THEN** 界面提示「错误次数过多，请 15 分钟后再试」

### Requirement: Login requests carry client fingerprint headers

认证请求 SHALL 携带 `X-App-Version`（客户端版本）与 `X-Device-Id`（设备标识）两个头，供服务端记录登录指纹。

`X-Device-Id` SHALL 是本机生成、跨重启稳定的标识符，并在本地持久化。它 SHALL NOT 包含任何用户身份信息，MUST NOT 随登录用户变化。

这两个头 SHALL NOT 成为登录的前置条件——缺失时服务端仍接受登录，因此本地读写失败 SHALL NOT 阻断登录流程。

#### Scenario: Device id is stable across restarts
- **WHEN** 应用重启后再次登录
- **THEN** 发送的 `X-Device-Id` 与上次相同

#### Scenario: Device id storage unavailable
- **WHEN** 设备标识无法读取或写入
- **THEN** 登录流程照常进行
- **AND** 不因此向用户报错

### Requirement: Identity contract covers phone-based users

身份契约 SHALL 包含 `phone`（可为空，服务商员工无手机号）与 `userType`（区分酒店用户与服务商用户）两个字段。契约为严格校验，服务端返回未声明的字段会导致解析失败，因此这两个字段 SHALL 在客户端消费前先补齐。

`userType` 本期**只存不用**：客户端 SHALL 接收并保存，但 SHALL NOT 依据它做界面分流。将来需要区分界面形态时 SHALL 依据 `userType` 而非 `role`——`HOTEL_STAFF` 这一角色在服务商侧也在使用，按 `role` 判断会把两类用户混淆。

#### Scenario: Phone user identity is parsed
- **WHEN** 一个以手机号登录的用户取回身份
- **THEN** 身份对象包含手机号与用户类型
- **AND** 解析不因这两个字段而失败

#### Scenario: Staff user without a phone number
- **WHEN** 一个服务商员工取回身份且其手机号为空
- **THEN** 解析成功，手机号为空值
