# 验证证据 —— optimize-ota-browser-tabs

## 1. 自动化验证（已完成）

| 项 | 命令 | 结果 |
|---|---|---|
| 单元测试（全量） | `npm run test:unit --workspace apps/desktop` | **724 passed / 99 files**，0 失败 |
| 类型检查 | `npm run check`（`check:types` + `check:svelte`） | 0 error |
| Lint | `npm run lint` | 0 error / 0 warning |

### 本次新增的测试

| 文件 | 新增 | 覆盖 |
|---|---|---|
| `tests/unit/main/browser-manager.test.ts` | 17 例（9 → 26） | 可见性正交、弹窗只建不激活、开窗节流、数量上限、三类故障、ERR_ABORTED 过滤、关闭接管、让位泄漏 |
| `tests/unit/renderer-tab-title.test.ts` | 5 例（新建） | 后缀清洗、无规则渠道、清洗后为空的回退、加载占位、故障态优先 |
| `tests/unit/main/browser-handlers.test.ts` | 1 例 | `setViewportVisible` 的布尔校验与转发 |

### 实现过程中被测试抓到的两个真实缺陷

两者都不是「测试写错了」，而是代码确有问题：

**① 关闭活动标签页后主进程与界面选的接班人不一致**

初版 `pickSuccessor` 取「同渠道第一个」，而渲染进程 `browserOtaTabs.close()` 取
`nextTabs[Math.min(index, nextTabs.length - 1)]`（相邻的那个）。两侧规则不同 → 内容区
先落到 A、再跳到 B，用户看到一次莫名闪跳。已改为两侧同一条规则（优先右侧邻居）。

**② 让位状态泄漏，会造成不可自行恢复的空白内容区**

`suspendViewport()` 的唯一恢复出口是弹窗的 `closeDialog()`。但弹窗挂在
`BrowserWorkspace` 子树下，**弹窗开着时从侧边栏跳走会连同弹窗一起卸载**，
`closeDialog()` 永不执行 → `viewportVisible` 停在 `false` → 下次回到工作区
`activate()` 照着它把视图设为不可见，内容区一片空白且用户无法自救。

修复：`hide()`（离开工作区）复位可见性。已加回归测试，并做过反证——注释掉修复后该
用例确实失败（`1 failed | 25 passed`），不是空测试。

## 2. 真机验证（待执行）

以下需在真实应用中操作，自动化无法替代：

- [ ] **10.2 零尺寸竞态**：携程标签 → 触发绑定弹窗（让位）→ 关闭弹窗 → 点携程菜单
      触发新开页，确认内容区正常切换（**这是本次要修的原始故障**）
- [ ] **10.2b 让位泄漏**（新增，见缺陷②）：打开绑定弹窗 → **不关闭弹窗**，直接从侧边栏
      跳到别的页 → 再回到浏览器页，确认内容区正常显示而非空白
- [ ] **10.3 故障恢复**：强制终止某标签页的渲染进程，确认显示崩溃态且「重新加载」可恢复
- [ ] **10.4 标题**：确认 tooltip 显示完整标题、渠道后缀已清洗；**按实测的
      `document.title` 补全 `tab-title.ts` 的 `CHANNEL_TITLE_SUFFIXES`**（design
      Open Questions 的收口——当前规则是按常见形态写的，未经真机核对）
- [ ] **10.5** 数量上限（12）与开窗节流的提示文案
- [ ] **10.6** Windows 端 `setVisible` 让位行为（design 已记为风险项）

## 3. 已知未覆盖

| 项 | 说明 |
|---|---|
| E2E | 本次未跑。`test:e2e` 需起容器，且既有 E2E 从未验证过（见 `desktop-main-layer-restructure` 的待办），不在本次范围内 |
| `CHANNEL_TITLE_SUFFIXES` 规则 | 按常见标题形态写，**未经真机核对**。规则不命中只是不清洗（不会报错），由 10.4 收口 |
| Windows | 全部验证在 macOS 完成 |
