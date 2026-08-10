# OTA 标签页打开现状梳理

供 Part B（酒店绑定探测流程）设计参考的事实梳理，不含方案。所有引用均为只读调查，行号以调查时代码为准。

## 1. 三个"打开标签页" IPC 入口

`apps/desktop/src/main/ipc/browser-handlers.ts`，`registerBrowserHandlers` 内实例化一个模块内私有 `LoginTabOpener`（80-85 行）：

```ts
const loginTabOpener = new LoginTabOpener({
  userDataDir,
  browser: manager,
  loginUrlMatchers,
  triggerDiscovery,
});
```

| IPC channel | Handler 位置 | 调用链下一层 |
|---|---|---|
| `otaCredential.openForNewLogin` | 171-177 行 | `loginTabOpener.open(environment, channel, url)` → `BrowserManager.createAndNewPartition` |
| `otaCredential.openWithImportedCookie` | 178-184 行 | `loginTabOpener.createFromCookie(environment, channel, url)` → `BrowserManager.createAndNewPartition`（预写入 cookie） |
| `otaCredential.openExisting` | 191-206 行 | **不经过 `LoginTabOpener`**，直接 `manager.createWithAlreadyPartition(credential.partitionName, credential.channel, url)`，不传任何 options |

`openExisting` 完整实现：

```ts
handle(
  IPC_CHANNELS.otaCredential.openExisting,
  z.tuple([otaCredentialIdSchema]),
  '登录凭据标识无效',
  (_event, credentialId) => {
    const credential = otaCredentialRepository.findById(toOtaCredentialId(credentialId));
    if (!credential) throw new Error('未找到该登录凭据');
    const url = otaChannelLandingUrl(credential.channel);
    logger.info('Opening existing OTA credential', { credentialId, channel: credential.channel, url });
    return manager.createWithAlreadyPartition(credential.partitionName, credential.channel, url);
  },
);
```

三者对比：前两者都走 `LoginTabOpener` → `createAndNewPartition`（新建 partition，挂 `loginUrlMatcher`/`onUrlPastLogin`，记 pending partition）；`openExisting` 是唯一直连 `BrowserManager.createWithAlreadyPartition` 的入口（复用已有 partition，不挂任何登录判定回调）。

## 2. `LoginTabOpener` 类（`main/features/ota-credential/login-tab-opener.ts`，107 行）

`LoginTabOpenerDependencies`（31-50 行）：

```ts
type LoginTabOpenerDependencies = Readonly<{
  userDataDir: string;
  browser: Pick<BrowserManager, 'createAndNewPartition'>;  // 类型上只能调用 createAndNewPartition
  loginUrlMatchers: ReadonlyMap<ChannelId, LoginUrlMatcher>;
  triggerDiscovery: (partitionName, channel, landingUrl, webContents) => Promise<OtaCredential | null>;
}>;
```

两个公开方法，options 结构几乎相同（只差是否传 `importedCookies`），都调用同一底层方法 `createAndNewPartition`：

- `open(environment, channel, url)`（55-73 行）：不传 `importedCookies`，挂 `loginUrlMatcher`/`onUrlPastLogin`，成功后 `addPendingPartition`。
- `createFromCookie(environment, channel, url)`（81-106 行）：先 `readImportedCookies`，无则抛错；有则传入 `importedCookies`，其余与 `open()` 一致。

文件头注释记录了历史决策：曾有 `onLoadFinished` 专用触发通道，因不经过 `checkUrlPastLogin`/`TabEventBus` 导致探测被静默跳过，已删除——现在统一走 `loginUrlMatcher` 判据。

`LoginTabOpener` 目前**没有**"打开已有账号"的方法，`openExisting` 现状是绕开它、直连 `BrowserManager`。

## 3. `BrowserManager` 的 `create*` 方法与 `ManagedTab`

`apps/desktop/src/main/browser/browser-manager.ts`

