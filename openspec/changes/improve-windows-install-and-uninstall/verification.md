## 本地验证（macOS，2026-10-15）

- `openspec validate improve-windows-install-and-uninstall --strict`：通过。
- `node --check scripts/create-windows-installer-entrypoints.mjs`、`node --check scripts/desktop-make.mjs`、`node --check scripts/tests/windows-installer-entrypoints.test.mjs`：通过。
- `node --test scripts/tests/windows-install-diagnostic.test.mjs`：2 通过、3 项 Windows 专用用例跳过。
- `node --test scripts/tests/windows-installer-entrypoints.test.mjs`：Windows 专用用例在 macOS 上跳过。
- `git diff --check`：通过。

## 尚待 Windows 验证

- 用 MSVC 编译安装入口、运行双 EXE、检查日志与弹窗行为。
- 使用完整 Squirrel Setup 构建发布包，确认安装、同版本重装及普通卸载的真机行为。
- 验证后再同步稳定规范 `openspec/specs/desktop-windows-install-entrypoints/spec.md`。

## 2026-10-15 双 EXE 调整（本地）

- 原始 `setup.exe` 不再被打包脚本移动或内嵌；另产出 `<产品名>安装程序.exe`。
- 安装入口不调用删除 API；追加写入 `install-launcher.log`，失败弹窗显示日志路径，原始 Setup 退出后检查两个 EXE 是否仍存在。
- Windows 原生构建和实际安装尚待 Windows 流水线与真机验证，本地 macOS 不能验证 Win32 行为。
- 原始文件名收敛为 `setup.exe`，用户入口为 `<产品名>安装程序.exe`；本地定向 Node 测试 2 通过、4 项 Windows 专属跳过。
- OSS 上传 `--dry-run` 验证：本地 `setup.exe` 映射到旧下载对象键，安装入口 EXE 不作为无法独立运行的单文件上传。
- 发布目录辅助脚本改名为 `应用诊断.cmd`、`应用卸载.cmd`；脚本内部的版本号和安装目标不变。
