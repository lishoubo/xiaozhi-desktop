## 1. 契约与共享类型

- [x] 1.1 `shared/browser.ts`：新增 `browserTabFailureSchema`（`crashed` / `load-failed` / `unresponsive`），在 `browserTabSchema` 加 `failure` 字段，用 `nullable()` 而非 `optional()`（理由见 design D3）
- [x] 1.2 `shared/ipc-channels.ts`：`browser` 段新增 `tabOpened`（主进程 → 渲染进程事件）与 `setViewportVisible`（渲染进程 → 主进程调用）
- [x] 1.3 跑 `npm run check:types --workspace apps/desktop`，确认加字段后所有 `BrowserTab` 构造点的编译错误已暴露出来

## 2. 主进程：可见性与激活时序（修复零尺寸竞态）

- [x] 2.1 `browser-manager.ts`：新增 `viewportVisible` 字段（默认 `true`）与 `setViewportVisible(visible)`，对当前活动标签页调用 `view.setVisible()`
- [x] 2.2 `activate()` 中让新激活的视图继承 `viewportVisible` —— 让位期间打开的标签页不得盖在弹窗上（对应 spec 场景「让位期间打开新标签页」）
- [x] 2.3 `createTab()` 新增 `options.activate`（默认 `true`），为 2.5 的弹窗路径留出「只建不激活」
- [x] 2.4 `snapshot()` 补 `failure` 字段，统一构造，默认 `null`
- [x] 2.5 `setWindowOpenHandler`：改为 `createTab(..., { activate: false })` 并 `emit('tab:opened', …)`，不再在主进程内部直接 `activate`
- [x] 2.6 扩展 `tests/unit/main/browser-manager.test.ts`：给 `MockWebContentsView` 补 `setVisible` stub；覆盖「让位期间激活的新标签页不可见」与「弹窗创建的标签页不自动激活」两个行为

## 3. 主进程：故障捕获

- [x] 3.1 `bindTabEvents()` 新增 `render-process-gone` 监听：置 `failure='crashed'`、`loading=false`，记结构化日志（渠道 + 原因），广播状态
- [x] 3.2 新增 `did-fail-load` 监听：**必须过滤** `!isMainFrame` 与 `errorCode === -3`（ERR_ABORTED），否则 SPA 内部导航会大量误报（design D3）
- [x] 3.3 新增 `unresponsive` / `responsive` 监听：前者置 `failure='unresponsive'`，后者清除
- [x] 3.4 `did-start-loading` 时清除 `failure` —— 重新加载即离开故障态（对应 spec 场景「从故障中恢复」）
- [x] 3.5 扩展 `browser-manager.test.ts`：覆盖三类故障各自置位、ERR_ABORTED 不置位、重新加载后清除

## 4. 主进程：数量上限、开窗节流、关闭接管

- [x] 4.1 定义标签页总数上限常量（12，design D4），在 `createTab()` 统一校验，超限抛出可读错误；上限对所有创建路径生效，含用户主动新建
- [x] 4.2 `setWindowOpenHandler` 加每标签页开窗节流（1 秒 3 个），超限拒绝并记结构化日志
- [x] 4.3 `close()`：关闭的是活动标签页时，主进程自行接管到同渠道相邻标签页，不停留在无活动标签页状态；无相邻标签页时进入明确空态
- [x] 4.4 扩展 `browser-manager.test.ts`：覆盖达上限拒绝、节流拒绝、关闭活动标签页后的接管与空态

## 5. 主进程：退休标记落盘 —— **已撤回，无需实施**

前提有误：`retirePartition()` 的唯一调用方（`composition/app-scope.ts:150-158`）在调用前
**已经**把 `retired` 写进账本。核实过程与不采纳「收敛职责」的理由见 design D5。

- [x] 5.1 ~~新增 `markPartitionRetired` 窄回调~~ 撤回：落盘已存在
- [x] 5.2 ~~`retirePartition()` 中调用该回调~~ 撤回：同上
- [x] 5.3 ~~composition root 接线~~ 撤回：`app-scope.ts:153` 已在做
- [x] 5.4 ~~补「退休时写账本」测试~~ 撤回：无新增行为可测

## 6. IPC 与 preload

