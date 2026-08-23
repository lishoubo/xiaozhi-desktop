## Context

动机见 `proposal.md — Why`；行为契约见 `specs/browser-tab-lifecycle/spec.md`。这里只记录
排查过程中确认的**现状事实**和由此推出的技术决策。

### 现状：四条链都能激活标签页，只有三条经过界面

```
链1  工作区挂载    restoreTarget ──► activateIfIdle ──► IPC activate ──► syncBounds ✅
链2  用户点标签    selectTab     ──► store.activate  ──► IPC activate ──► syncBounds ✅
链3  切换账号      switchLogin   ──► store.activate  ──► IPC activate ──► syncBounds ✅
链4  网页 window.open
     └─► setWindowOpenHandler ──► createTab ──► this.activate(id)  ❌ 主进程内部直接调用
                                                     │
                                                     └─ 界面不知情，无人 syncBounds
                                                        视图尺寸 = this.bounds 的当前值
```

链 4 是唯一绕过界面的路径，也是零尺寸视图的来源。

### 现状：让位与尺寸同步共用同一个通道

`suspendViewport` 和 `syncBounds` 都通过 `browser.setBounds` 表达意图，靠一个进程内布尔量
`#viewportSuspended` 互斥：

```ts
// browser-ota-tabs.svelte.ts —— 现状
async suspendViewport(): Promise<void> {
  this.#viewportSuspended = true;
  await window.hotelButler.browser.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

async syncBounds(): Promise<void> {
  if (this.#viewportSuspended) return;   // ← 守卫只在入口读一次
  const bounds = this.#readViewport();   // ← 此后到 IPC 落地之间，守卫可能已翻转
  await window.hotelButler.browser.setBounds(bounds);
}
```

调用点均为 `void`（不等待）：

| 位置 | 调用 |
|---|---|
| `BindHotelDialog.svelte:79` | `void browserOtaTabs.suspendViewport()` |
| `BindHotelDialog.svelte:188` | `void browserOtaTabs.resumeViewport()` |
| `ReauthDialog.svelte:80` / `:196` | 同上 |

`BindHotelDialog` 里 `suspendViewport()` 与紧随其后的 `openExistingForBinding(...)`
（内部 `adopt` → `syncBounds`）是两条并发链，无互斥。守卫读取与 IPC 落地之间存在窗口，
两个 `setBounds` 到达主进程的顺序不确定 —— 若零尺寸最后落地，视图就此不可见。

### 约束

| 约束 | 来源 |
|---|---|
| Electron 43.2.0，`View.setVisible(visible)` 可用（`electron.d.ts:15866`） | 已核实 |
| `webPreferences.spellcheck` / `v8CacheOptions` 可用（`:19293` / `:19308`） | 已核实 |
| `browserTabSchema` 是 `z.strictObject`，加字段必须同步改 schema | `shared/browser.ts:33` |
| `ipc/` 不得 import `electron`、只能调恰好一个 service | `CLAUDE.md` 分层约束 |
| `services/` 不得 import `browser/`，OTA 标签页唯一开口是 `ota-tab/` | eslint `no-restricted-paths` |
| partition 命名不变，用户无需重新登录 | `proposal.md — Impact` |

## Goals / Non-Goals

**Goals:**

- 让「视图可见性」与「视图尺寸」成为两个独立的状态，消除竞态的**结构性**来源
- 让链 4 与其他三条链走同一条收尾路径
- 标签页故障成为 `BrowserTab` 快照上的一等状态，而非只存在于日志

**Non-Goals:**

- 闲置标签页休眠（省内存但丢页面状态，OTA 后台多长表单，需产品决策后另开 change）
- 右键菜单、页内查找、缩放、快捷键补全（独立的能力增强，与本次故障修复无依赖）
- 改动 partition 命名或迁移既有登录态

## Decisions

### D1 —— 可见性用 `setVisible`，不再用零尺寸

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 保持零尺寸 + 加锁/序列号 | 不引入新 API | 竞态源仍在，锁只是压制症状；每加一条新链就要重新审一遍互斥 | ❌ |
| `removeChildView` / `addChildView` | 已有用法 | 语义是「移出视图树」，恢复时要重新 `addChildView` 并重设尺寸，回到同一个尺寸竞态 | ❌ |
| **`view.setVisible(false/true)`** | 尺寸与可见性正交，恢复不需要尺寸参与；Electron 原生语义 | 需要主进程新增一个 IPC 入口 | ✅ 采纳 |

