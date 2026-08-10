## Context

动机见 `proposal.md`。前两个 change 已备好地基：

| 已就位 | 位置 | 现状 |
|---|---|---|
| `OtaHotelRepository.save()` | `database/ota-hotel-repository.ts` | upsert 写入口，**零调用方** |
| `RmsOtaAccountGateway.bind()` | `gateway/rms/types.ts` + mock | 接口含 cookie 快照，**零调用方** |
| `intent?: unknown` | `ota-tab/ota-tab-service.ts` | 占位参数，待收窄 |
| `HotelProbeDispatcher` | `channels/` | 探测出候选只记日志，无出口 |
| 探测早退已删 | — | 用户否决后可重试的前提 |

**关键约束：**

| 约束 | 来源 |
|---|---|
| `channels/` 只可依赖 `ota-tab/`，禁 services/database/gateway/ipc/composition | Change 2 的 eslint zones |
| `ipc/` 只做边界：信任校验 → 参数校验 → 调恰好一个 service → 错误转换 | CLAUDE.md + eslint |
| `services/` 不得 import `browser/`；OTA tab 唯一开口是 `ota-tab/` | `desktop-main-layering` spec |
| 广播必须晚于 credential 写库完成 | `login-detector.ts` 时序注释 |
| 弹窗必须在浏览器工作区就地展示 | 用户需求：可否决后换渠道重试 |

## Goals / Non-Goals

**Goals:**

- 打通绑定全链路，前两个 change 造成的空窗期结束
- 主进程全程**零 pending 状态**：不为「有人在等结果」保存任何东西
- 建立可复用的「UI 等待异步结果」形状，第二种弹窗出现时可低成本抽象

**Non-Goals:**

- 不抽 `createWaitingUiResult` 之外的通用弹窗框架——只有一个 kind，等第二例
- 不做后台自动爬取（dispatcher 的另一种触发源）
- 不改三渠道 probe 实现
- 不引入多选绑定

## Decisions

### 决策 1：链路形状——两条独立的链，中间不接首尾

```
【酒店管理页 /hotels】用户选中凭证，点「打开浏览器并绑定」
   │
   │ ① ipc hotelManagement.startBinding()  →  只回 { requestId }
   │      （主进程**不开 tab**，不持有任何绑定状态）
   │ ② hotelBindingWaiting.set({requestId, credentialId, rmsHotelId, rmsHotelName})
   │ ③ push('/')
   │
【浏览器工作区 /】BindHotelDialog 挂载
   │ ④ hotelBindingWaiting.consume()
   │ ⑤ waiting.await('bind-hotel', requestId, cb)      ← 先登记，不会错过结果
   │ ⑥ browserOtaTabs.openExisting(credentialId, {kind:'bind-hotel', requestId})
   │      └→ ipc otaTab.openExisting（intent 过 schema 校验）
   │           └→ OtaTabService.openExisting → LoginDetector.register(tabId, ch, intent)
   │      ←─ 返回 tab，store 做三步收尾：进标签栏 / 切到该渠道 / syncBounds
   │
   ├── 主进程侧（与上面不是同一条调用栈）───────────────
   │   LoginDetector：导航 → 判定 → 写 credential
   │      → TabEventBus 广播（事件带 intent）
   │      → HotelProbeDispatcher：选 probe → probe() → 候选
   │           · webContents.isDestroyed() → 丢弃
   │           · notify({requestId, kind, payload:{credentialId, hotels}})
   │              └→ composition root 接到 webContents.send
   │
   │ ⑦ renderer 收到，requestId 匹配 → 就地弹窗（不跳转）
   │      ├─ 否决 → 关弹窗，可换渠道重来
   │      └─ 选定 → ipc hotelManagement.confirmBinding(...)
   │                  └→ gateway.bind() → 成功后 repository.save()
   └─
```

①②③ 是一条链（取号 + 交接意图），⑦ 是另一条（结果送达）。**中间隔着事件总线，不是函数返回**。

| 方案 | 结论 |
|---|---|
| A. `startBinding` 返回 Promise，等探测完成才 resolve | ✗ 探测可能永不发生（用户没登录成功/关了 tab），Promise 永久挂起；主进程必须保存 resolve 回调 = pending 状态 |
| B. 发起与结果分离，用 requestId 关联 | **✓** 主进程无状态；用户放弃时 renderer 单方面取消即可 |

**tab 由谁开**（初版遗漏了这个选择，真机跑不通后补上）：

