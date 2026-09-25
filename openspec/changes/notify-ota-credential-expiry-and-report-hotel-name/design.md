## Context

动机见 proposal.md。两件事互不依赖，可分开实现、分开提交。

| 现状 | 位置 |
|---|---|
| 美团判据：非 `10000` 一律 `PARSE_ERROR`，`606` 未识别 | `channels/meituan/session-expiry.ts` |
| 携程判据：登录页 HTML / HTTP 401 / 鉴权失败体 / `EXPIRED_CODES` → `COOKIE_EXPIRED`，已完备 | `channels/ctrip/session-expiry.ts` |
| 扫描失败只打 warn + GlitchTip，无人消费 `COOKIE_EXPIRED` | `channels/inventory-scan-dispatcher.ts` `scanOne` |
| 更新提醒：app-scope → `windowCapabilities` → `webContents.send` → `App.svelte` → `showAppNotification` | `composition/window-capability-registry.ts` |
| `showAppNotification` 按 `id` 去重，同 id 原地替换；`durationMs: 0` 常驻；message 支持换行 | `renderer/notifications.ts` |
| 上报体无 `otaHotelName`；服务端 DTO 已有该字段（可空、纯记录、超 128 截断） | `shared/types/amount-change.ts` |

## Goals / Non-Goals

**Goals**
- 登录失效可见：每轮扫描一次汇总，界面只一条提醒
- 上报带门店名

**Non-Goals**
- 不拉起重新登录 / 不开标签页 / 不改账号状态
- 不补携程失效码（无新踩点，现有判据已覆盖）
- 回读路径的失效不接提醒（回读发生在用户刚操作成功的标签页里，失效概率极低；判据改动对它自动生效即可）
- 抖音不接（未接入扫描）

## 一、登录失效提醒

### 数据流

```
InventoryScanDispatcher.scanAll()                         main / channels
  for target:  scanOne() → outcome
                 failed && reason === 'COOKIE_EXPIRED' ──┐
  round end ─────────────────────────────────────────────┤
                                                         ▼
  deps.onRoundCompleted({ expired: ScanTarget[] })        ← 新增窄回调
                                                         │
app-scope                                                ▼
  toCredentialExpirySummary(expired)                      按 partitionName 去重
    credential = otaCredentialRepository.findByPartitionName()
    accountName = channelAccountNameOf(extra) ?? channelAccountId
    hotelNames  = 失效 target 的门店名（美团 pois[].poiName / 携程 hotelName）
  windowCapabilities.current()?.notifyCredentialExpiry(summary)
                                                         │
window-scope                                             ▼
  webContents.send(IPC_CHANNELS.otaCredential.expiryScanned, summary)
                                                         │
renderer/App.svelte                                      ▼
  accounts.length > 0 → showAppNotification({ id: 'ota-credential:expired', tone: 'error', durationMs: 10_000, ... })
  accounts.length = 0 → dismissAppNotification('ota-credential:expired')
```

### 契约骨架

```ts
// shared/browser.ts —— 与 otaDiscoveryCompletedEventSchema 并列（凭证相关 IPC schema 都在这里）
export const otaCredentialExpiryScannedEventSchema = z.strictObject({
  accounts: z.array(z.strictObject({
    channel: nonEmptyStringSchema,         // 'ctrip' | 'meituan'，renderer 映射成显示名
    accountName: nonEmptyStringSchema,     // 账号名，缺则账号 ID
    hotelNames: z.array(nonEmptyStringSchema), // 本轮失效的门店名，可空数组
  })),
});
export type OtaCredentialExpiryScannedEvent = Readonly<z.infer<typeof otaCredentialExpiryScannedEventSchema>>;

// channels/inventory-scan-dispatcher.ts
export type ScanRoundSummary = Readonly<{ expired: readonly ScanTarget[] }>;
// InventoryScanDispatcherDependencies 新增（可选，省略即不汇总）：
onRoundCompleted?: (summary: ScanRoundSummary) => void;

// composition/window-capability-registry.ts
notifyCredentialExpiry(summary: OtaCredentialExpiryScannedEvent): void;

// shared/ipc-channels.ts
otaCredential: { …, expiryScanned: 'ota-credential:expiry-scanned' },

// preload/namespaces/ota-credential.ts —— 并进既有 namespace，与 onDiscoveryCompleted 并列
onExpiryScanned(listener)
```

### 文案

| 情况 | title | message |
|---|---|---|
| 1 个账号 | 渠道账号登录已过期 | 您的美团酒店账号「YunduojiudianAI」登录已过期，请及时登录，避免影响价量态追齐。 |
| N 个账号 | N 个渠道账号登录已过期 | 请及时登录，避免影响价量态追齐：<br>美团酒店「YunduojiudianAI」（云朵酒店）<br>携程「运营商赵经理」（云朵酒店(包头机场店)） |

门店与账号各最多列 2 项，超出折成「A、B 等共 5 家门店」/ 末行「等共 N 个账号」—— 卡片最宽 24rem，全列会占满右上角。

渠道显示名取 `renderer/data/ota-channels.ts` 的 `shortName`（「您的携程账号」比「携程酒店 eBooking账号」通顺），查不到回退 channel id。门店名为空则不加括号。

### 决策

