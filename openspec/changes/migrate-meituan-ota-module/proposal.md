## Why

美团账号发现目前把渠道调用、功能编排和临时诊断集中在 `main/account-discovery`，且
`OtaCredential` 尚未保存美团稳定账号身份。现在已经验证可以通过
`globalStorage.bizAccountId → getDetail` 获取登录账号，并通过 `poiInfos` 获取酒店，因此
应先把美团链路按新的模型和目录边界收口。

## What Changes

- 为本地 `OtaCredential` 增加可空的渠道账号 ID，并提供按渠道和账号 ID 查询能力。
- 美团发现时读取并校验 `bizAcctId`，将其保存为 credential 的渠道账号 ID；经过白名单
  筛选的账号资料保存到 `credentialExtra`。
- 将美团账号身份、账号详情、酒店发现和登录 URL 判断迁入 `main/ota/meituan`。
- 保留现有功能模块的显式美团调用，不引入 `ChannelAdapter`、统一渠道 registry 或其他
  渠道迁移。
- 保持现有美团登录、cookie 导入、酒店账号创建和打开账号的用户效果。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-ota-credentials`：本地 credential 保存可检索的渠道账号身份，美团发现分别写入
  credential 账号事实与 account 酒店事实。

## Impact

- `apps/desktop/src/domain/`：`OtaCredential` 与 repository port。
- `apps/desktop/src/main/database/`：SQLite migration、credential repository。
- `apps/desktop/src/main/account-discovery/`：功能编排改为调用美团渠道模块。
- `apps/desktop/src/main/ota/meituan/`：新增美团专属实现。
- 定向 domain、database、account-discovery 和美团渠道测试。
- 不修改 server/RMS、renderer 交互、抖音或携程实现。
