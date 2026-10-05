## Why

桌面端长期保持登录时，登录时记录的版本无法代表当前运行版本，也无法反映 App 近期是否仍在运行。桌面端已改为调用独立的定期上报接口，需要 RMS 项目提供接收和查看能力。

## What Changes

- 新增已认证的 `POST /api/v1/app/heartbeat` 接口，接收现有版本与设备请求头。
- 将上报作为独立类型写入现有 `login_log`，并让管理人员查看最近上报版本、时间及近期运行状态。
- 现有登录流程及 `GET /api/v1/me` 保持原行为。

## Capabilities

### New Capabilities

- `rms-desktop-heartbeat`: RMS 接收桌面端定期上报并展示最近活动与版本。

### Modified Capabilities

无。

## Impact

这是对 RMS 项目的**需求交接**，具体需求见本目录的 `specs/rms-desktop-heartbeat/spec.md`。本目录不包含服务端设计或实施任务；RMS 代码应由 RMS 项目自己的任务修改。