| 方案 | 结论 |
|---|---|
| A. `startBinding` 在主进程内部开 tab | ✗ 开 tab 有三步收尾**只有渲染进程做得了**——进 `tabsByChannel`（标签栏才画得出）、设为活动标签并切渠道（否则内容区停在上一个渠道）、`syncBounds()`（WebContentsView 没尺寸等于没渲染，页面不渲染探测也就必然失败）。主进程代劳会开出一个界面不认识的标签页 |
| B. renderer 调 `otaTab.openExisting` 自己开 | **✓** 与其余三条开 tab 路径同一条链；`startBinding` 退化为纯发号器 |

代价是 intent 要穿过 IPC（此前只在主进程内部传递），因此必须在边界过 `otaTabIntentSchema`——它来自渲染进程，是不可信输入，不能直接进 `LoginDetector`。

### 决策 2：状态放在会自然消亡的一侧

`waiting` 表（requestId → 回调）放在 **renderer**：

| | renderer 持有 | 主进程持有 |
|---|---|---|
| 生命周期 | 随组件，卸载即消亡 | 需显式清理 |
| 用户关窗 | 自动没了 | 泄漏 |
| 主进程重启 | 无关 | 状态丢失，UI 空等 |

主进程唯一「记住」intent 的地方是 `LoginDetector.loginTabs`（已存在的 Map，按 tabId），它**已有清理路径**：`browserManager.on('tab:closed')` 里 `loginTabs.delete(tabId)`。intent 挂在同一条记录上，随 tab 关闭一起消失，不新增生命周期。

### 决策 3：候选随通知发送，不落 staging

| 方案 | 候选存哪 | 结论 |
|---|---|---|
| A. 随通知发给 renderer | renderer 组件状态 | **✓** 生命周期与弹窗完全一致，零清理 |
| B. 主进程内存 Map | service | ✗ 回到 pending 状态问题 |
| C. staging 表 | DB | ✗ 多一张表 + 清理逻辑；候选本就不是事实 |

候选在用户确认前不是事实，不该进入任何持久化。这也是为什么 Change 1 要把探测改成无副作用——两个决策是同一件事的两面。

### 决策 3b：没有绑定意图就不探测

初版 dispatcher 的顺序是「先 `probe()`，再看 intent 决定要不要通知」，无意图时探测照跑、结果只记日志。那是 dispatcher 还没有消费者时的遗留形态，不是有意选择——接上绑定链路后它就变成纯粹的代价。

「探测无副作用」说的是**不写库**，不是不碰页面：

| 渠道 | probe 实际做什么 | 用户可见 |
|---|---|---|
| 携程 | 解析已存的 `credentialExtra` | 无 |
| 美团 | `executeJavaScript` 发一次门店列表请求 | 基本无感 |
| 抖音 | 点开左侧「门店管理」菜单 → 等菜单就绪(4s) → 拦 CDP `dsl/get`(最长 30s) | **把用户正在看的页面挪走** |

所以判断必须**早于** `probe()`：普通登录只是「登录」，不该被顺带劫持成一次探测。改后 `event.intent?.kind !== 'bind-hotel'` 直接 return，`isProbeableUrl` 都不调。

顺带消掉了 known-issues 问题 3 里「无意图时的候选丢弃日志」——那条路径现在根本走不到。

### 决策 4：kind → payload 映射表

```ts
// shared/types/ui-waiting-result-types.ts —— 零依赖，双进程共用
export type UiWaitingResultPayloads = {
  'bind-hotel': Readonly<{
    credentialId: string;
    hotels: readonly ProbedHotelDto[];
  }>;
  // 'select-room-type': {...}   ← 将来
};

export type UiWaitingResultKind = keyof UiWaitingResultPayloads;

export type UiWaitingResultEnvelope<K extends UiWaitingResultKind = UiWaitingResultKind> =
  Readonly<{ requestId: string; kind: K; payload: UiWaitingResultPayloads[K] }>;
```

收益是**类型自动收窄**：`waiting.await('bind-hotel', id, p => p.hotels)` 中 `p` 自动推成对应 payload，写错字段编译期报错。

renderer 侧原语：

