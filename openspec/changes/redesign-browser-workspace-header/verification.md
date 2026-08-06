# Verification

## 2026-08-06 · 工作区网页声音开关

范围：单一运行期 `audioMuted` 状态、已有标签统一切换、新标签继承、受控 IPC/preload 和账号区声音按钮。

### 自动验证

- `npm run test:unit -- tests/unit/main/browser-manager.test.ts tests/unit/main/browser-handlers.test.ts tests/unit/preload/api.test.ts`：35/35 passed。
- 容错补充后 `npm run test:unit -- tests/unit/main/browser-manager.test.ts`：14/14 passed。
- `npm run test:unit -- tests/unit/main/browser-manager-partitions.test.ts tests/unit/main/ipc-logging.test.ts`：13/13 passed。
- `NODE_OPTIONS=--localstorage-file=/private/tmp/xiaozhi-vitest-localstorage.json npm run test:component -- tests/component/BrowserWorkspace.test.ts`：6/6 passed。
- `npm run check`：TypeScript 通过；Svelte 0 errors / 0 warnings。
- `openspec validate redesign-browser-workspace-header --strict`：通过。
- `git diff --check`：通过。

### 完成态测试说明

完成态执行过一次 desktop `npm test`：47 个 unit test files 中 46 个通过，`browser-manager-partitions.test.ts` 的 10 个用例因旧 MockWebContents 缺少 `setAudioMuted` 同一原因失败；补齐测试桩后该文件 10/10 passed。按全量测试只跑一次的项目规则未重复运行全量套件。

### 独立检查

- Verification pass：PASS，无阻断项。
- Code-review pass：初查发现单个 WebContents 静音异常可能中断后续同步；已改为跳过 destroyed WebContents、逐项记录异常并继续同步，复核确认该 finding 已关闭，未发现新问题。

### 未覆盖

- 未声明整个 `redesign-browser-workspace-header` change 完成；原有人工账号流程验收、全 change verification/code-review 和旧 `AccountsNav` 清理仍按 `tasks.md` 保留。
