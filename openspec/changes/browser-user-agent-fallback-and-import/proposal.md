## Why

携程在 Electron 默认浏览器标识下返回风控拦截页；本地 dev 的携程标签改用 Chrome 风格 User-Agent 后，人工验证可正常访问。当前改动只覆盖 dev/macOS/携程，其他渠道与正式包仍使用 Electron 默认值，且导入浏览器 Cookie 时没有保留浏览器标识信息。

## What Changes

- 为桌面应用网页会话设置统一的 Chrome 风格默认 User-Agent，替代临时的 dev/macOS/携程特例。
- 导入 Cookie 时尽可能从所选浏览器的本机安装信息取得产品与版本，构造并保存对应 User-Agent；Cookie 本身不包含 User-Agent，不把推断值称为从 Cookie 复制。
- 使用导入 Cookie 打开新标签时优先采用保存的 User-Agent，缺失或不可用时使用全局默认值；其他登录路径保持默认值。
- 旧导入记录保持可读，不能识别浏览器版本时 Cookie 导入照常完成。

## Capabilities

### New Capabilities

- `desktop-browser-user-agent`: 定义网页会话的默认浏览器标识、Cookie 导入来源的标识保存、优先级与回退行为。

### Modified Capabilities

无。

## Impact

涉及 `apps/desktop/src/main/browser/`、`cookie-import/`、`ota-tab/`、`services/cookie-import-service.ts` 与定向测试；不更改共享 tRPC 契约或其他项目代码。浏览器请求的 User-Agent 会变化；需要本机验证携程及其他渠道页面兼容性。
