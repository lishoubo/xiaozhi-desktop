# 验证记录

- `npm run test:unit --workspace @hotel-butler/desktop`：143 个测试文件、1406 项测试通过。
- `npm run check --workspace @hotel-butler/desktop`：TypeScript 与 Svelte 检查通过，0 个错误、0 个警告。
- 修改文件的 ESLint 检查通过；`git diff --check -- apps/desktop` 通过。
- `openspec validate show-desktop-installation-directory` 通过。

Windows 安装目录规则由单元测试覆盖；360 环境下的实际交互尚未在本机验证。
