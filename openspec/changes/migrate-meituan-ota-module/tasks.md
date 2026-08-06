## 1. Credential 渠道账号身份

- [x] 1.1 先更新 domain 与 repository 定向测试，覆盖可空 `channelAccountId`、按渠道账号 ID 查询和仅更新账号身份字段，并确认旧实现按预期失败
- [x] 1.2 实现 `OtaCredential.channelAccountId`、repository port 与 SQLite repository 读写/更新能力，使 1.1 测试通过
- [x] 1.3 先更新 migration 定向测试，再新增可空 `channel_account_id` 与 `(channel, channel_account_id)` 普通索引，使旧 credential 保持可读

## 2. 美团渠道模块

- [x] 2.1 为美团账号详情和 `poiInfos` 纯解析编写定向测试，覆盖白名单字段、账号 ID 不一致、无效响应与多酒店结果
- [x] 2.2 新建 `main/ota/meituan`，实现账号身份读取、酒店读取和隐藏 view 编排；移除原始响应/账号敏感值日志，使 2.1 测试通过
- [x] 2.3 将美团登录 URL matcher 迁入渠道目录，并更新引用；不移动抖音或携程文件

## 3. 功能编排与落库

- [x] 3.1 先更新 `DiscoverAndCreate` 定向测试，覆盖显式美团调用、创建/刷新 credential 身份、单次结果保存多酒店、失败保留已有数据和只通知一次
- [x] 3.2 改造 `DiscoverAndCreate` 与 composition root：美团显式调用渠道模块，旧 registry 只保留抖音和携程，并删除旧美团 discovery 文件
- [x] 3.3 运行受影响的 domain、database、account-discovery 与美团渠道定向测试，修复回归

## 4. 验证与质量门禁

- [x] 4.1 独立 verification pass：核对 SQLite migration、字段白名单、美团身份/酒店分离、多酒店写入和其他渠道未迁移，并把证据写入 `verification.md`
- [x] 4.2 完成态运行一次 desktop 受影响模块质量门禁（测试、类型检查、Svelte 检查和 lint），如实记录结果
- [x] 4.3 独立 code-review pass：检查敏感日志、错误处理、Electron view 清理、依赖方向及是否出现 ChannelAdapter 或其他渠道范围扩张
- [x] 4.4 验证通过后同步 `local-ota-credentials` 稳定规范；未通过前不得提前同步或归档
