## 1. 美团失效判据

- [x] 1.1 `channels/meituan/session-expiry.ts`：业务码 `606` → `COOKIE_EXPIRED`，更新文件头「刻意不硬编码」一节为两次样本结论
- [x] 1.2 单测：`606` → `COOKIE_EXPIRED`；其他非 10000 仍 `PARSE_ERROR`
- [x] 1.3 保留 `inventory-scan.ts` 第一步失败日志（`code`/`msg`，已在工作区），价格与房态两步失败日志同样补上 `code`

## 2. 扫描轮次汇总

- [x] 2.1 `inventory-scan-dispatcher.ts`：`scanOne` 返回失败 reason，`scanAll` 收集 `COOKIE_EXPIRED` 的 target，轮末调可选 `onRoundCompleted({ expired })`；总闸关 / disposed 不回调
- [x] 2.2 单测：两个失效 target + 一个网络失败 → 回调 `expired` 只含前两个；总闸关不回调；无失效时回调空数组

## 3. 主进程 → 界面

- [x] 3.1 `shared/browser.ts` 加 `otaCredentialExpiryScannedEventSchema`，`shared/ipc-channels.ts` 加 `otaCredential.expiryScanned`
- [x] 3.2 `window-capability-registry.ts` 加 `notifyCredentialExpiry`；`window-scope.ts` 接到 `webContents.send`
- [x] 3.3 `app-scope.ts`：`onRoundCompleted` → 按 `partitionName` 去重 → 查凭证取账号名与门店名 → `windowCapabilities.current()?.notifyCredentialExpiry`，打一条结构化日志（账号数、渠道）
- [x] 3.4 汇总函数抽成纯函数并单测：美团一账号两门店失效 → 1 个账号 2 个门店名；账号名缺失回退账号 ID
- [x] 3.5 preload 既有 `otaCredential` namespace 加 `onExpiryScanned` 订阅（zod 校验）

## 4. 界面提醒

- [x] 4.1 renderer 文案函数（纯函数）：1 个账号 / N 个账号两种模板，门店与账号各最多列 2 项、其余折成「等共 N …」，渠道名取 `ota-channels.ts` 的 shortName，门店名为空不加括号；单测覆盖两种模板
- [x] 4.2 `App.svelte` 订阅：非空 → `showAppNotification({ id: 'ota-credential:expired', tone: 'error', durationMs: 10_000 })`（同 id 原地替换并重置计时）；空 → `dismissAppNotification`

## 5. 上报 `otaHotelName`

- [x] 5.1 `shared/types/amount-change.ts`：`OtaAmountChangeReport` 加 `otaHotelName: string | null`，`OtaAmountChangeObserved` 的 Omit 列表加该字段
- [x] 5.2 `AmountChangeIdentityLookup` 加 `hotelNameOf(channel, otaHotelId)`，app-scope / window-scope 两处接 `ota_hotel` 精确查询
- [x] 5.3 `AmountChangeReportService` 按 design 顺序解析门店名（在 `resolveOtaHotelId` 之后，用归一后的 ID）
- [x] 5.4 `rms-amount-change-gateway-http.ts` 请求体与「Reporting amount change to RMS」日志带上 `otaHotelName`；`gateway/rms/types.ts` 同步
- [x] 5.5 单测：携程取 `hotelName`；美团多门店取对应 `poiName`；`otaHotelId` 为空 → null

## 6. 验证

- [x] 6.1 `tsc` + desktop 全量单测一次
- [ ] 6.2 真机：美团云朵（已失效）扫描后出现提醒，10 秒自动关闭；下一轮再次出现；界面任一时刻只有一条
- [ ] 6.3 真机：重新登录美团云朵后，下一轮不再出现提醒
- [ ] 6.4 真机：携程改价一次，日志「Reporting amount change to RMS」带 `otaHotelName`，RMS 台账可见
- [ ] 6.5 验证证据写入 `verification.md`；同步 `openspec/specs/ota-amount-change-report` 与新建 `ota-credential-expiry-notice`
