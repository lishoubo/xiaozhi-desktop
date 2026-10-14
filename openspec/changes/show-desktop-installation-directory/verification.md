# 验证记录

- `npm run test:unit --workspace @hotel-butler/desktop`：143 个测试文件、1406 项测试通过。
- `npm run check --workspace @hotel-butler/desktop`：TypeScript 与 Svelte 检查通过，0 个错误、0 个警告。
- 修改文件的 ESLint 检查通过；`git diff --check -- apps/desktop` 通过。
- `openspec validate show-desktop-installation-directory` 通过。

Windows 安装目录规则由单元测试覆盖；360 环境下的实际交互尚未在本机验证。

## 2026-10-14 本地开发目录修正

用户反馈 macOS 开发版点击“打开安装目录”无反应。原实现将 `Electron.app` 传给 `shell.openPath`，而 Electron 文档说明该 API 会按系统默认方式打开文件。新增测试先复现旧路径，再改为开发版项目目录、macOS 打包版 `.app` 所在目录；定向测试 3 项和 TypeScript 检查通过。图形界面验证仍需在用户的运行窗口确认。