| 问题 | 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| 计入哪些失败 | 仅 `COOKIE_EXPIRED` | 不误报；重登能解决的才提醒 | 未识别的失效码漏报 | ✅ |
| | 所有 `failed` | 不漏 | 断网时全部账号一起报，提醒失去可信度 | ❌ |
| 美团 606 | 硬编码进判据 | 两次样本 + 账号发现 `none` 互证 | 码表不全 | ✅ 其余码仍 `PARSE_ERROR` |
| 汇总放哪 | dispatcher 收集、回调交出 | 轮次边界只有调度器知道；不认识渠道，只看 reason | 多一个依赖 | ✅ |
| | app-scope 包一层计数 | dispatcher 不动 | 要靠「最后一个 target」猜轮次结束，易错 | ❌ |
| 去重维度 | `partitionName` | 美团一账号多门店只算一次 | — | ✅ |
| IPC 放哪 | 新开 `otaSession` namespace | — | 「session」在仓库里已指员工登录态与 Electron partition，易混；为一个事件单开 namespace | ❌ |
| | **并进 `otaCredential`** | 失效是凭证的状态；与 `onDiscoveryCompleted` 同类推送；schema 与凭证 schema 同处 `shared/browser.ts` | — | ✅ |
| 事件名 | `expiryScanned` | 语义是「每轮扫描推一次汇总（可为空）」，不是「状态变了才推」 | — | ✅ |
| 窗口重叠 | 固定 id `ota-credential:expired` 覆盖 | 复用现成去重，零新增组件 | 覆盖时会移到队首 | ✅ |
| 与更新提醒共存 | `tone: 'error'`（红色 + 警示图标） | 与蓝色更新提醒一眼可分；两者 id 不同，纵向堆叠不重叠 | — | ✅ |
| 展示时长 | 常驻（`durationMs: 0`，同更新提醒） | 不会错过 | 不登录就一直挂着，打扰 | ❌ |
| | **10 秒自动关**（`durationMs: 10_000`） | 每轮提醒一次、不长期占屏；间隔 ~5 分钟远大于 10 秒，不会叠 | 用户不在电脑前会错过这一轮 | ✅ 下一轮会再提醒 |
| 本轮无失效 | 主动 dismiss | 登录恢复后提醒自动消失 | — | ✅ |
| 窗口未打开时 | 丢弃，不缓存 | 简单；下一轮（≤ 6 分钟）自然补上 | 刚开窗口时最多晚一轮 | ✅ |
| 总闸关 / 本轮未跑 | 不回调 | 保持上次状态，不误收起 | — | ✅ |

## 二、上报带 `otaHotelName`

### `otaHotelId` 来源核对（结论：不改）

| 渠道 | 链路 | `otaHotelId` 来源 | 准确性 |
|---|---|---|---|
| 携程 | 监听 / 回读 / 扫描 | service 层用 `credentialExtra.masterHotelId` 覆盖（632e5d3） | ✅ 预付/现付已归一 |
| 美团 | 监听 / 回读 | 请求体顶层 `poiId` | ✅ 单值一次一家 |
| 美团 | 扫描 | `credentialExtra.pois[].poiId` | ✅ |
| 抖音 | 监听 | referer 上的 `poi_id`，常为空 | ⚠️ 尽力而为，spec 规定不查绑定补齐，维持 |

2026-09-23~25 dev 日志核对：携程监听与扫描均上报 `122244992` / `131576652`，与凭证 `masterHotelId` 一致。

### 门店名解析

```
resolveOtaHotelName(channel, otaHotelId, credentialExtra)
  otaHotelId === ''                         → null
  ctrip   && extra.masterHotelId === id     → extra.hotelName
  meituan && extra.pois[].poiId === id      → 该 poi 的 poiName
  其余 → hotelNameOf(channel, id)            ← ota_hotel 精确查（channel, ota_hotel_id）
  都没有                                     → null
```

```ts
// services/amount-change-report-service.ts —— AmountChangeIdentityLookup 新增一个窄查询
hotelNameOf: (channel: string, otaHotelId: string) => string | null;

// shared/types/amount-change.ts —— OtaAmountChangeReport 新增
/** 与 otaHotelId 同一家店的名称，纯记录。otaHotelId 为空或查不到时 null。 */
otaHotelName: string | null;
// OtaAmountChangeObserved 的 Omit 列表加 'otaHotelName'（由 service 补齐，同 channelAccountName）
```

| 问题 | 方案 | 结论 |
|---|---|---|
| 在哪补名字 | service 层（已持有 credential，且携程 ID 归一也在这里） | ✅ 适配器够不着凭证 |
| 凭证优先还是 `ota_hotel` 优先 | 凭证优先 | ✅ 凭证随登录刷新；`ota_hotel` 只有确认过的绑定 |
| 携程名字是否匹配 ID | 只在 `otaHotelId === masterHotelId` 时取 `hotelName` | ✅ 防止拿账号酒店名配报文里另一家的 ID |
| 查 `ota_hotel` 违反「不查本地绑定」吗 | spec 禁止的是为**凑 ID**查绑定；按已知 ID 精确取名不改变定位 | ✅ spec delta 写明 |

## Risks / Trade-offs

- [**停在浏览器工作区且开着 OTA 标签页时，提醒被网页盖住**] 原生 `WebContentsView` 永远浮在 HTML 之上（`browser-manager.ts` `setViewportVisible` 注释），提醒只有落在 42px 标题栏里的一小条可见。2026-09-25 真机确认；版本更新提醒同样受影响。用户决定本期接受，后续可选：系统通知（Electron `Notification`）或标题栏常驻标记

- [用户不登录时每 ~5 分钟出现 10 秒] → 符合「每轮扫描都提醒」；真机观察后若仍嫌打扰，再调时长或频率，改动局限在 renderer
- [美团其他失效码未识别，漏报] → 第一步失败日志已带 `code`/`msg`，积累样本后补进判据
- [`otaHotelName` 超 128 字符] → 服务端截断，不拒收，desktop 不处理
