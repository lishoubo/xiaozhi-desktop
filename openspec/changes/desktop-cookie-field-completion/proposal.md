## Why

抖音账号（一号绑 86 店）反复集体掉线报 `LOGIN_EXPIRED`，最短 2 小时复发，cookie 本身远未过期。实测确认根因：desktop 上送 RMS 的 cookie 快照只有 `{domain, name, value}` 三个字段，丢掉了 `partitionKey` 等属性，服务端据此写回浏览器的登录态是残缺的。

## What Changes

- cookie 采集从 `session.cookies.get()` 改为 CDP `Network.getAllCookies`，复用 OTA 标签页的 `webContents`
- 上送字段从 3 个扩到 9 个：新增 `path` / `secure` / `httpOnly` / `sameSite` / `expires` / `partitionKey`
- CDP 不可用时（标签页已关、debugger 被探测占用、attach 抛错）降级到 `session.cookies.get()`，仍补齐除 `partitionKey` 外的五个字段，并打结构化日志标记本次为降级采集
- 属性缺省时省略字段而非传 `null`；`partitionKey` 原样透传不归一化；不裁剪、不按 name 去重

服务端接收端已改好且向后兼容（新增字段全部可选），**不需要前后端同时上线**。

## Capabilities

### New Capabilities

- `ota-cookie-snapshot`: desktop 采集 OTA 登录态 cookie 并上送 RMS 的行为契约 —— 用什么方式采集、上送哪些字段、字段缺省怎么表达、采集降级时如何标记

### Modified Capabilities

（无。`local-ota-credentials` 管的是本地 credential 与 partition 持久化边界，不涉及上送 RMS 的快照形状；本次不改其任何需求。）

## Impact

**代码**

| 位置 | 改动 |
|---|---|
| `main/composition/app-scope.ts:89` | `readCookieSnapshot` 唯一采集点，改为走新采集器 |
| `main/gateway/rms/types.ts:75` | `RmsCookieSnapshotEntry` 扩字段 |
| `main/services/hotel-management-service.ts` | 三处调用点（`confirmBinding` / `confirmReauth` / `confirmBackfillHotel`）签名可能受影响 |
| `main/ota-tab/` | 新增「按 credential 定位标签页 webContents」的开口 |
| 新增采集器模块 | CDP 采集 + 降级 + 字段映射 |

**外部接口**：`POST /api/v1/app/ota-accounts`、`PUT /api/v1/app/ota-accounts/{id}` 的 `cookies` 数组元素形状（服务端已兼容）。

**不改**：`hotelId` / `source` / `otaHotelId` / `bindExtra` 等其余字段；本地 credential 存储结构；探测链路。

**风险**：`webContents.debugger` 独占，与 `HotelProbe` 存在 attach 冲突 —— 由降级策略兜底，不让绑定流程失败。
