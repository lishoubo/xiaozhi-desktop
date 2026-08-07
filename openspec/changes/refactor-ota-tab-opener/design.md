## Context

现状事实基础（已完成的只读调查，本设计直接引用，不重新调查）见 `openspec/changes/add-hotel-management-page/ota-tab-opening-audit.md`。核心问题：

| 入口 | 当前实现 | 挂登录判定？ |
|---|---|---|
| `otaCredential.openForNewLogin` | `LoginTabOpener.open()` → `BrowserManager.createAndNewPartition` | 是 |
| `otaCredential.openWithImportedCookie` | `LoginTabOpener.createFromCookie()` → 同上 | 是 |
| `otaCredential.openExisting` | 裸调 `BrowserManager.createWithAlreadyPartition`，不传 options | **否** |
| `browser.create`（历史遗留） | 裸调 `BrowserManager.create()` | 否 |

`checkUrlPastLogin` 的时序约束（历史踩坑，`split-ota-hotel-prob-feature` 变更记录）：判定结果必须等 discovery 写库完成才广播，否则 `OtaHotelProbFeature` 会查到 `null` 永久错过探测机会。本设计延续这条约束，只搬运载体，不改变时机语义。

## Goals / Non-Goals

**Goals:**

- `BrowserManager` 只保留"开/关/导航/显示 tab"的容器能力，不出现任何登录/credential/discovery 相关类型或字段。
- 登录判定（URL 匹配、去重、触发 discovery、结果广播）整体收口到 `OtaTabOpener`。
- 4 个开 OTA 标签页的 IPC 入口统一经过 `OtaTabOpener`，`openExisting` 补齐判定能力缺口，namespace 统一改为 `otaTab.*`（含 renderer 调用点同步改名，见决策 4）。

**Non-Goals:**

- 不设计 `intent` 的具体 union 内容（留给 Part B），本次只留类型占位。
- 不改动 `installRequestInterceptor` 里硬编码的携程 API 拦截逻辑。
- 不改动 `DiscoverAndCreate`/`DiscoveryProbe`/`HotelProbe` 内部实现。

## Decisions

### 1. 事件模型：BrowserManager 广播原始事实，OtaTabOpener 自行判定

```
                     did-navigate / did-navigate-in-page
                                  │
                                  ▼
                        BrowserManager (EventEmitter)
                        emit 'tab:navigated'
                        { tabId, partitionName, channelId, url, webContents }
                                  │
                     close(tabId) 时 emit 'tab:closed' { tabId }
                                  │
                                  ▼
                          OtaTabOpener（订阅方）
                    tabId → { channel, loginUrlMatcher, triggered }
                                  │
                    命中登记表 → isPastLogin? → 未触发过?
                                  │ 是
                                  ▼
                      triggerDiscovery(...) 写库完成
                                  │
                                  ▼
                    OtaTabOpener 广播 'tab:credential-checked'
                    （OtaHotelProbFeature 继续订阅，行为不变）
```

`BrowserManager` 新增一个真正的进程内 `EventEmitter`（区别于 `webContents.send` 的 IPC 广播，那是发往 renderer 的）。`tab:navigated`/`tab:closed` 只描述发生了什么，不做任何"是否登录"的判断。

| 候选方案 | 说明 | 结论 |
|---|---|---|
| A. 原始事件总线（选定） | `BrowserManager` 广播导航/关闭事实，`OtaTabOpener` 订阅并自行维护状态、判定、触发、广播 | 采用：`BrowserManager` 零登录语义，多订阅方（`OtaTabOpener` + 未来其他 Feature）天然可扩展 |
| B. 单一回调合并 | 把 `loginUrlMatcher`+`onUrlPastLogin`+去重+广播合并成一个 `onNavigate` 回调，`BrowserManager` 无条件调用 | 否决：本质仍是"调用方传回调"，`BrowserManager` 每个 tab 仍要存一份回调引用；且只支持单一订阅方，`OtaHotelProbFeature` 想独立订阅判定结果就没有载体 |

### 2. ManagedTab 瘦身，登录状态搬到 OtaTabOpener 自己的 Map