| 方法 | 签名要点 | 语义 |
|---|---|---|
| `create(channelId, url)`（102-104 行） | `@deprecated`，内部调用 `createWithAlreadyPartition(LEGACY_SHARED_PARTITION, ...)` | 弹窗兜底（`setWindowOpenHandler`）、IPC `browser.create` 用 |
| `createWithAlreadyPartition(partitionName, channelId, url, options?)`（113-132 行） | 同步返回 `BrowserTab`；`options` 支持 `onUrlPastLogin?`/`loginUrlMatcher?`，**不支持** `importedCookies` | 复用已存在 partition/session（`sessionFactory.sessionForAccount`） |
| `createAndNewPartition(environment, channelId, url, options?)`（141-167 行） | 异步，返回 `{ tab, partitionName }`；`options` 支持 `importedCookies?`/`onUrlPastLogin?`/`loginUrlMatcher?` | 新建 partition/session（`sessionFactory.sessionForLogin`） |

两者共用私有方法 `createTab(...)`（169-219 行），负责创建 `WebContentsView`、`bindTabEvents`、`loadURL`。**没有**其他 `create*` 方法，也**没有**任何方法或 `ManagedTab` 字段支持挂载额外自定义数据（如 intent）。

`ManagedTab`（29-48 行）：

```ts
type ManagedTab = {
  id: string;
  channelId: string;
  title: string;
  url: string;
  loading: boolean;
  view: WebContentsView;
  partitionName: string;
  onUrlPastLogin?: OnUrlPastLogin;
  loginUrlMatcher?: LoginUrlMatcher;
  urlPastLoginTriggered: boolean;
};
```

对外快照 `BrowserTab`（`shared/browser.ts:33-42`）字段：`id, channelId, title, url, canGoBack, canGoForward, loading, partitionName`——`onUrlPastLogin`/`loginUrlMatcher`/`urlPastLoginTriggered` 不会暴露到 renderer。

## 4. 登录判定触发机制

### 4.1 事件监听注册（`bindTabEvents`，370-419 行）

```ts
webContents.on('did-navigate', (_event, url) => {
  tab.url = url;
  void this.checkUrlPastLogin(tab, url, webContents);
  this.emit(tab);
});
webContents.on('did-navigate-in-page', (_event, url) => {
  tab.url = url;
  void this.checkUrlPastLogin(tab, url, webContents);
  this.emit(tab);
});
```

`checkUrlPastLogin` 由 Electron `did-navigate` / `did-navigate-in-page` 触发，每次导航（含 SPA 内部路由变化）都调用一次；首次 `loadURL` 本身不直接触发，要靠导航事件。

### 4.2 `checkUrlPastLogin` 完整实现（434-474 行）

```ts
private async checkUrlPastLogin(tab: ManagedTab, url: string, webContents: WebContents): Promise<void> {
  const baseEvent = { tabId: tab.id, partitionName: tab.partitionName, channel: tab.channelId, url, webContents };

  if (tab.urlPastLoginTriggered) {
    this.tabEventBus.emitCredentialChecked({ ...baseEvent, outcome: { kind: 'not-applicable' } });
    return;
  }
  if (!tab.loginUrlMatcher || !tab.onUrlPastLogin) {
    this.tabEventBus.emitCredentialChecked({ ...baseEvent, outcome: { kind: 'not-applicable' } });
    return;
  }
  const isPastLogin = tab.loginUrlMatcher.isPastLogin(url);
  if (!isPastLogin) {
    this.tabEventBus.emitCredentialChecked({ ...baseEvent, outcome: { kind: 'not-yet-past-login' } });
    return;
  }

  tab.urlPastLoginTriggered = true;
  const credential = await tab.onUrlPastLogin(tab.partitionName, url, tab.view.webContents);
  this.tabEventBus.emitCredentialChecked({ ...baseEvent, outcome: { kind: 'checked', credential } });
}
```