```ts
// renderer/waiting-ui-result.ts
export function createWaitingUiResult(
  subscribe: (l: (e: UiWaitingResultEnvelope) => void) => () => void,
) {
  const waiting = new Map<string, (payload: never) => void>();
  const unsubscribe = subscribe((envelope) => {
    const resolve = waiting.get(envelope.requestId);
    if (!resolve) return;                      // 不是我等的，或已放弃
    waiting.delete(envelope.requestId);
    resolve(envelope.payload as never);
  });
  return {
    await<K extends UiWaitingResultKind>(
      kind: K, requestId: string,
      onResult: (payload: UiWaitingResultPayloads[K]) => void,
    ): () => void {
      waiting.set(requestId, onResult as (p: never) => void);
      return () => waiting.delete(requestId);  // 组件卸载/放弃时调用
    },
    dispose: unsubscribe,
  };
}
```

`requestId` 全局唯一（`crypto.randomUUID()`），按 id 查即可；`kind` 只用于定类型，不参与匹配。两处 `as never` 是异构 Map 存不同 payload 回调的代价，**收在这一个文件里**，对外的 `await<K>` 完全类型安全。

### 决策 5：`notify` 是注入的窄回调

`HotelProbeDispatcher` 在 `channels/`，eslint 禁止它 import `ipc/`、`composition/`，也不该认识 `electron`：

```ts
export type HotelProbeDispatcherDependencies = Readonly<{
  tabEventBus: TabEventBus;
  probes: ReadonlyMap<ChannelId, HotelProbe>;
  logger: AppLogger;
  notify: (envelope: UiWaitingResultEnvelope) => void;   // 不认识 electron/ipc
}>;
```

composition root 接到 `webContents.send`——与既有 `setAccountBoundNotifier` 完全同构，照抄那个形状。

### 决策 6：远端先于本地

```
gateway.bind(...)  ──成功──> repository.save(...) ──失败──> 记 warn，仍返回成功
       │                                          └──成功──> 返回
       └──失败──> 抛出，不写本地
```

理由：远端是绑定关系的权威。若先写本地再写远端，远端失败会留下「本地有、远端无」的孤儿记录，而本地表根本不表达绑定关系，这条记录无从解释。反向则最坏只是「远端有、本地无酒店信息」，下次探测保存即可自愈。

**本地写入失败不算绑定失败**（初版实现漏了这一半，后补）：既然「最坏只是本地缺一条、下次自愈」，那它就不该冒泡成用户可见的失败。让它抛的后果是——远端**已经绑定成功**，用户却看到「绑定失败」，一重试远端就以「该酒店的此渠道已存在活跃绑定」拒绝，人被永久卡在一个其实早已成功的操作上。这条路径是可达的，不是理论风险：见下方 `OtaHotelId` 字符集。

### 决策 6b：`OtaHotelId` 不套用 partition 的字符集规则

`toOtaHotelId` 原先复用 `assertValidIdentifier`，即 `/^[a-z0-9][a-z0-9-]*$/`。那条规则的理由写在 `ids.ts` 上：标识符会被拼进 partition 字符串和磁盘路径，大小写混用在 macOS 通过、在 Linux 失败。

但 `OtaHotelId` **不进任何路径**——`toPartitionName(environment, channel, shortId)` 三个入参都不是它。它是携程/抖音/美团各自的门店编号，本地只存储与比较。

| | 借用 partition 规则 | 独立规则（本次） |
|---|---|---|
| `SHYQ-310042`（携程真实形态，mock seed 里就有） | ✗ 抛 `InvalidIdentifierError` | ✓ |
| 抛错时机 | `confirmBinding` 里，**远端已绑定成功之后** | — |
| 后果 | 用户看到「绑定失败」→ 重试 → 远端说「已存在活跃绑定」→ 死循环 | — |

保留非空与长度上限（128）：空串会静默污染 `(channel, ota_hotel_id)` 唯一键，超长值是解析出错而非真实 ID。

三个 probe 里 `toOtaHotelId` 也在调，抖音那处的 throw 被 `catch` 成 `{kind:'none'}`（表现为「探不到酒店」），携程走 `/(\d+)/` 提取不受影响——所以此前只有 `confirmBinding` 这一处会真正炸给用户。

### 决策 6c：`ota_hotel` 的行 id 由仓储生成

`save()` 是按 `(channel, ota_hotel_id)` upsert 的，冲突时入参 `id` 被丢弃、沿用既有记录。让调用方传一个「有时生效、有时不生效」的 id，读代码时无从判断它到底会不会落库；实现里更是直接把 `generateRequestId()`（语义是「绑定请求号」）当行主键使，一个依赖同时承担三种含义。

改法：`OtaHotelSaveInput = Omit<OtaHotel, 'id'>`，`id` 在 `SqliteOtaHotelRepository.save()` 内部 `randomUUID()`。这条「有时生效」的规则属于 upsert 语义本身，不外泄。