```ts
// browser-manager.ts —— 登录判定相关字段全部移除
type ManagedTab = {
  id: string;
  channelId: string;
  title: string;
  url: string;
  loading: boolean;
  view: WebContentsView;
  partitionName: string;
  // 不再有 onUrlPastLogin / loginUrlMatcher / urlPastLoginTriggered
};
```

```ts
// ota-tab-opener.ts
type LoginTabState = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
}>;

class OtaTabOpener {
  private readonly loginTabs = new Map<string, LoginTabState>();
  private readonly triggered = new Set<string>(); // tabId，去重用
  // ...
}
```

`openExisting`/`browser.create`（view-only 场景）不调用登记方法，`loginTabs.get(tabId)` 返回 `undefined`，事件到达时直接跳过判定——等价于现状 `checkUrlPastLogin` 里"未挂 `loginUrlMatcher`"分支，语义不变，只是判断主体换了。

`tab:closed` 事件到达时 `OtaTabOpener` 清理 `loginTabs`/`triggered` 里对应 `tabId` 的条目，避免内存泄漏（现状此清理是免费的，因为状态挂在 `ManagedTab` 上随 `tabs.delete(tabId)` 一起回收；搬家后必须显式补上，是本次唯一新增的清理职责）。

### 3. OtaTabOpener 方法与 BrowserManager 开 tab 方法一一对应

```ts
class OtaTabOpener {
  // 取代 LoginTabOpener.open()
  async openForNewLogin(env, channel, url): Promise<BrowserTab>

  // 取代 LoginTabOpener.createFromCookie()
  async openWithImportedCookie(env, channel, url): Promise<BrowserTab>

  // 取代裸调用 createWithAlreadyPartition；intent 类型占位，不 import 具体 union
  openExisting(credentialId: OtaCredentialId, intent?: unknown): Promise<BrowserTab>

  // 取代裸调用 manager.create；view-only，不登记判定状态
  openView(channelId: string, url: string): BrowserTab
}
```

`openForNewLogin`/`openWithImportedCookie` 内部调用 `browserManager.createAndNewPartition(...)` 拿到 `{ tab, partitionName }` 后，登记 `loginTabs.set(tab.id, { channel, loginUrlMatcher })`；`openExisting` 传了 `intent` 才登记，不传维持现状（不登记）；`openView` 从不登记。

### 4. IPC 层拆分 + namespace 改名

```
apps/desktop/src/main/ipc/
├── browser-handlers.ts      瘦身：activate/close/goBack/goForward/reload/
│                             list/setBounds/setAudioMuted/hide/
│                             acknowledgeInterception + cookies.*
└── ota-tab-handlers.ts      新增：openForNewLogin/openWithImportedCookie/
                              openExisting/openView（原 browser.create）
                              （全部委托给同一个 OtaTabOpener 实例）
```

这批入口全部是"打开 OTA 标签页"，`otaCredential` 前缀名不副实（真正的 credential 查询/事件在别处），**改用 `otaTab` namespace**，与 `OtaTabOpener`/`ota-tab-handlers.ts` 命名对齐：

```ts
// shared/ipc-channels.ts
otaCredential: {
  listByChannel: 'ota-credential:list-by-channel',       // 不变：纯 credential 查询
  discoveryCompleted: 'ota-credential:discovery-completed', // 不变：纯事件
},
otaTab: {                                                  // 新增 namespace
  openExisting: 'ota-tab:open-existing',
  openForNewLogin: 'ota-tab:open-for-new-login',
  openWithImportedCookie: 'ota-tab:open-with-imported-cookie',
  openView: 'ota-tab:open-view',                          // 取代 browser.create
},
```

`browser.create` 整个 channel 废弃，改名为 `otaTab.openView`——它现状的唯一调用方是"打开 OTA 渠道页面"，本质也是本次收编范围内的场景，没有理由留在 `browser` namespace 下单独存在。**这是本次唯一波及 renderer 的改动**（重命名，非行为变更）：

| 层 | 改动 |
|---|---|
| `preload/api.ts` | `otaCredential.{openExisting,openForNewLogin,openWithImportedCookie}` 挪到新增的 `otaTab` namespace；`browser.create` 方法挪到 `otaTab.openView` |
| `BrowserWorkspace.svelte` | `window.hotelButler.otaCredential.openForNewLogin/openExisting/openWithImportedCookie` → `window.hotelButler.otaTab.*`；`listByChannel` 保留在 `otaCredential` 不变 |
| `CookieLoginListDialog.svelte` | 同上，`openWithImportedCookie` 调用点改 namespace |

