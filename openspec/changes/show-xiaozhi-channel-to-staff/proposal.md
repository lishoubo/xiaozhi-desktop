## Why

正式版目前在构建时移除了小智平台入口，服务商员工无法从渠道工作区使用统一改价页。需要按登录身份开放入口，同时防止酒店用户通过已有标签页进入。

## What Changes

- 正式版包含小智平台入口，仅向明确标记为服务商员工的登录用户展示。
- 打开内部页面时再次验证服务商身份；会话结束时关闭已打开的内部页面。
- 保持现有访问令牌注入与失效续期方式。

## Capabilities

### New Capabilities

- `desktop-internal-page-access`: 桌面端内部页面的服务商可见性与访问边界。

### Modified Capabilities

无。

## Impact

影响 desktop 渲染层入口与标签状态、主进程内部页面 IPC 和会话结束清理；不变更共享 API、RMS 系统或部署方式。
