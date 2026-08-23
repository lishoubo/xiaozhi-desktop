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

## 2. 真机验证（部分完成，2026-08-21）

dev 环境跑起过一轮（`npm run dev:desktop`，环境 `dev`，变体 `staff`）。

### 已确证

| 项 | 证据 |
|---|---|
| 标签页正常打开 / 关闭 / 新建 | 日志事件序列：`Browser tab created` → `Browser tab closed` → `Browser tab created` |
| **ERR_ABORTED 不误报故障** | 日志出现 `errorCode: -3`，同时**没有** `main frame failed` —— 过滤在真机生效。这是 3.2 那道过滤的真实证据 |

### 未验证（应用已关闭，需下次开机补）

以下都是**故障路径或多标签场景，正常使用碰不到**，本轮没有触发：

| 项 | 为什么没验到 |
|---|---|
| 10.2 零尺寸竞态（原始故障） | 未触发绑定弹窗 |
| 10.2b 让位泄漏 | 同上 |
| 10.3 崩溃恢复 | 未执行 `process.crash()` |
| 10.5 数量上限 / 开窗节流 | 全程只开过 2 个标签页，远未到 12 |
| 关闭接管（4.3） | 关闭时只有 1 个标签页，走的是「进入空态」分支，接管分支未触及 |
| 10.6 Windows | 未做 |

**不得据此声称这些行为已通过。** 单元测试覆盖了它们的逻辑（含反证），但真机行为未观测。

### 本轮产生的两项产品决策

**① 标签页 tooltip：撤销**

原实现给标签加了 `title` 属性做原生 tooltip。真机上**没有生效** —— `title` 加在外层
`div`，而内层 `<button>` 铺满整个标签、盖在其上，鼠标实际悬停的是 button，原生 tooltip
只认自身元素的 `title`。

定位到该 bug 后，用户决定**不修、直接撤掉**：悬停弹层在标签栏上扫过时会一路弹出，比
截断本身更烦人。「标题截断看不全」不做额外处理（用户明确选择「就这样，不用管」）。

保留的部分：关闭按钮 `aria-label` 走 `displayTabTitle`（消除「关闭 正在加载…」）、
故障态显示「页面已崩溃」而非崩溃前旧标题、标签弹性宽度。

**② 后缀清洗规则：清空，等真机数据**

`CHANNEL_TITLE_SUFFIXES` 原本按常见形态猜了一版（如 `/\s*[-—|]\s*携程.*$/`），
**未经真机核对**。tooltip 撤销后风险显著升高：规则误伤时，被删掉的部分用户再也无从
查看。「删错了看不见」比「后缀没清掉」严重得多，因此清空规则表（等价于不清洗），
等实测 `document.title` 后逐渠道补。

对应地，两个断言清洗结果的测试改为断言「规则为空时原样返回」——测试跟着真实行为走，
不为已删除的功能保留绿灯。

## 3. 已知未覆盖

| 项 | 说明 |
|---|---|
| E2E | 本次未跑。`test:e2e` 需起容器，且既有 E2E 从未验证过（见 `desktop-main-layer-restructure` 的待办），不在本次范围内 |
| `CHANNEL_TITLE_SUFFIXES` 规则 | **已清空**，等真机 `document.title` 再补（理由见上）。当前行为＝不清洗 |
| Windows | 全部验证在 macOS 完成 |