分支：
1. 已触发过 → 广播 `not-applicable`，短路。
2. 未挂 `loginUrlMatcher`/`onUrlPastLogin`（如 `openExisting` 打开的标签页）→ 广播 `not-applicable`。
3. 挂了但 URL 未命中登录后判据 → 广播 `not-yet-past-login`。
4. 命中 → 置位 `urlPastLoginTriggered = true`（保证每个标签页最多调用一次 `onUrlPastLogin`）→ await `onUrlPastLogin` → 广播 `{ kind: 'checked', credential }`。

### 4.3 `loginUrlMatcher` 与 `onUrlPastLogin` 职责区分

- **`loginUrlMatcher`**：`LoginUrlMatcher` 接口（`domain/ports/discovery.ts:13-16`），纯判定 `isPastLogin(url): boolean`，零副作用。渠道实现在 `main/features/ota-credential/ota/{ctrip,douyin,meituan}/login-url-matcher.ts`，注册表在 `main/features/ota-credential/login-url-matcher.ts`。
- **`onUrlPastLogin`**：命中后的副作用回调，返回 `Promise<OtaCredential | null>`。目前唯一实现是 `LoginTabOpener` 包装的 `triggerDiscovery`（→ `DiscoverAndCreate.trigger`）。

### 4.4 `TabCredentialCheckedEvent` payload（`tab-event-bus.ts:26-38`）

```ts
type CredentialCheckOutcome =
  | Readonly<{ kind: 'not-applicable' }>
  | Readonly<{ kind: 'not-yet-past-login' }>
  | Readonly<{ kind: 'checked'; credential: OtaCredential | null }>;

type TabCredentialCheckedEvent = Readonly<{
  tabId: string;
  partitionName: string;
  channel: string;
  url: string;
  webContents: WebContents;
  outcome: CredentialCheckOutcome;
}>;
```

无 intent 字段。

## 5. `TabEventBus`（`main/browser/tab-event-bus.ts`）

唯一事件类型：字符串字面量 `'tab:credential-checked'`（无枚举常量）。

```ts
class TabEventBus extends EventEmitter {
  emitCredentialChecked(event: TabCredentialCheckedEvent): void {
    this.emit('tab:credential-checked', event);
  }
}
```

文件头注释：不在 `did-navigate` 那一刻广播，而是等 credential 真正写入数据库后才广播，避免下游订阅者查到 null 而永久错过探测机会。

**唯一订阅点**：`main/features/ota-hotel-prob/ota-hotel-prob-feature.ts:25`

```ts
this.deps.tabEventBus.on('tab:credential-checked', (event: TabCredentialCheckedEvent) => {
  void this.onCredentialChecked(event);
});
```

构造函数内完成订阅，`application.ts:89-94` 在 `openMainWindow()` 中 `new OtaHotelProbFeature({...})` 时触发（不持有实例变量，靠闭包存活）。

`TabEventBus` 实例本身在 `application.ts:75` 创建，第 76 行传给 `new BrowserManager(mainWindow, log, sessionFactory, tabEventBus)`（`BrowserManager` 构造函数第 4 参，默认值也是 `new TabEventBus()`，但生产环境走显式传入的同一实例，确保和 `OtaHotelProbFeature` 共用总线）。

## 6. `otaChannelLandingUrl`（`domain/policy/ota-channel-landing-url-policy.ts`，32 行）

```ts
const CHANNEL_DEFAULT_URLS: ReadonlyMap<string, string> = new Map([
  ['ctrip', CTRIP_MANAGEMENT_URL],
  ['douyin', DOUYIN_HOME_URL],
  ['meituan', MEITUAN_HOME_URL],
]);

function otaChannelLandingUrl(channel: ChannelId): string {
  const defaultUrl = CHANNEL_DEFAULT_URLS.get(channel);
  if (!defaultUrl) throw new UnsupportedChannelForLandingUrlError(channel);
  return defaultUrl;
}
```

纯静态映射，channel → 固定 URL 常量，语义是"给定渠道应该打开哪个 URL"（**输出**一个 URL），与"判断当前 URL 是否已是登录后首页"（**判断**一个已有 URL 的状态，即 `LoginUrlMatcher.isPastLogin`）是不同方向的两个接口。唯一使用点：`browser-handlers.ts:18`（import）、198 行（`openExisting` 调用）。

