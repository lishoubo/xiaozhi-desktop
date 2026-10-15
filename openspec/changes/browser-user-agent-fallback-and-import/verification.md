## 验证结果

- `openspec validate browser-user-agent-fallback-and-import --strict`：通过。
- `npm run test:unit --workspace @hotel-butler/desktop`：144 个测试文件、1414 项测试通过。
- `npm run check:types --workspace @hotel-butler/desktop`：通过。
- 变更文件的 ESLint 定向检查：通过。
- `npm run lint --workspace @hotel-butler/desktop`：未通过；测试结束后独立重跑仅剩 4 个已有错误，位于未修改的 `meituan-inventory-readback.test.ts` 和 `meituan-room-change-targets.test.ts`，均为 `_omitted` 未使用。
- `git diff --check`：通过。

## 已验证的行为

- 标准 Chrome 默认 UA 和 Chrome/Edge 版本推导；非法版本或含控制字符的 UA 被拒绝。
- 从 Chrome Profile 导入 Cookie 时读取 `Last Version`；版本文件缺失时仍导入 Cookie，UA 回退为默认值。
- 导入结果保存 UA；首次打开、账本保存、重开及绑定新分区时沿用；旧记录缺字段时仍可打开。
- BrowserManager 在首次加载前设置 Session 和 WebContents 的来源 UA。

## 待人工验证

本地用户已验证上一轮 dev/macOS/携程的 Chrome 155 UA 可打开页面。本轮全局 fallback 和导入后重开尚未在真实携程登录态上人工复测；本地测试无法代表携程实时风控结果。