采纳后，`#viewportSuspended` 从「守卫 syncBounds 的布尔量」降级为「记录当前让位状态」，
即使 `syncBounds` 在让位期间跑完也无害 —— 它只改尺寸，改不了可见性。

```ts
// browser-manager.ts —— 新增
setViewportVisible(visible: boolean): void {
  this.viewportVisible = visible;
  const active = this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
  active?.view.setVisible(visible);
}

// activate() 内：新激活的视图必须继承当前让位状态，
// 否则让位期间打开的标签页会盖在弹窗上
private applyVisibility(tab: ManagedTab): void {
  tab.view.setVisible(this.viewportVisible);
}
```

> ⚠️ `activate()` 必须 `applyVisibility` —— 让位期间打开新标签页时，新视图默认可见，
> 会直接盖在弹窗上。这正是 spec 里「让位期间打开新标签页」那条场景要覆盖的。

### D2 —— 链 4 改为通知界面，不在主进程内激活

```
setWindowOpenHandler
   │
   ├─ 校验 URL / 数量上限 / 开窗节流
   ├─ createTab(..., { activate: false })   ← 只建，不激活
   └─ emit 'tab:opened' ──► ota-tab 层 ──► IPC browser.tabOpened ──► 渲染进程
                                                                        │
                                                                  store.adopt(tab)
                                                                        │
                                                     ┌──────────────────┼──────────────────┐
                                                 进标签栏          IPC activate        syncBounds
```

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 主进程激活后补发一个「请同步尺寸」事件 | 改动小 | 仍是两次往返，中间那一帧仍可能零尺寸；且新增一个只为补救的事件 | ❌ |
| **新增 `browser.tabOpened` 事件，界面走标准 `adopt`** | 四条链收敛为一条收尾路径，与 spec 的「统一激活流程」一致 | 需要新增 IPC 通道与 preload 订阅 | ✅ 采纳 |

`createTab` 新增 `activate` 选项（默认 `true`，保持其余调用方行为不变）：

```ts
private createTab(
  channelId: string,
  url: string,
  partitionName: string,
  tabSession: Session,
  options: Readonly<{ activate?: boolean }> = {},
): ManagedTab
```

事件穿层遵守分层约束 —— `browser/` 只 `emit`，由 `ota-tab/` 订阅后经 `ipc/` 下发，
与既有 `tab:navigated` / `tab:closed` 同一套路，不新增跨层依赖方向。

### D3 —— 故障状态进 `BrowserTab` 快照

```ts
// shared/browser.ts
export const browserTabFailureSchema = z.enum(['crashed', 'load-failed', 'unresponsive']);

export const browserTabSchema = z.strictObject({
  // …既有字段不变
  failure: browserTabFailureSchema.nullable(),   // 新增；null = 正常
});
```

| 决策点 | 选择 | 理由 |
|---|---|---|
| 放快照 vs 单独事件 | 放快照 | 界面已订阅 `onStateChanged`，故障是标签页的**持续状态**而非瞬时事件；单独事件还要在界面侧自建一份状态表 |
| `nullable` vs `optional` | `nullable` | `strictObject` 下 `optional` 会让「字段缺失」和「无故障」两种情况都合法，界面要写两种判断。踩过一次（见 `xiaozhi-desktop-phone-sms-login-done` 记的 `nullable≠optional`） |
| 无响应是否清除 | `responsive` 事件到达时清除 | 无响应通常可自行恢复，不像崩溃需要用户介入 |

`did-fail-load` 必须过滤：

```ts
webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
  // -3 = ERR_ABORTED：SPA 内部导航会大量产生，计为故障会让提示失去意义
  if (!isMainFrame || errorCode === -3) return;
  …
});
```

### D4 —— 数量上限与开窗节流的取值

| 项 | 取值 | 理由 |
|---|---|---|
| 标签页总数上限 | 12 | 每个标签页 ≈ 一个渲染进程（80–150MB）；12 个约 1–1.8GB，是 8GB 机器上仍可用的上界 |
| 开窗节流窗口 | 每标签页 1 秒内最多 3 个 | 正常用户点击达不到；失控循环第一秒即被拦住 |
| 超限行为 | 拒绝 + 界面提示 | spec 明确要求不得静默丢弃 |

上限对**所有**创建路径生效（含用户主动新建），否则用户仍能绕过它把内存耗尽。

### D5 —— 退休标记落盘：**撤回，本次不做**

初稿基于「`retirePartition()` 只写内存 `Set`，重启即丢」提出补落盘。**该前提有误**，
实现阶段核实后撤回。

