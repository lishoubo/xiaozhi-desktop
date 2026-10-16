# 验证记录（2026-10-16）

## 故障证据

- dev 日志 18:52:21：后台价量态上报查询 `/api/v1/me` 时发生 `net::ERR_CONNECTION_REFUSED`；旧实现随后把本地凭证清掉。
- dev 日志 19:14:38 起：酒店管理请求在取 token 时抛 `RmsSessionMissingError`，没有发出酒店 API 请求。
- 本次修复限定在 desktop；没有读取或记录 token 内容。

## 自动验证

- 回归测试先失败：凭证缺失、refresh 过期、认证失败通知及临时服务故障保留会话均复现旧行为；实现后相关 5 个测试文件共 **44/44 通过**。
- `npm run test:all --workspace @hotel-butler/desktop`：单元测试 **146 文件、1423 用例通过**；随后 E2E 在加载未改动的 `tests/e2e/config/vite.renderer.config.mts` 时因 `Cannot merge config in form of callback` 中止，未执行 E2E 用例。该配置用 `mergeConfig` 合并函数形式的 renderer config。
- `npm run check --workspace @hotel-butler/desktop`：TypeScript 与 Svelte 检查通过，Svelte 0 errors / 0 warnings。
- 改动文件定向 ESLint 与 Prettier 检查通过，`git diff --check` 通过。
- 全量 `npm run lint --workspace @hotel-butler/desktop` 仍有 4 个 `@typescript-eslint/no-unused-vars` 错误，均位于本次未改动的 `meituan-inventory-readback.test.ts` 和 `meituan-room-change-targets.test.ts`。
- `openspec validate redirect-on-missing-staff-session --strict` 通过。

## 独立 verification pass

逐项对照差量规范及最终 diff：凭证缺失与 refresh 过期由 token provider 发无内容信号；认证拒绝先清凭证再发信号；网络、响应异常及普通服务错误不清凭证；窗口停止心跳、关闭内部页并通知 renderer；renderer 清本地状态回登录页。启动时通知早于订阅的情况由原有恢复会话流程兜底。窗口关闭内部页抛错时，通知仍在 `finally` 发出。

**未验证项：** E2E 配置错误阻断了真实 Electron UI 的自动验证；本次没有在运行中的 dev 应用里手动制造会话失效。按代码和单元测试可确认事件链各段，真实窗口端到端行为尚待 E2E 入口修复后验证。
