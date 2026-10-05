# 客户端验证记录

## 已验证

- `npm run test:unit --workspace @hotel-butler/desktop`：140 个测试文件、1395 个测试通过。包含新接口请求头与方法、默认及覆盖间隔、失败后重试、会话启停、快速切换会话时不重叠上报。
- `npm run check --workspace @hotel-butler/desktop`：TypeScript 和 Svelte 检查通过，0 个错误、0 个警告。
- 对本次修改的桌面端源码和测试运行定向 ESLint：通过。
- `openspec validate report-desktop-heartbeat --strict`：通过。

## 尚待联调

本次按约定假设 RMS 已提供 `POST /api/v1/app/heartbeat`。尚未对真实服务端执行端到端请求；RMS 所需接口及存储行为在独立的 `openspec/changes/report-rms-heartbeat/` 记录，本任务没有修改 RMS 仓库。
