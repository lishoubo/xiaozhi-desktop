## Why

抖音当前只发现酒店并创建空身份 Credential，无法按渠道登录用户快速检索登录态。真机验证确认当前登录页可同源访问登录信息接口，可以复用当前 View 的登录态补齐抖音 Credential 身份。

## What Changes

- 从当前抖音登录 View 同源调用 `/life/gate/v1/user/login_info/`，白名单读取 `user_id`、`login_id`、名称和角色资料。
- 使用 `user_id` 作为抖音 `channelAccountId`，将其余必要账号资料保存到 `credentialExtra`。
- 保持现有“点击门店管理并用 CDP 捕获 `dsl/get`”酒店发现方式，账号身份与酒店事实一次返回并分别落库。
- 将抖音渠道实现迁移到 `main/ota/douyin/`，不增加统一渠道适配器。
- 账号身份缺失或格式无效时本次发现失败，不使用 `groupid` 或酒店 ID 猜测登录用户身份。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-ota-credentials`: 增加抖音从当前登录页面同源接口识别登录用户身份，并与酒店事实分开持久化的行为。

## Impact

- 影响 desktop main 的抖音发现模块、发现编排、composition root 和单元测试。
- 不修改数据库 schema、renderer、共享 API 或抖音酒店绑定字段。
