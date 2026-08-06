## Why

当前 desktop `OtaAccount` 同时保存 OTA 酒店与 `partitionName`，把“登录身份”和“该身份可操作的酒店”合成了一个模型，无法自然表达抖音一份登录态关联多个酒店。第一轮先在现有流程上拆开这两个职责，为后续 credential probe、多酒店发现和远端绑定打下稳定模型基础，同时保持当前登录、探测、账号导航的用户效果。

## What Changes

- 新增本地 `OtaCredential` 领域模型与 SQLite 存储，以 `partitionName` 作为登录态指针，并预留渠道特定 `credentialExtra`。
- 改造本地 `OtaAccount`：使用 `credentialId` 关联登录态，不再直接持有 `partitionName`；将 `channelContext` 收敛为 `bindExtra`。
- 升级时直接丢弃旧结构的 `ota_account` 数据并创建新结构，不保留 legacy 表；用户重新登录或导入 cookie 后生成 credential 与 account。
- 调整现有账号探测与浏览器打开链路，通过 credential repository 创建、查询和复用 partition；登录成功后发现酒店、账号列表与账号打开行为保持一致。
- 现有 renderer 账号列表和标签匹配保持不变；过渡期账号 DTO 中的 `partitionName` 改为 main 根据 credential 生成的兼容投影，不再属于 `OtaAccount` 领域模型。
- 本轮不新增 credential probe、酒店 probe 编排、本地登录信息页面或 RMS 同步。

## Capabilities

### New Capabilities

- `local-ota-credentials`: 定义本地 OTA credential、其与本地 OTA account 的关系、旧账号数据清理策略以及现有账号流程的兼容行为。

### Modified Capabilities

无。

## Impact

- 影响 `apps/desktop/src/domain/` 中的身份、账号模型和 repository port。
- 影响 desktop SQLite schema、migration 及账号/credential repository。
- 影响账号探测落库、账号打开 IPC 和账号 DTO 的组装；renderer 交互保持不变。
- 需要调整对应 domain、database、main、preload 和 component 定向测试。
- 不新增或修改 server/RMS API，不改变当前渠道 probe 的探测实现和用户交互。
