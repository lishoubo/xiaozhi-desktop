## Why

绑定入口目前会列出注定失败的选项：远端规则是「同一 RMS 酒店 + 同一渠道只能有一个活跃绑定」，但「新增绑定账号」弹窗照列该渠道的账号，用户选了才被远端拒绝。同时 `rms-ota-account` 的登录失效/过期/绑定失败三类状态在界面上只有一个「暂未实现」的提示，用户无法自助恢复。

## What Changes

- 「新增绑定账号」弹窗**按渠道整体过滤**：这家 RMS 酒店在某渠道已有活跃绑定时，该渠道下所有账号都不展示
- 新增**「重新登录」流程**，收敛登录失效/过期/绑定失败三类状态（具体状态清单待与服务端对齐，本次不收口）：
  - 弹窗列出该渠道账号，能匹配上的账号标注「上次绑定过」
  - 选**已有账号** → B 路：只刷新登录态，不重新探测门店，成功后弹窗提示
  - 点**「新登录账号」** → A 路：走完整绑定流程（换了账号，门店关系需重新确认）
- 两个弹窗在该渠道没有账号时都提供「新登录账号」快捷入口
- `confirmBinding` 把 `credential.channelAccountId` 合进 `bindExtra` 写给远端，使此后经 desktop 绑定的记录**自带账号关联**
- `RmsOtaAccountGateway` 新增 `reauthenticate`（只换凭证，不动门店关系），先落 mock

## Capabilities

### New Capabilities

- `ota-binding-recovery`: 绑定入口的可选项过滤规则，以及登录态失效后的恢复流程（重新登录的两条路线、账号匹配与标注）

### Modified Capabilities

- `local-ota-credentials`: `bindExtra` 新增 `channelAccountId` —— 该 spec 现有「OTA 账号保存渠道化绑定上下文」要求 `bindExtra` 只保存**酒店发现阶段**获得的渠道原始信息，本次新增的是**用户确认绑定那一刻**写入的账号关联，是对该要求的扩展

## Impact

**受影响代码：**

| 层 | 改动 |
|---|---|
| `shared/` | `OtaTabIntent` 加一种 kind；`UiWaitingResultPayloads` 加一种 kind；`bindExtra` 的 `channelAccountId` 契约 |
| `main/gateway/rms/` | `RmsOtaAccountGateway.reauthenticate` + mock 实现 |
| `main/services/` | `confirmBinding` 合入 `channelAccountId`；新增重新登录的服务方法；「按 otaHotelId 反查 credential」查询 |
| `main/channels/` | dispatcher 识别新 intent kind：跳过 probe，直接发「登录已刷新」信封 |
| `main/database/` | `OtaHotelRepository` 新增按 `(channel, otaHotelId)` 反查（已有 `findByChannelAndHotelId`，确认是否够用） |
| `renderer/` | 两个弹窗的过滤与快捷入口；新增重新登录弹窗；跨路由 intent 第二条 |

**复用的既有接缝**（本次不新建抽象）：`openExisting(credentialId, intent)`、`createWaitingUiResult`、`suspendViewport/resumeViewport`、`createNavigationIntent`、`LoginDetector` 的 intent 保管与清理。

**外部依赖风险：** 真实 RMS 是否提供「只更新凭证」接口未知，本次按新增 `reauthenticate` 设计并落 mock；真实接口形状不同时只换实现，与 `bind` 当初的处理方式一致。
