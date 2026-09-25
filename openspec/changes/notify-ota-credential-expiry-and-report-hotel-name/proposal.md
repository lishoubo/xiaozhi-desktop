## Why

美团账号 cookie 失效后，定时扫描连续两天静默失败（`code 606` 被归成 `PARSE_ERROR`），用户完全无感，价量态追齐因此中断；同时上报 RMS 时缺 `otaHotelName`，服务端台账排查看不出是哪家店。

## What Changes

- 美团响应判据：业务码 `606` 归为 `COOKIE_EXPIRED`（回读与扫描共用同一判据，一并生效）
- 定时扫描每轮结束汇总「登录失效的账号」，推给界面；界面用**单一常驻提醒**展示，已存在则只更新内容，本轮无失效则收起
- 只做提醒，不触发重新登录流程
- 上报体新增 `otaHotelName`（与 `otaHotelId` 同一家店，尽力而为，可空）；核对三渠道 `otaHotelId` 来源
- 扫描第一步失败时的日志带上 `code` / `msg`（排查用，已在本地改动中）

## Capabilities

### New Capabilities
- `ota-credential-expiry-notice`: 定时扫描发现渠道账号登录失效时，按轮汇总并以单一提醒告知用户

### Modified Capabilities
- `ota-amount-change-report`: 上报体增加 `otaHotelName` 字段

## Impact

- `apps/desktop/src/main/channels/meituan/session-expiry.ts`、`inventory-scan-dispatcher.ts`
- `apps/desktop/src/main/composition/`（app-scope / window-scope / window-capability-registry）
- `apps/desktop/src/shared/ipc-channels.ts`、`preload/`、`renderer/App.svelte`
- `apps/desktop/src/main/services/amount-change-report-service.ts`、`gateway/rms/rms-amount-change-gateway-http.ts`、`shared/types/amount-change.ts`
- 服务端 `AppOtaChangeReportRequest.otaHotelName` 已存在，无需改服务端
