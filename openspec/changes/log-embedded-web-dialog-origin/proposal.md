## Why

Windows 用户反复看到标题为“小智酒店管家”的原生“账号异常”弹窗，且切到设置页后仍会出现。现有主进程日志记录了登录与渠道扫描结果，却没有记录原生网页对话框的发起标签页，无法定位具体来源。

## What Changes

- 在内嵌网页调用原生 `alert`、`confirm` 或 `prompt` 时，记录对话框类型、渠道、标签页及站点来源。
- 保持对话框原有显示与返回行为，不记录对话框正文、输入内容或带参数的 URL。
- 为诊断链路增加定向验证，确认前台和后台标签页均可归因。

## Capabilities

### New Capabilities

- `embedded-web-dialog-diagnostics`: 记录内嵌网页原生对话框的安全来源信息，不改变用户交互。

### Modified Capabilities

无。

## Impact

`apps/desktop` 的独立网页 preload、Forge 构建入口、BrowserManager 与对应单元测试。仅本地日志；不改远端服务或渠道网站。
