## Why

RMS 后台绑定的存量记录 `bindExtra` 里没有 `channelAccountId`，桌面端「重新登录」
无从核对身份，只能把用户推去走完整绑定 —— 而绑定会改写门店关系，与「救回登录态」
的诉求相反。缺的是一条流程：**门店已知、账号未知**时，探测门店反过来认账号。

## What Changes

- 「去登录」按 `bindExtra.channelAccountId` 有无分成两个场景，不再混走一条路
  - **场景 1（有）**：现有重登流程不变，弹窗改为预选并锁定已识别的账号
  - **场景 2（无）**：新增「按门店重认」流程 —— 走绑定的前半段（探测门店），
    收在重登的出口（只换凭证，门店关系不动）
- 新增 `reauth-by-hotel` intent，携带 `expectedOtaHotelId` 与 `rmsOtaAccountId`
- 新增独立的 probe 订阅方：探测结果不发给 UI 让用户挑，而是自行比对门店 ID
- 场景 2 校验通过时把 `channelAccountId` + 渠道上下文（抖音 `merchantGroupId`、
  美团 `otaPartnerId`/`otaPartnerName`）补写回远端，**RMS 老数据就地自愈**
- 校验失败只提示不一致，让用户重选账号或解绑，**不自动转成绑定流程**
- 账号列表弹窗（`ReauthOtaAccountDialog`、`AddOtaBindingDialog`）加分页

## Capabilities

### New Capabilities
- `ota-reauth-flow`: 失效绑定的重新登录行为契约 —— 两个场景如何分流、各自的校验
  锚点、失败如何收场，以及场景 2 补写远端绑定上下文的规则

### Modified Capabilities
- `local-ota-credentials`: 「写入渠道账号标识」当前只在用户确认绑定时发生
  （见该 spec「OTA 账号保存渠道化绑定上下文」）。新增第二个写入时机：场景 2
  按门店校验通过时补写标识与渠道上下文

## Impact

| 层 | 影响 |
|---|---|
| `shared/browser.ts` | 新增 `reauthByHotelIntentSchema` 并入 `otaTabIntentSchema`；`ReauthOutcomeDto` 扩 `hotel-mismatch` |
| `main/ota-tab/intent.ts` | 新增 `ReauthByHotelIntent` |
| `main/channels/` | 新增按门店比对的 dispatcher；复用底层 `HotelProbe`，不复用 `HotelProbeDispatcher` |
| `main/services/hotel-management-service.ts` | `confirmReauth` 支持补写 bindExtra |
| `renderer/components/hotel/` | 重登弹窗三态 + 分页 |
| RMS 远端 | 依赖服务端接受 desktop 补写 bindExtra 键（**待联调验证**） |