### 决策 7：cookie 快照从哪来

`RmsOtaAccountBindInput` 要求 `cookies: RmsCookieSnapshotEntry[]`。凭证的 partition 里有实时 cookie，需在 `confirmBinding` 时从对应 session 读取。

`services/` 不得 import `browser/`（eslint），因此读 cookie 的能力由 composition root 注入窄回调 `readCookieSnapshot(partitionName) => Promise<RmsCookieSnapshotEntry[]>`，实现落在 composition 层调用 `sessionFactory`。

### 决策 8：弹窗位置

挂在 `components/browser/`（浏览器工作区），不挂酒店管理页。用户否决后要能立刻换渠道重试，跳转会把一个循环拆成往返。

发起在酒店页、弹窗在浏览器页，因此**需要一条跨路由 intent** 做交接（`hotelBindingWaiting`）。它是一次性信箱，读取即清空——语义上正好对应「离开浏览器工作区即视为放弃本次绑定」：等待随 `BindHotelDialog` 卸载消亡，用户回酒店页重新发起即可。不为此加超时，也不加常驻的「等待中」提示。

### 决策 9：渲染进程侧的 OTA tab 状态层

主进程有 `OtaTabService` 作为「OTA tab 的唯一开口」，渲染进程这一头此前是零层——tab 状态和三步收尾散在 `BrowserWorkspace` 的几个函数里。后果是「不从该组件内部发起」的开 tab 需求（绑定）无处可接，只能绕过去，而绕过去就会开出界面不认识的 tab。

`renderer/components/browser/browser-ota-tabs.svelte.ts` 收敛这一侧：

```ts
class BrowserOtaTabsStore {
  tabsByChannel:   Record<string, BrowserTab[]>   // $state
  activeTabIds:    Record<string, string>          // $state
  activeChannelId: string                          // $state

  registerViewport(read: () => DOMRect): () => void  // 组件把 DOM 几何交进来
  adopt(tab): Promise<BrowserTab>                    // 三步收尾，所有开 tab 路径必经
  openForNewLogin(channelId, url)
  openWithImportedCookie(channelId, url)
  openExisting(credentialId, intent?)                // ← 绑定路径在这里接
  activate(tab) / selectChannel(id) / close(tab) / closeSuperseded(...) / hydrate(tabs)
}
```

| | 收进 store | 留在组件 |
|---|---|---|
| `tabsByChannel` / `activeTabIds` / `activeChannelId` | ✓ | |
| 三步收尾（`adopt`） | ✓ | |
| 视口 DOM 引用 | 由组件注册进来 | 元素本身 |
| `credentialsByChannel`（凭证列表） | | ✓ tab 的邻居，不是同一件事 |

`BindHotelDialog` 因此**自给自足**：自己 consume 意图、自己调 `store.openExisting`、自己登记等待，不需要 `BrowserWorkspace` 传 props——绑定的业务概念（`rmsHotelName` 之类）一个字都不渗进浏览器工作区。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 探测永不发生时 UI 一直等（用户没登录成功、页面没跳转） | 弹窗侧提供取消；`cancel()` 只删 renderer 的 Map 项，无需通知主进程。**不设超时**——超时值无法合理选取（探测耗时取决于用户手速与网络） |
| `startBinding` 之后用户手动关了 tab | `LoginDetector` 的 `tab:closed` 清掉 intent，探测不会发生；renderer 侧等待由用户取消或组件卸载清理 |
| 同一凭证并发发起两次绑定 | requestId 不同，两条等待并存，各自匹配。后到的候选覆盖前一个弹窗属 UI 细节，本次按「同时只允许一个绑定弹窗」处理：发起新绑定前取消旧等待 |
| 远端 mock 的 `bind()` 行为与真实 API 不符 | 本次接的是 mock（`rms-ota-account-gateway-mock.ts`）；真实接入时接口不变，只换实现 |
| cookie 快照包含敏感值 | 只在 `confirmBinding` 调用瞬间读取并直接传给 gateway，不落本地、不记日志（日志只记条数） |
| 探测链路在真机上尚未端到端验证过（Change 1/2 遗留） | 本次必须真机验证；若链路不通，先修链路再谈绑定 |

## Migration Plan

无数据迁移。新增 IPC 频道与 preload API 属增量，旧版本 renderer 不调用即可。

## Open Questions

无。单选、弹窗位置、状态归属、远端顺序均已确认。