`browser.create` handler 的实现从 `manager.create(channelId, url)` 改为 `otaTabOpener.openView(channelId, url)`；内部走 `BrowserManager.createWithAlreadyPartition(LEGACY_SHARED_PARTITION, ...)`，行为等价现状的 `@deprecated create()`。

### 5. 装配变更（application.ts）

```ts
// 现状：TabEventBus 平行注入给 BrowserManager 和 OtaHotelProbFeature
const tabEventBus = new TabEventBus();
browserManager = new BrowserManager(mainWindow, log, sessionFactory, tabEventBus);
new OtaHotelProbFeature({ tabEventBus, ... });

// 重构后：BrowserManager 不再接受 TabEventBus；OtaTabOpener 持有它、
// 对外广播判定结果，OtaHotelProbFeature 订阅同一个 TabEventBus 实例（不变）
browserManager = new BrowserManager(mainWindow, log, sessionFactory);
const tabEventBus = new TabEventBus();
const otaTabOpener = new OtaTabOpener({
  browserManager,               // 订阅 tab:navigated / tab:closed
  tabEventBus,                  // 广播 tab:credential-checked
  loginUrlMatchers: LOGIN_URL_MATCHERS,
  triggerDiscovery: (...) => discoverAndCreate.trigger(...),
  userDataDir,
});
new OtaHotelProbFeature({ tabEventBus, ... }); // 不变
```

`BrowserManager` 构造函数签名去掉第 4 参 `tabEventBus`（**BREAKING，内部**）。`TabEventBus` 类型定义不变，仍是 `tab:credential-checked` 单一事件——只是发布方从 `BrowserManager` 换成 `OtaTabOpener`。

### 6. 文件搬移

| 现状路径 | 新路径 | 说明 |
|---|---|---|
| `main/features/ota-credential/login-tab-opener.ts` | 删除 | 被 `OtaTabOpener` 取代，不留兼容层 |
| `main/features/ota-credential/login-url-matcher.ts` | `main/features/ota-tab-opener/login-url-matcher.ts` | 唯一消费者是开 tab，随职责搬家 |
| （新增） | `main/features/ota-tab-opener/ota-tab-opener.ts` | 本次新建 |
| `main/browser/tab-event-bus.ts` | 不变 | 类型定义不变，只是不再被 `BrowserManager` import |

`openspec/changes/add-hotel-management-page/ota-tab-opening-audit.md`、`ota-tab-opener-refactor-status.md` 两份讨论记录在本变更完成归档后视为已被本 design 取代，届时删除或在 Part B 恢复时按需摘录。

## Risks / Trade-offs

- [Risk] `BrowserManager` 新增 `EventEmitter` 是净新增的基础设施复杂度 → Mitigation：只有两个事件类型（`tab:navigated`/`tab:closed`），payload 是已有字段的直接透传，不引入新状态。
- [Risk] `openExisting` 新增 `intent?: unknown` 参数，类型上不安全 → Mitigation：本次只占位，`unknown` 强制未来消费者做类型收窄，不会被误用为已定义的业务类型；Part B 落地时替换为具体 union。
- [Risk] 测试大面积改动（`browser-manager-partitions.test.ts` 里直接操纵 `did-navigate` handler 驱动判定逻辑的 mock 手法失效）→ Mitigation：`tasks.md` 里按文件列出改动，判定逻辑测试整体搬到新的 `ota-tab-opener.test.ts`，`BrowserManager` 测试改为验证事件广播本身（是否 emit、payload 是否正确），不再驱动判定。

## Migration Plan

单次提交内完成（无需灰度/回滚设计——内部重构，IPC 契约不变，行为等价）。顺序：

1. `BrowserManager` 加事件广播 + 瘦身 `ManagedTab`（先加后删：新事件先跑通，再删登录判定代码，避免中间态编译不过）
2. 新建 `OtaTabOpener` + 搬移 `login-url-matcher.ts`
3. 新建 `ota-tab-handlers.ts`，瘦身 `browser-handlers.ts`
4. `application.ts` 装配变更
5. 删除 `login-tab-opener.ts`
6. 测试同步（搬移/重写受影响用例）