## 7. Renderer / Preload 层现状

### 7.1 `preload/api.ts` 的 `otaCredential` namespace（110-116 行类型，206-225 行实现）

```ts
otaCredential: Readonly<{
  listByChannel: (channelId: string) => Promise<OtaCredentialDto[]>;
  openExisting: (credentialId: string) => Promise<BrowserTab>;
  openForNewLogin: (input: StartLoginInput) => Promise<BrowserTab>;
  openWithImportedCookie: (input: StartLoginInput) => Promise<BrowserTab>;
  onDiscoveryCompleted: (listener: (event: OtaDiscoveryCompletedEvent) => void) => () => void;
}>;
```

对应 IPC channel 全集见 `shared/ipc-channels.ts:33-39`。`onDiscoveryCompleted` 对应主进程 `discoveryCompleted` channel，在 `application.ts:180-184` 的 `onAccountBound` 回调里广播。

### 7.2 Renderer 调用汇总

| 调用点 | 方法 | 触发 UI 交互 |
|---|---|---|
| `BrowserWorkspace.svelte:82`（`createTab`） | `openForNewLogin` | 渠道栏"新建账号"（经 `AccountSwitcherDialog` 的 `onNewLogin` 回调间接触发） |
| `BrowserWorkspace.svelte:134`（`openExistingCredentialTab`，被 179/203 两处复用） | `openExisting` | 179 行：为当前已选中账号新开标签页；203 行：账号切换对话框选中已有账号且当前未打开标签页 |
| `BrowserWorkspace.svelte:228`（`loginFromImportedCookiesForActiveChannel`） | `openWithImportedCookie` | 经 `AccountSwitcherDialog` 的 `onCookieImport` 回调间接触发 |
| `CookieLoginListDialog.svelte:76`（`loginWithCookie`） | `openWithImportedCookie` | 设置页"已登录 Cookie 列表"点击某渠道"登录账号" |

`AccountSwitcherDialog.svelte` 本身**不直接调用** `otaCredential.*`——它通过 props（`onSelectCredential`/`onCookieImport`/`onNewLogin`）把动作委托给父组件 `BrowserWorkspace.svelte` 实现（分别对应 `switchLoginCredential`/`loginFromImportedCookiesForActiveChannel`/`newLoginForActiveChannel`），对话框内 `selectCredential()`（66-79 行）只调用传入回调，不知道底层走的是哪个 IPC 方法。

`switchLoginCredential`（185-210 行）里，若该 credential 在当前渠道**已有**打开的标签页，走 `browser.activate` 直接激活，不调用 `openExisting`；只有当前未打开才调用。

## 8. `OtaHotelProbFeature` 与 `DiscoveryProbe` —— 两套独立探测机制

结论：这是两套不同的探测，通过 `TabEventBus` 事件契约串联，互不依赖内部实现。

### 8.1 第一层：账号身份探测（`ota-credential/discovery-probe*.ts`）

`DiscoveryProbe` 接口（`main/features/ota-credential/discovery-probe-port.ts`）：

```ts
interface DiscoveryProbe {
  readonly channel: ChannelId;
  discover(partitionName: string, landingUrl: string, webContents: WebContents): Promise<DiscoveryOutcome>;
}
```

`DiscoveryOutcome` 为 `'unsupported' | 'none' | 'single' | 'multiple'`。虽然类型名带 "Hotel"（`DiscoveredOtaHotel`），但真实用途是探测账号归属哪家/哪些门店，从而**确定账号身份**（生成/归并 `OtaCredential`），不是给 `OtaHotelProbFeature` 用的。

`createDiscoveryProbes()`（`discovery-probe.ts`）目前**返回空 Map**：

```ts
function createDiscoveryProbes(): ReadonlyMap<ChannelId, DiscoveryProbe> {
  return new Map<ChannelId, DiscoveryProbe>();
}
```

