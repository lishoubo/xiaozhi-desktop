## Context

Windows 构建由 Forge MakerSquirrel 产生原始 Setup.exe；`scripts/desktop-make.mjs` 已把诊断 CMD 放入同一个发布目录。OSS 上传工具会单独上传原始 Setup.exe；带检查的入口随完整发布 ZIP 一起提供。Squirrel 提供 `Update.exe --uninstall` 与 Windows 卸载项，但 Setup.exe 没有安装前的自定义提示钩子。

## Goals / Non-Goals

**Goals:** 在不替换现有 Squirrel 打包器的前提下，发布 ZIP 同时保留原始 Setup 和带检查的安装入口；安装入口记录诊断日志且不删除任一 EXE；提供显式普通卸载入口。

**Non-Goals:** 不改原始 Squirrel Setup.exe 的行为，不清理 Electron `userData`，不修改自动更新流程。

## Decisions

- 在 Windows 构建机用系统 C++ 工具链编译一个小型原生 Win32 安装入口，命名为 `<产品名>安装程序.exe`。Forge 产生的原始安装器命名为 `setup.exe`，保留在同目录。入口从自身名称推导应用进程名，从同目录定位 `setup.exe`，枚举进程检查应用是否运行，并用命名互斥量拒绝第二个入口实例；检查通过后启动原 Setup 并等待。入口将关键步骤、路径、退出码及外层 EXE 是否仍存在写到同目录日志；无法写入时回退至临时目录，失败弹窗显示日志路径。入口不删除任何 EXE。
- 卸载脚本通过构建环境的 Squirrel 名称定位 `%LOCALAPPDATA%\<name>\Update.exe`，调用其 `--uninstall`。它不自行递归删除目录。这样清理范围受 Squirrel 既有卸载流程控制，用户数据保留。
- 打包脚本在 Windows make 后生成安装入口 EXE 和卸载 CMD，与原始 Setup 和现有诊断脚本共用产物目录。CI 在构建前初始化 Windows C++ 构建环境，并运行定向构建测试。发布 ZIP 的现有 `*.exe`、`*.cmd` 收集规则无需改变。OSS 单独下载只上传原始 Setup，避免提供缺少配套文件的安装入口。

## Risks / Trade-offs

- [用户正在用不同名字的绿色版，或另有旧版原始 Setup] → 进程名与互斥量检查无法覆盖所有情况；检查只作友好预防，不声称保证无文件占用。
- [原生封装 EXE 改变二进制特征] → Windows/第三方安全软件可能重新评估信誉；正式分发前在 Windows 真机验证，代码签名仍是长期方案。
- [卸载后仍有用户数据或少量空目录] → 普通卸载入口只调用 Squirrel，不执行额外清理；彻底清理另立功能。

## Migration Plan

下一次 Windows 构建后，新发布 ZIP 同时包含 `setup.exe`、带检查的安装入口 EXE 和普通卸载 CMD。OSS 单独下载继续使用旧对象键 `小智酒店管家-setup.exe`，其内容来自本地 `setup.exe`；需要安装前检查与日志的用户应获取完整 ZIP。自动更新所需的 RELEASES 与 nupkg 不变。
