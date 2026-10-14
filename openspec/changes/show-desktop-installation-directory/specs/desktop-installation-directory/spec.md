## ADDED Requirements

### Requirement: 安装目录可见且可打开

桌面客户端设置页 SHALL 显示应用安装目录路径，允许复制，并提供打开该目录的操作。打开操作 SHALL 由主进程使用固定的目录路径执行，不接受渲染进程提供的路径。

#### Scenario: Windows Squirrel 安装

- **WHEN** 可执行文件位于 `xiaozhi-hotel/app-<版本>/` 内
- **THEN** 设置页显示并打开 `xiaozhi-hotel/`，以覆盖后续版本目录

#### Scenario: 绿色版

- **WHEN** 可执行文件不在 Squirrel 的 `app-<版本>` 目录内
- **THEN** 设置页显示并打开可执行文件所在目录

#### Scenario: macOS 应用包

- **WHEN** 可执行文件位于 `.app/Contents/MacOS/` 内
- **THEN** 设置页显示并打开 `.app` 目录

### Requirement: 渠道页面沙箱

创建渠道网页标签时 SHALL 启用 Chromium 进程沙箱。

#### Scenario: 打开 OTA 渠道标签

- **WHEN** 主进程创建渠道网页视图
- **THEN** 视图的 `webPreferences.sandbox` 为 `true`
