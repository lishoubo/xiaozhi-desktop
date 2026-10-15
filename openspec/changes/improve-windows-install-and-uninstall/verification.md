## 本地验证（macOS，2026-10-15）

- `openspec validate improve-windows-install-and-uninstall --strict`：通过。
- `node --check scripts/create-windows-installer-entrypoints.mjs`、`node --check scripts/desktop-make.mjs`、`node --check scripts/tests/windows-installer-entrypoints.test.mjs`：通过。
- `node --test scripts/tests/windows-install-diagnostic.test.mjs`：2 通过、3 项 Windows 专用用例跳过。
- `node --test scripts/tests/windows-installer-entrypoints.test.mjs`：Windows 专用用例在 macOS 上跳过。
- `git diff --check`：通过。

## 尚待 Windows 验证

- 用 MSVC 编译封装器、资源嵌入、运行封装 EXE 与弹窗行为。
- 使用完整 Squirrel Setup 构建发布包，确认安装、同版本重装及普通卸载的真机行为。
- 验证后再同步稳定规范 `openspec/specs/desktop-windows-install-entrypoints/spec.md`。
