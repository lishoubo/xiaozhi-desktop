## Why

携程酒店发现当前会额外创建隐藏 `WebContentsView` 并重新导航，既重复占用浏览器资源，也脱离了用户刚完成登录的真实页面。携程账号接口的动态参数尚未验证可稳定复现，因此先复用当前可见页面的酒店 DOM 结果，为单酒店登录态补充可检索的临时 credential 身份。

## What Changes

- 携程发现直接在触发登录成功的当前 `webContents` 中读取酒店 DOM，不再创建隐藏 View 或重新加载固定管理页。
- 执行 DOM 脚本前校验当前页面属于受信任的携程商家后台 HTTPS 域名。
- 单酒店发现成功时，以酒店 ID 暂作 `channelAccountId`，并在 `credentialExtra` 中保存酒店 ID、酒店名称和 `hotel-dom` 来源标记。
- 多酒店结果继续不落库，不选择任意酒店冒充 credential 身份。
- 携程实现迁移到 `main/ota/ctrip/`，渠道模块自行封装页面校验、DOM 解析和临时身份映射。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-ota-credentials`: 增加携程单酒店场景使用酒店 DOM 事实作为临时 credential 身份的受限规则，并明确多酒店场景不得猜测账号身份。

## Impact

- 影响 Electron main 的携程发现模块、发现结果落库编排和相关单元测试。
- 不修改数据库结构、共享 API、renderer UI 或其他 OTA 渠道行为。
- 携程账号接口完成验证后，需要用真实渠道账号身份替换 `hotel-dom` 临时身份。
