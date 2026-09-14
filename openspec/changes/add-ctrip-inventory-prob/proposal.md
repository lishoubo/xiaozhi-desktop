## Why

桌面端目前只能**被动**监听用户在 OTA 页面上的改价/房态操作（`amount-change`），拿不到携程房态房量的**当前全量事实**；RMS 侧要做比价与联动就必须有这份定期快照。桌面端已持有用户的携程登录会话，比服务端 RPA 更省一层 cookie 搬运。

## What Changes

- 新增 `InventoryProbe` 渠道能力（port + 携程实现），定期抓取已登录携程账号的房态/房量
- 新增主进程定时调度器（全仓首个），默认 5 分钟一轮，生命周期挂 window-scope
- 新增 `channels/inventory-poll-dispatcher.ts`：第四种触发模型（定时），不复用现有三个事件驱动 dispatcher
- 主进程首次用 `net.fetch` 直接打 OTA 渠道读接口（此前仅用于自家 RMS）
- 复用既有 `SessionFactory.readInjectableCookies`，由 composition root 裁成窄回调注入 `channels/`（不新增会话能力）
- **第一阶段只打结构化日志**，不落库、不与服务端交互；抓取窗口默认 7 天可配置

## Capabilities

### New Capabilities
- `ctrip-inventory-scrape`: 携程房态房量定时抓取 —— 两步读接口契约、房态/房量字段语义与保守映射、登录失效的四种形态判定、钟点房与预售的源头过滤

### Modified Capabilities
- `local-ota-credentials`: 凭证的 partition 会话新增一个消费方（主进程按 partition 导出 cookie 供渠道 HTTP 读取），需明确该导出的唯一入口与脱敏要求
- `desktop-main-layering`: 新增「定时触发」这一类跨 scope 能力的装配与释放约束（定时器必须返回 dispose 句柄并接入 window-scope 的 disposers 链）

## Impact

| 区域 | 影响 |
|---|---|
| `apps/desktop/src/main/channels/` | 新增 `inventory-poll-dispatcher.ts`、`ctrip/inventory-prob.ts` 及其 payload 规格；`types.ts` 加 port、`registry.ts` 加可选字段与投影函数 |
| `apps/desktop/src/main/composition/` | window-scope 装配 dispatcher + 调度器，注入 cookie 读取与 credential 查询窄回调 |
| `apps/desktop/src/main/browser/session-factory.ts` | **不改** —— `readInjectableCookies` 已满足需求 |
| 外部依赖 | 携程 `ebooking.ctrip.com/ebkovsroom/api/inventory/*` 两个读接口；新增周期性外部请求（每账号每 5 分钟 2 次） |
| 风险 | 携程是否接受主进程装配的 cookie 串，待真机首跑判定；不成立则降级为「借已开标签页发请求」 |
| 暂不涉及 | 数据落库、RMS 上报、写接口（下发房态）、其他渠道 |
