## Purpose

已登录桌面 App 定期向独立接口上报存活与版本，默认间隔一小时。

## ADDED Requirements

### Requirement: 已登录桌面端使用独立接口发送心跳

桌面端 SHALL 在登录成功或恢复有效会话后发送一次心跳，随后在应用运行且保持登录期间按 `appConfig.heartbeat.intervalMs` 的配置间隔发送，默认值为一小时。心跳 SHALL 调用独立的 `POST /api/v1/app/heartbeat`，携带现有 Bearer 令牌、`X-App-Version` 和 `X-Device-Id`，不发送登录凭证、请求体或 `X-Report-Type`，不重新登录。退出登录后 SHALL 停止发送。桌面端 SHALL 继续仅用 `GET /api/v1/me` 查询身份。

#### Scenario: 登录后持续运行
- **WHEN** 用户完成登录并持续运行 App
- **THEN** App 立即调用一次独立的心跳接口
- **AND** 此后按 `appConfig.heartbeat.intervalMs` 的有效配置间隔继续发送，默认一小时

#### Scenario: 恢复与退出会话
- **WHEN** App 启动并恢复有效会话
- **THEN** App 发送一次心跳并开始后续定时上报
- **WHEN** 用户退出登录
- **THEN** App 停止定时上报

### Requirement: 桌面端在失败后继续调度

一次心跳请求失败时，桌面端 SHALL 记录结构化错误并在下一周期继续尝试，不因心跳失败清除登录会话；同一时刻 SHALL 至多有一个心跳请求在执行。

#### Scenario: 网络暂时不可用
- **WHEN** 已登录客户端的一次心跳因网络错误失败
- **THEN** 客户端保留会话并在下一周期继续尝试
