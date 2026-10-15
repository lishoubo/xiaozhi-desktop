## Why

Windows 用户在应用或安装器仍运行时重复启动 Squirrel Setup，可能遇到安装目录文件被占用，却只看到笼统的失败弹窗。普通卸载虽由 Squirrel 提供，发布包里缺少容易找到的入口。

## What Changes

- Windows 发布目录将原始 Squirrel 安装器命名为 `setup.exe`，并另加 `小智酒店管家安装程序.exe` 作为用户入口：安装前检查本应用及同一个入口是否正在运行，记录每一步日志；检查通过后运行同目录的原始 Setup。两个 EXE 均不在安装后删除。
- 在 Windows 发布包中增加普通卸载入口，调用 Squirrel 已有的卸载流程。
- 明确两个入口都不清理 Electron 用户数据；保留原始 Setup 和现有诊断入口。

## Capabilities

### New Capabilities

- `desktop-windows-install-entrypoints`: Windows 发布包中的安装前检查与普通卸载入口。

### Modified Capabilities

无。

## Impact

修改 Windows 打包脚本、构建流水线、发布包辅助脚本及定向测试；现有 Squirrel 更新包、更新源和用户数据目录不变。发布包内容变化，需要下一次 Windows 构建才能交付。
