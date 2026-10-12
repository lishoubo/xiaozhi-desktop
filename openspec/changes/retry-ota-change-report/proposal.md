## Why

OTA 改动上报原本在失败后立即重试一次，短暂网络或 RMS 故障稍长时仍容易漏报；而永久性的请求错误也会被重复发送。上报已有稳定的 `operationId` 幂等键，可让远端识别同一次上报的重复发送。

## What Changes

- 对可恢复的上报失败最多重试两次，分别等待 1 秒和 3 秒，总共最多发送三次。
- 网络失败、超时及 HTTP 408/429/5xx 可重试；请求或认证类 4xx 不重试。
- 所有尝试保持同一 `operationId`，最终失败只告警并继续后续观测；不新增持久化队列。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ota-amount-change-report`: 明确可重试错误、延迟与尝试上限。

## Impact

- Desktop 上报服务、RMS HTTP 错误分类及其定向测试。
- 不改 RMS API 报文或依赖；不改认证层已有的 401 刷新重试。
