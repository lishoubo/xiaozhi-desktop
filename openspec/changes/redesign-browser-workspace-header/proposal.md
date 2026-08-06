## Why

OTA 浏览器工作区把渠道、登录态和页面标签混在相似导航中，并且从酒店账号记录反推登录态，导致没有关联门店的 credential 无法选择或复用。需要以 credential 作为工作区账号层的事实来源，并明确两个加号与标签关闭的完整流程。

## What Changes

- 将工作区头部收敛为“渠道行 + 页面工作栏”，区分渠道、credential 与页面标签。
- 账号列表直接列出当前渠道的全部 `OtaCredential`，不依赖 `OtaAccount`。
- 标签区加号复用当前 credential 新建页面；账号区加号打开 credential 列表，列表内才提供新登录入口。
- 账号列表增加“从 Cookie 导入”：复用现有导入能力，成功后直接使用当前渠道 Cookie 打开工作区；初始化导入仍保留设置页复核流程。
- 切换 credential 时先打开目标登录态，再关闭当前渠道旧登录态的标签。
- 补齐标签关闭后的相邻标签激活与最后标签空态；没有活动 credential 时展示当前渠道名称。
- 账号区声音按钮统一控制当前运行期内全部 OTA 标签的网页声音，新建标签继承该全局状态。
- 新增 desktop renderer/preload/main 间按渠道读取和打开 credential 的 IPC 能力。

## Capabilities

### New Capabilities

- `browser-workspace-header`: 定义 OTA 渠道、credential 与页面标签的两层导航及交互流程。

### Modified Capabilities

- `local-ota-credentials`: 增加按渠道列出全部本地 credential，以及直接复用 credential 打开渠道页面的行为。

## Impact

- 影响 `apps/desktop` 的 renderer 组件、preload API、main IPC、credential repository 和相关测试。
- 新增 desktop 内部 IPC contract，不修改 server、`packages/api`、数据库 schema 或远端部署方式。