- [x] 6.1 `ipc/browser-handlers.ts`：`BrowserTabController` 接口加 `setViewportVisible`，注册对应 handler（保持「只调恰好一个 service」的边界约束）
- [x] 6.2 ~~`ota-tab/` 订阅 `tab:opened` 后中继~~ **改为 `BrowserManager` 直接 `window.webContents.send`**：`tabOpened` 是纯视图事实，与既有 `stateChanged` 同类、同一条路；`TabEventBus` 承载的是 credential 语义（登录判定/归并），把视图事件混进去反而破坏它的职责
- [x] 6.3 `preload/namespaces/browser.ts`：暴露 `setViewportVisible` 与 `onTabOpened` 订阅
- [x] 6.4 扩展 `tests/unit/main/browser-handlers.test.ts`：覆盖新 handler 的参数校验与转发

## 7. 渲染进程：让位机制改造

- [x] 7.1 `browser-ota-tabs.svelte.ts`：`suspendViewport` / `resumeViewport` 改调 `setViewportVisible`，不再下发零尺寸
- [x] 7.2 移除 `syncBounds` 里的 `#viewportSuspended` 提前返回 —— 尺寸与可见性正交后该守卫不再需要（让位期间同步尺寸已无害）
- [x] 7.3 订阅 `onTabOpened`，收到后走既有 `adopt(tab)` 完成统一收尾（进标签栏 → activate → syncBounds）
- [x] 7.4 `BrowserWorkspace.svelte` 挂载时注册该订阅，卸载时取消

## 8. 渲染进程：标题与故障态 UI

- [x] 8.1 新建 `renderer/components/browser/tab-title.ts`：`displayTabTitle(tab)` 纯函数，含渠道后缀清洗规则表与故障态/加载态占位文字（规则表可先落空表，见 design Open Questions）
- [x] 8.2 新建 `tests/unit/renderer-tab-title.test.ts`（**路径按仓库既有约定 `renderer-*.test.ts`**，非计划里写的 `renderer/` 子目录）：覆盖后缀清洗、故障态文字、空标题回退，5 例通过
- [x] 8.3 `BrowserWorkspace.svelte`：关闭按钮的 `aria-label` 改用 `displayTabTitle`，消除「关闭 正在加载…」。~~加 tooltip~~ **已按用户决策撤销**（2026-08-21）：悬停弹层扫过标签栏时会一路弹出，比截断本身更烦人；截断看不全不做额外处理
- [x] 8.4 标签宽度改为随数量弹性伸缩（少量标签时可占更大宽度）
- [x] 8.5 故障标签页显示故障样式与显式「重新加载」入口

## 9. Electron 调优

- [x] 9.1 `createTab()` 中对新建视图调 `view.setBackgroundColor('#ffffff')`（消除切换黑闪）
- [x] 9.2 `webPreferences` 加 `spellcheck: false` 与 `v8CacheOptions: 'code'`
- [x] 9.3 确认非活动标签页的背景节流现状无需改动（已由 `removeChildView` 天然生效），在 design 或代码注释中记录该结论，避免后人重复排查

## 10. 验证与收口

- [x] 10.1 跑一次全量单测 `npm run test:unit --workspace apps/desktop`，并跑 `npm run check` 与 `npm run lint`
- [ ] 10.2 真机验证零尺寸竞态已修复：打开携程标签 → 触发绑定弹窗（让位）→ 关闭弹窗 → 点携程菜单触发新开页，确认内容区正常切换
- [ ] 10.2b 真机验证让位泄漏已修复（实现中新发现，见 verification 缺陷②）：打开绑定弹窗 → **不关闭弹窗**直接从侧边栏跳走 → 回到浏览器页，确认内容区非空白
- [ ] 10.3 真机验证故障恢复：对某标签页强制终止渲染进程，确认标签页显示崩溃态且可重新加载
- [ ] 10.4 真机验证标题：~~tooltip~~ 已撤销，只需确认后缀清洗是否命中；按实测 `document.title` 校准 8.1 的规则表（Open Questions 的收口）
- [ ] 10.5 真机验证数量上限与开窗节流的提示文案
- [ ] 10.6 Windows 端验证 `setVisible` 让位行为（design 已记为风险项）
- [x] 10.7 把验证证据写入 `openspec/changes/optimize-ota-browser-tabs/verification.md`
- [ ] 10.8 本次改动触及跨模块接口（`BrowserTab` 契约、新增 IPC 通道），按完成门禁同步 `openspec/specs/`：归档时合并 `browser-tab-lifecycle` delta