三个已支持渠道（携程/抖音/美团）走的是 `DiscoverAndCreate.trigger()`（`discover-and-create.ts`）内针对渠道硬编码的 `if (isCtrip) ... else if (isDouyin) ... else if (isMeituan) ...` 分支，各自调用 `discoverCtrip`/`discoverDouyin`/`discoverMeituan`（`ota-credential/ota/{ctrip,douyin,meituan}/discover-*.ts`）。通用 `DiscoveryProbe` 接口是非硬编码渠道的兜底扩展点，目前未被使用。

触发链路：`BrowserManager.checkUrlPastLogin` 命中登录判据 → 调用 `tab.onUrlPastLogin`（`LoginTabOpener` 包装的 `triggerDiscovery`）→ `application.ts:101-103` 绑定为 `discoverAndCreate.trigger(...)` → 内部身份识别/归并 → 落库为 `OtaCredential` → 返回 credential 给 `BrowserManager` 广播 `tab:credential-checked`。

### 8.2 第二层：酒店列表探测（`ota-hotel-prob/*`）

文件清单：`ota-hotel-prob-feature.ts`（`OtaHotelProbFeature` 类）、`hotel-prob-port.ts`（`HotelProbe` 接口）、`ota/{ctrip,douyin,meituan}/hotel-prob.ts`（渠道实现）。

`HotelProbe` 接口（`hotel-prob-port.ts:23-26`）：

```ts
interface HotelProbe {
  isProbeableUrl(url: string): boolean;
  probe(credential: OtaCredential, webContents: WebContents): Promise<HotelProbeOutcome>;
}
```

接收**已存在的 `OtaCredential`**（第一层已完成、已落库），职责是"该账号名下管理哪些实际酒店"，写入独立的 `OtaHotelProbRepository`（`otaHotelId/otaHotelName/bindExtra` 落 `ota_hotel_prob` 表，`ota-hotel-prob-feature.ts:53-75`），与 `OtaCredential` 是不同持久化实体。

触发点：`OtaHotelProbFeature` 构造函数订阅 `tab:credential-checked`（25 行）。只在 `outcome.kind === 'checked'` 且 `credential` 非 null 时，用 `event.channel` 从 `probes: ReadonlyMap<ChannelId, HotelProbe>` 取出对应渠道探测器：先 `probe.isProbeableUrl(event.url)` 判断该 URL 是否可探测，再查 `repository.findByCredentialId` 去重（该 credential 已探测过则跳过），最后调用 `probe.probe(credential, event.webContents)`。

装配（`application.ts:82-94`）：

```ts
const hotelProbes: ReadonlyMap<ChannelId, HotelProbe> = new Map([
  [toChannelId('ctrip'), ctripHotelProbe],
  [toChannelId('douyin'), createDouyinHotelProbe(log)],
  [toChannelId('meituan'), meituanHotelProbe],
]);
new OtaHotelProbFeature({ tabEventBus, probes: hotelProbes, repository: otaHotelProbRepository, logger: log });
```

### 8.3 两层关系总结

- 第一层由 `checkUrlPastLogin` **同步阻塞**触发（在 `TabEventBus` 广播之前，作为 `onUrlPastLogin` 回调的一部分被 await），目的是把当前登录态识别成一条 `OtaCredential`。
- 第二层在 **`TabEventBus` 广播之后**、作为独立订阅者**异步**触发（`void this.onCredentialChecked(event)`，不阻塞广播本身），目的是在已确认的账号身份基础上探测该账号名下的酒店列表。
- 两者唯一耦合点是 `tab:credential-checked` 事件契约，互不依赖内部实现。
- 两者**都只在标签页通过 `createAndNewPartition` 打开、且挂了 `loginUrlMatcher`/`onUrlPastLogin` 时才会触发**——`openExisting`（`createWithAlreadyPartition` 不传 options）打开的标签页，`checkUrlPastLogin` 直接短路广播 `not-applicable`，两层探测都不会跑。
