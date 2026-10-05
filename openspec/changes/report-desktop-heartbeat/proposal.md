## Why

客户端版本随登录请求上报，但用户长期保持登录时，服务端无法通过登录时的版本判断当前运行版本或 App 近期是否仍在运行。现有 `GET /api/v1/me` 是纯查询接口，不用于定期上报。

## What Changes

- 已登录桌面端在登录或恢复会话后，以及此后约每小时，调用独立的已认证定期上报接口 `POST /api/v1/app/heartbeat`；不重新登录，也不调用 `/me` 充当心跳。
- 心跳使用独立的进程级调度服务；间隔放入现有 `appConfig`，默认一小时。
- 客户端沿用现有 Bearer 令牌、`X-App-Version` 和 `X-Device-Id`；上报失败不清除会话，下次定时继续尝试。

## Capabilities

### New Capabilities

- `desktop-heartbeat-report`: 已登录桌面 App 的定时存活与版本上报。

### Modified Capabilities

无。

## Impact

- 本仓库：桌面端认证客户端、会话生命周期、进程级定时服务与 `appConfig`。
- 依赖 RMS 提供独立的上报接口；具体服务端需求见 [RMS 定期上报接口需求](../../../docs/rms-heartbeat-server-requirements.md)，不在本变更实施。
