## Why

OTA 标签页出现过一个无法复现的真机故障：点击携程菜单后标签标题变了、页面却没切换。代码审查定位到根因是「让位内容区」与「打开新标签页」两条异步链竞态，最终落地的 `setBounds` 可能是零尺寸——标签在、视图零尺寸，表现为标题更新但看不见内容。同一轮扫描还发现标签页缺少崩溃与加载失败的恢复路径（第三方 OTA 页面崩溃后只剩白板）、标题截断后无从查看全名、以及网页可无限制自行开标签页。

## What Changes

- **修复零尺寸竞态**：内容区让位改用 `View.setVisible(false)`，不再靠 `setBounds({0,0,0,0})` 表达「暂时不可见」，消除与 `syncBounds` 的乱序竞争
- **网页自开标签页纳入统一流程**：`setWindowOpenHandler` 创建的标签页不再由主进程直接激活，改为通知渲染进程走与其他入口相同的收尾流程（进标签栏 → 激活 → 同步视口尺寸）
- **补齐标签页故障恢复**：新增渲染进程崩溃、主框架加载失败、页面无响应三类事实的捕获与上报，界面提供显式重新加载入口
- **标签标题可读性**：补 tooltip、按渠道清洗冗余标题后缀、标签宽度随数量弹性伸缩
- **标签页数量上限与弹窗节流**：限制同时打开的标签页总数，并对网页自身连续开窗做节流
- **Electron 层调优**：标签页视图设置背景色（消除切换黑闪）、关闭拼写检查、启用 V8 代码缓存

## Capabilities

### New Capabilities

- `browser-tab-lifecycle`: 标签页视图从创建、激活、让位、故障到关闭的完整生命周期——谁负责激活、视图何时可见、崩溃与加载失败如何呈现、数量上限如何约束。与 `browser-partition-lifecycle` 的分工：那份规范定义「标签页用哪份登录态」，本能力定义「标签页这个视图本身如何被管理」

### Modified Capabilities

无。

> 提案初稿曾列入 `browser-partition-lifecycle`，理由是「退休标记只存在于进程内存、重启即丢」。
> **该判断有误，已在实现阶段核实并撤回**：`BrowserManager.retirePartition()` 确实只写内存 Set，
> 但它在全仓只有一个调用方（`composition/app-scope.ts` 的 `onCredentialPartitionReplaced`），
> 而该调用方在调它之前**已经**把 `retired` 写进了账本。落盘早在上一轮就做过了，本次无需改动。

## Impact

| 范围 | 影响 |
|---|---|
| `apps/desktop/src/main/browser/browser-manager.ts` | 视图可见性、激活时序、故障事件、数量上限 |
| `apps/desktop/src/main/ota-tab/` | 网页自开标签页的通知通道 |
| `apps/desktop/src/main/ipc/browser-handlers.ts` | 新增「标签页已由主进程创建」事件与重新加载入口 |
| `apps/desktop/src/shared/browser.ts` | `BrowserTab` 快照新增故障状态字段 |
| `apps/desktop/src/renderer/components/browser/` | 让位机制改造、标题渲染、故障态 UI、标签宽度 |

无 **BREAKING**：`BrowserTab` 新增的 `failure` 是进程内契约（主进程与 preload 同批发布，
无跨版本通信），partition 命名规则不变，用户无需重新登录。
