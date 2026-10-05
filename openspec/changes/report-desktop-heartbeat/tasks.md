## 1. 桌面端上报请求

- [x] 1.1 将现有未完成的 `/me` 心跳调用改为 `POST /api/v1/app/heartbeat`；沿用 Bearer、`X-App-Version`、`X-Device-Id`，不发送登录凭证或请求体，也不发送 `X-Report-Type`。
- [x] 1.2 定向验证请求路径、方法、请求头和错误处理；确认普通 `/me` 调用仍只用于身份查询。

## 2. 桌面端调度

- [x] 2.1 在 `app-config/types.ts` 与 `defaults.ts` 增加独立的 `heartbeat.intervalMs` 配置，默认一小时，并验证覆盖值和非法值的调度保护。
- [x] 2.2 在 `main/services/` 实现独立调度服务，由 `composition/app-scope.ts` 单例装配并释放；每轮重新读取 `appConfig.get().heartbeat.intervalMs`，用 fixed-delay 避免重叠。
- [x] 2.3 复用 window scope 的身份确认出口在登录或恢复会话后立即首报，登出或清除会话时停止；网络失败记录日志并继续后续周期。
- [x] 2.4 定向验证配置间隔、窗口关闭与重开时的单实例、启停时机及失败后继续运行。

## 3. 客户端验证

- [x] 3.1 验证已登录客户端的一小时上报行为及未登录、登出时不发送；记录本仓库验证证据。
- [ ] 3.2 在 RMS 独立接口可用后进行客户端联调；服务端需求见独立的 `openspec/changes/report-rms-heartbeat/`，不在本仓库执行。