读 `BrowserManager.retirePartition()` 本身确实只看到内存 Set，但它在全仓只有一个调用方，
而那里已经落过盘了：

```ts
// composition/app-scope.ts —— 现状，无需改动
onCredentialPartitionReplaced: async (previousPartitionName) => {
  // 先落账本再清理：清理可能因「仍有标签页占用」而推迟，甚至跨重启才完成。
  await updatePartitionState(userDataDir, previousPartitionName, {
    kind: 'retired', retiredAt: new Date().toISOString(),
  });
  await retirePartition?.(previousPartitionName);   // ← 才进 BrowserManager
},
```

| 核实项 | 结果 |
|---|---|
| `retirePartition` / `setPartitionRetirer` 的调用方 | 全仓仅 `app-scope.ts:157` 一处 |
| 该调用方是否先落盘 | 是（`app-scope.ts:153`），且注释写明了同一条理由 |
| 是否存在绕过落盘的路径 | 未发现 |

**教训**：只读被改的那个函数不足以判断缺陷是否存在，必须追到调用方。这条与
`feedback-diagnose-before-proposing` 记的是同一件事。

曾考虑把落盘责任收敛进 `BrowserManager`（删掉 app-scope 那次写入），**不采纳**：那是为
观感去改一条真机验证过的正确路径，而这条路径上一轮刚出过 partition 误清事故，不该无故再动。

### D6 —— 标题清洗按渠道配置，放渲染进程

| 方案 | 结论 |
|---|---|
| 主进程 `snapshot()` 里清洗 | ❌ `browser/` 不认识渠道，清洗规则是渠道知识 |
| `channels/` 各自导出规则、主进程调用 | ❌ 为一个纯展示问题拉一条主进程跨层依赖 |
| **渲染进程展示前清洗** | ✅ 采纳。纯展示逻辑，规则表与 `ota-channels` 同层，且可纯函数测试 |

```ts
// renderer/components/browser/tab-title.ts
const CHANNEL_TITLE_SUFFIXES: Record<string, readonly RegExp[]> = { … };
export function displayTabTitle(tab: BrowserTab): string
```

故障态标题也在这里统一产出，避免界面多处拼字符串 —— spec 要求辅助文本与显示文本同源，
不得出现「关闭 正在加载…」。

### D7 —— Electron 调优项（低风险，随本次一并做）

| 项 | 做法 | 收益 |
|---|---|---|
| 切换黑闪 | `view.setBackgroundColor('#ffffff')` | 视觉 |
| 拼写检查 | `webPreferences.spellcheck: false` | 每标签页省一点内存，OTA 后台用不到 |
| V8 代码缓存 | `webPreferences.v8CacheOptions: 'code'` | 重复打开同一 OTA 页面时 JS 编译更快 |

**背景节流无需处理**：非活动标签页已被 `removeChildView` 移出视图树，Chromium 天然按
后台处理，现状已正确。

**不采纳**：iframe 化多渠道、共用 partition —— 会摧毁既有的登录态隔离。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| `setVisible` 在部分平台行为与预期不符（本次只在 macOS 真机验证，Windows 目标已在规划中） | 保留 `removeChildView` 作为激活/关闭路径的既有机制不动，`setVisible` 只承担让位；Windows 端到端验证列入任务 |
| 上限 12 对重度用户偏紧 | 上限定义为单一常量，提示语明确告知已达上限；若真机反馈偏紧只需改常量 |
| `browserTabSchema` 加字段后，preload 校验会拒绝旧形状快照 | 主进程与 preload 同批发布，无跨版本通信；`snapshot()` 是唯一构造点，统一补 `failure: null` |
| 链 4 改为异步通知后，新标签页出现在界面上有轻微延迟 | 用户感知与手动新建标签页一致（同一条路径）；避免了零尺寸这一更严重的失败模式 |
| 故障态误报（把正常中止当失败）反而制造噪音 | 明确过滤 `ERR_ABORTED` 与非主框架；spec 已将其固化为可测场景 |

## Migration Plan

无数据迁移：partition 命名不变，账本 schema 不变（`retired` 是既有状态值），
`BrowserTab` 新增字段为进程内契约。回滚即回滚代码。

## Open Questions

- 标题后缀清洗的具体正则需在真机上抓取三个渠道后台的实际 `document.title` 后确定。
  不阻塞实现：规则表可先落空表（等价于不清洗），逐渠道补充，不影响接口与任务拆分。
