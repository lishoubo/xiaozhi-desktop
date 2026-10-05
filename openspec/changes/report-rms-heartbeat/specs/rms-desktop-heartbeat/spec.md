## Purpose

RMS 接收桌面 App 定期上报，并向管理人员提供最近上报的版本和近期运行情况。

## ADDED Requirements

### Requirement: 独立的已认证上报接口

RMS SHALL 提供 `POST /api/v1/app/heartbeat`，使用现有 Bearer 认证。客户端不发送请求体，沿用 `X-App-Version` 和 `X-Device-Id` 请求头。成功时 SHALL 返回现有 API 风格的空数据成功响应；未认证时 SHALL 使用现有鉴权错误。接口 SHALL NOT 重新登录、签发令牌或更新最近登录时间。现有 `GET /api/v1/me` SHALL 保持纯查询，专用路径不要求 `X-Report-Type`。

#### Scenario: 已认证客户端上报
- **WHEN** 有效 Bearer 令牌调用心跳接口并携带版本与设备请求头
- **THEN** RMS 返回标准成功响应，不创建新登录会话

#### Scenario: 未认证请求
- **WHEN** 无效或缺失的 Bearer 令牌调用心跳接口
- **THEN** RMS 返回现有鉴权错误，不记录有效心跳

### Requirement: 在现有登录日志表记录心跳

认证成功后，RMS SHALL 在现有 `login_log` 中记录该次上报：`employee_id` 为认证用户，`login_type=HEARTBEAT`、`result=SUCCESS`，`app_version` 和 `device_id` 来自请求头，`created_at` 使用服务端时间。版本缺失或空白时该条记录的版本 SHALL 为空值。心跳 SHALL NOT 更新原有最近登录时间；登录历史 SHALL 将 `HEARTBEAT` 标为“心跳上报”，不把它当作真实登录。

#### Scenario: 重复上报
- **WHEN** 已认证客户端在不同时间多次调用心跳接口
- **THEN** 每次有效调用各形成一条带服务端时间的心跳记录，最近登录时间不变

### Requirement: 管理端查看最近上报

App 用户管理页 SHALL 从每个用户最新一条成功的心跳记录展示其上报时间和版本。距该时间不超过两小时显示“近期运行”，超过两小时显示“未在近期上报”，从未收到心跳显示“暂无上报”。该状态 SHALL 表达近期活动推断，不代表实时连接。同账号多设备时展示最后一次上报的设备版本；老版本客户端不发心跳时，现有登录及 `/me` 行为保持不变。

#### Scenario: 近期收到心跳
- **WHEN** 用户最近一次有效上报在两小时内
- **THEN** 管理页展示“近期运行”、最近上报时间和该条上报版本

#### Scenario: 无上报或超时
- **WHEN** 用户从未上报或最近一次上报超过两小时
- **THEN** 管理页分别展示“暂无上报”或“未在近期上报”

## 验收关注点

- 核对有效、未认证、空版本与重复上报行为；确认心跳不会改变登录状态或最近登录时间。
- 核对管理页的版本、时间和两小时状态边界，以及历史记录与真实登录的区分。
- 评估每小时写入带来的 `login_log` 增长，并核对 App 用户分页查询最近心跳的索引和查询计划。
