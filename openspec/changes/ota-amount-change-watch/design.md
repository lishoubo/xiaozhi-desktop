# OTA 价量态改动监控技术方案

> **背景**：RMS 已能通过 RPA 把价量态写到抖音（`rms-rpa-worker/adapters/douyin/price_write.py`、
> `stock_state_write.py`）。本次做**反向**的一半：用户在渠道后台**手工**改价时，desktop 被动
> 观测并上报 RMS，由 RMS 决定跟哪些渠道的价。
>
> **范围**：架构面向**三个渠道**（抖音 / 携程 / 美团）。已实装**抖音**（2026-08-10）与
> **携程**（2026-08-11，踩点 `docs/踩点/携程/改价.md`）；美团尚无踩点，在 registry 留空位。
> 携程接入验证了机制层的渠道无关性（机制层一行未改），也暴露了契约的一处不合身 —— 见 §12。
>
> **与 `hotel-probe-dispatcher` 的根本差异**：那条链路是 **intent 触发、一次性、会操作页面**；
> 这条是 **URL 触发、常驻监听、绝不碰页面**。触发模型不同，不复用分发器。

---

## 1. 全景链路

```
  用户在某渠道后台改价，点保存
              │
              ▼
  ┌───────────────────────────────────────────────────┐
  │ 渠道自己的页面（抖音 /p/travel-ari/hotel/price）    │  我们不发请求
  │   POST <渠道的保存端点>                            │  只旁听
  └───────────────────────────────────────────────────┘
              │  CDP Network 事件流
              ▼
  ┌─ channels/amount-save-capture.ts ────────────────┐
  │  requestWillBeSent  → 记 postData + pageUrl      │  ✦ 渠道无关
  │  loadingFinished    → 取 responseBody 配对        │    纯 CDP 机制
  │  端点列表 / 成功判定 由渠道适配器提供               │
  └───────────────────────────────────────────────────┘
              │  AmountSaveObserved（原始事实，含 endpointId）
              ▼
  ┌─ channels/amount-change-watcher.ts ──────────────┐
  │  订阅 tab:navigated → 按 channelId 取适配器        │  ✦ 渠道无关
  │  适配器说「这页要监听」→ attach；离页 → detach      │    分发器
  │  调适配器 parse() → 得到上报体                     │
  └───────────────────────────────────────────────────┘
              │
              ├── channels/douyin/amount-change-adapter.ts   ✅ 已实装
              ├── channels/ctrip/amount-change-adapter.ts    ✅ 已实装
              └── channels/meituan/...                        ⬜ 空位
              │
              │  OtaAmountChangeObserved（窄回调注出）
              ▼
  ┌─ services/amount-change-report-service.ts ───────┐
  │  加 operationId + observedAt → 调 gateway         │  薄编排
  └───────────────────────────────────────────────────┘
              │
              ▼
  ┌─ gateway/rms/rms-amount-change-gateway-mock.ts ──┐
  │  本次 mock：只记日志，不发 HTTP                     │
  └───────────────────────────────────────────────────┘
              │
              ▼
        RMS 自己反查绑定、自己展开日期×房型、自己决定跟价
```

**desktop 不做**：查本地绑定、算 hotelId、展开日期、判断该不该跟价。全部留给 RMS。

---

## 2. 模块关系

```
browser/browser-manager.ts ──── tab:navigated ────┐   ✅ 复用（已同时覆盖
  （did-navigate + did-navigate-in-page 都发）      │      SPA pushState）
                                                   ▼
                        channels/amount-change-watcher.ts    🆕 分发器（渠道无关）
                                  │            │
                    attach/detach │            │ 窄回调 report()
                                  ▼            │
              channels/amount-save-capture.ts 🆕│   CDP 机制（渠道无关）
                                  │            │
                    ┌─────────────┴──┐         │
                    ▼                ▼         │
        channels/douyin/       ctrip/  meituan/│   渠道适配器
          amount-change-        ✅      ⬜      │   （AmountChangeAdapter）
          adapter.ts ✅                        │
                                               ▼
                        services/amount-change-report-service.ts  🆕
                                               │
                                               ▼
                        gateway/rms/rms-amount-change-gateway-mock.ts  🆕
                        gateway/rms/types.ts                      ✏️ 加接口

channels/registry.ts           ✏️  加 amountChangeAdapter（可选字段）
shared/types/amount-change.ts  🆕  跨层契约
composition/window-scope.ts    ✏️  装配 watcher
```

依赖约束（eslint 已强制）：`channels/` 只能依赖 `ota-tab/`，**不得** import
`services`/`database`/`gateway`。所以 watcher 拿不到 gateway，上报能力由 composition root 以
**窄回调** `report()` 注入 —— 与 `HotelProbeDispatcher.notify` 同一手法。

> **本次不新增 `ota-tab` 事件**。原方案打算加 `tab:navigated`，实测
> `browser-manager.ts:327-336` 已经对 `did-navigate` 和 `did-navigate-in-page` 都发了这个
> 事件，`TabNavigatedEvent` 也已带 `webContents` 与 `channelId`。watcher 直接订阅
> `BrowserManager`，与 `LoginDetector` 同源。

### 2.1 渠道差异收口

只有**一个**接口是渠道差异的落点，其余全部渠道无关：

```
                  渠道无关（写一次）           渠道特有（每渠道一份）
                  ─────────────────           ──────────────────────
CDP 事件配对        AmountSaveCapture                   —
attach 生命周期     AmountChangeWatcher                 —
「这页要监听吗」            —                  isWatchableUrl(url)
「哪些端点是保存」          —                  saveEndpoints
「这次成功了吗」            —                  isSuccessful(responseBody)
「酒店是哪家」              —                  parse(observed) → 上报体
上报 / 契约         AmountChangeReportService           —
```

---

## 3. CDP 状态机（渠道无关）

`requestId` 由 **Chromium 生成**（形如 `"1234.5"`），同一 HTTP 请求的整条事件流共用它
—— 不需要我们发明关联键。

```
 Network.requestWillBeSent { requestId, request{url, method, postData, hasPostData} }
   │
   ├─ adapter.saveEndpoints 无一命中 url → 忽略
   └─ 命中
        ├─ postData 存在 → 直接用
        └─ postData 缺失 && hasPostData → await getRequestPostData({requestId})   ⚠️ 坑1
        pending.set(requestId, {
          endpointId,                          // 哪个端点命中，给适配器分派用
          requestBody,
          pageUrl: webContents.getURL(),        ⚠️ 坑3：此刻抓，不能延后
          at: Date.now(),
        })
   │
 Network.responseReceived { requestId, response{status} }
   └─ pending 命中 → 记 status
   │
 Network.loadingFinished { requestId }
   └─ pending 命中 → getResponseBody(requestId)
        ├─ adapter.isSuccessful(body) → 产出 AmountSaveObserved ✅
        └─ 否则 → logger.warn（带渠道错误文案），丢弃           ❌
        finally → pending.delete(requestId)
   │
 Network.loadingFailed { requestId }
   └─ pending.delete(requestId)             ⚠️ 必须订阅，否则 Map 泄漏
```

| # | 坑 | 后果 | 处理 |
|---|---|---|---|
| 1 | `postData` 在 body 大时被省略（只给 `hasPostData: true`） | 房型/日期一多就**静默漏报** | 调 `Network.getRequestPostData` 兜底 |
| 2 | pending 项可能因漏配对残留 | 缓慢内存泄漏 | 每次 `set` 时惰性清扫 `at` 超过 60s 的项 |
| 3 | 用户点保存后立刻切酒店 / 跳走 | 酒店 ID 归到**错误的酒店** | `pageUrl` 在 `requestWillBeSent` 当刻快照 |

为什么必须校验成功（决策 1 的方案 B）：踩点 `修改价格.md:105-117` 有真实失败样本 ——
`103810209 限价规则：发布的【2026-05-28】商品的价格不能低于9元`。渠道自己都没保存成功却
触发跟价，会造成**渠道间价格不一致**，属脏数据而非多一次调用。

**成功判定必须交给适配器**：抖音是 `BaseResp.StatusCode === 0`，携程/美团几乎肯定是别的
形状。机制层只问适配器"成了吗"，不认识任何渠道的响应结构。

---

## 4. attach 生命周期

```
tab:navigated(tabId, channelId, url, webContents)
  │
  ├─ adapter = adapters.get(channelId)
  │    └─ 无适配器（携程/美团本期）→ 直接返回
  │
  ├─ adapter.isWatchableUrl(url) 且 未 attach ──→ attach()   进页开
  ├─ !adapter.isWatchableUrl(url) 且 已 attach ──→ detach()  离页关
  └─ 其余 → 无操作（同页内多次 pushState 不重复 attach）

tab:closed → detach() + 清 pending
```

各渠道的"要监听的页"由适配器自己判断：

| 渠道 | 监听页 | 本期 |
|---|---|---|
| 抖音 | `life.douyin.com` + path 含 `/p/travel-ari/hotel/price` | ✅ |
| 携程 | `ebooking.ctrip.com` + path 以 `/ebkovsroom/inventory` 开头 | ✅ |
| 美团 | 待踩点 | ⬜ |

### 与酒店探测的 attach 冲突

`webContents.debugger.attach()` 是**独占**的，而 `DslGetResponseCapture`（抖音酒店探测）
也 attach。两者页面不重叠，天然错开：

| 流程 | 所在页 | attach 时机 |
|---|---|---|
| 酒店探测 `DslGetResponseCapture` | `/p/home` | 探测期间，用完 `detach()` |
| 改价监听 `AmountSaveCapture` | `/p/travel-ari/hotel/price` | 停留期间常驻 |

`isWatchableUrl` 只认改价页，所以在 `/p/home` 上监听根本不 attach。**但**
`DslGetResponseCapture.detach()` 是无条件 `debugger.detach()`，若将来两者同页共存会互相
掀桌。本次不引入共享 CDP 会话层（过度设计），改为：

- `AmountSaveCapture.attach()` 前检查 `isAttached()`，已被占用则记 warn 并跳过本次
- `detach()` 前检查自己是否真的 attach 过，不无条件 detach

---

## 5. 关键代码骨架

### 5.1 共享契约 `shared/types/amount-change.ts` 🆕

```typescript
/** capture 层产出的原始事实，尚未按渠道解读。 */
export type AmountSaveObserved = Readonly<{
  endpointId: string;        // 命中的是哪个端点（适配器自定义的标识）
  requestBody: JsonObject;   // 渠道原始 body，一字不改
  responseBody: string;      // 原始响应，适配器判定成功用
  pageUrl: string;           // requestWillBeSent 当刻快照
}>;

/**
 * 上报给 RMS 的形状 —— **渠道无关**。
 *
 * 公共字段只留三样：source 决定 RMS 怎么解读后两样；otaHotelId 是 RMS 反查绑定的键；
 * requestBody 是原始证据。渠道专有的定位字段（抖音的 merchantGroupId /
 * lifeAccountId）一律进 channelExtra —— 与 `channels/bind-extra.ts` 里
 * `bindExtra` 的既有套路一致，加渠道不必改契约。
 */
export type OtaAmountChangeReport = Readonly<{
  operationId: string;        // 幂等键，desktop 生成（randomUUID）
  source: ChannelId;          // 'douyin' | 'ctrip' | 'meituan'
  endpointId: string;         // 渠道内区分「改价」还是「改房态」
  otaHotelId: string;
  channelExtra: JsonObject | null;
  requestBody: JsonObject;
  observedAt: string;         // ISO
}>;

/** 适配器把原始事实解读成上报体（operationId/observedAt 由 service 层加）。 */
export type OtaAmountChangeObserved = Omit<
  OtaAmountChangeReport,
  'operationId' | 'observedAt'
>;
```

### 5.2 渠道适配器契约 `channels/types.ts` ✏️

与既有 `HotelProbe` / `LoginUrlMatcher` 并列，同样就近定义在 `channels/`：

```typescript
/**
 * 价量态改动监听的渠道适配器。机制（CDP 配对、attach 生命周期）在
 * `amount-save-capture.ts` / `amount-change-watcher.ts`，渠道无关；这个接口是
 * **唯一**的渠道差异落点。
 */
export interface AmountChangeAdapter {
  /** 这个 URL 是不是「要监听的页」。 */
  isWatchableUrl(url: string): boolean;

  /** 要拦的保存端点。key 是 endpointId，value 是 URL 片段。 */
  readonly saveEndpoints: ReadonlyMap<string, string>;

  /** 渠道各自的成功判定（抖音 BaseResp.StatusCode === 0）。 */
  isSuccessful(responseBody: string): boolean;

  /** 解读成上报体；缺关键定位字段时返回 null（不上报）。 */
  parse(observed: AmountSaveObserved): OtaAmountChangeObserved | null;
}
```

### 5.3 `channels/amount-save-capture.ts` 🆕（渠道无关）

```typescript
type PendingSave = Readonly<{
  endpointId: string;
  requestBody: JsonObject;
  pageUrl: string;
  at: number;
}>;

export class AmountSaveCapture {
  private readonly pending = new Map<string, PendingSave>();
  private attachedByUs = false;

  constructor(
    private readonly webContents: WebContents,
    private readonly adapter: AmountChangeAdapter,   // 端点 + 成功判定来自这里
    private readonly logger: AppLogger,
    private readonly onObserved: (observed: AmountSaveObserved) => void,
  ) {}

  async attach(): Promise<void>;   // isAttached() 已占用则跳过并 warn
  detach(): void;                  // 仅在 attachedByUs 时真 detach
}
```

### 5.4 `channels/amount-change-watcher.ts` 🆕（渠道无关）

```typescript
export type AmountChangeWatcherDependencies = Readonly<{
  browserManager: Pick<BrowserManager, 'on'>;
  adapters: ReadonlyMap<ChannelId, AmountChangeAdapter>;   // 本期只有抖音一项
  logger: AppLogger;
  /** 窄回调：channels/ 不认识 gateway，由 composition root 接到 service。 */
  report: (observed: OtaAmountChangeObserved) => void;
}>;

export class AmountChangeWatcher {
  private readonly captures = new Map<string, AmountSaveCapture>();  // by tabId
  constructor(deps: AmountChangeWatcherDependencies);   // 订阅 tab:navigated / tab:closed
}
```

### 5.5 `channels/douyin/amount-change-adapter.ts` 🆕（本次唯一实装的渠道）

```typescript
const WATCH_PATH = '/p/travel-ari/hotel/price';
const DOUYIN_HOSTNAME = 'life.douyin.com';

/** 二期加房态：这里加一行，机制层不动。 */
const SAVE_ENDPOINTS = new Map<string, string>([
  ['save_amount_calendar', '/life/trip/hotel/save_amount_calendar'],
  // 二期：['batch_save_stock_state_calendar',
  //        '/life/trip/hotel/batch_save_stock_state_calendar'],
]);

export function createDouyinAmountChangeAdapter(logger: AppLogger): AmountChangeAdapter;
```

`parse()` 从页面 URL 取三个字段 —— `poi_id` **只在页面 URL / referer 里，不在 body 里**
（body 只有 `life_account_ids` 和 `product_id`，见踩点 `修改价格.md:43`）：

```typescript
// pageUrl: /p/travel-ari/hotel/price?...&groupid=X&lifeAccountId=Y&poi_id=Z&roomType=2
{
  source: toChannelId('douyin'),
  endpointId,
  otaHotelId: poi_id,
  channelExtra: { merchantGroupId: groupid, lifeAccountId },
  requestBody,
}
```

与 `hotel-prob.ts` 取 `groupid` 同套路。三个字段任一缺失 → 返回 `null`。

### 5.6 `channels/registry.ts` ✏️

```typescript
export type ChannelAdapter = Readonly<{
  channel: ChannelId;
  loginUrlMatcher: LoginUrlMatcher;
  hotelProbe: HotelProbe;
  /** 本期只有抖音有；携程/美团待踩点。可选，缺则该渠道不监听。 */
  amountChangeAdapter?: AmountChangeAdapter;
}>;

/** 投影出 `AmountChangeWatcher` 需要的那一份（跳过没有适配器的渠道）。 */
export function amountChangeAdapters(
  registry: ReadonlyMap<ChannelId, ChannelAdapter>,
): ReadonlyMap<ChannelId, AmountChangeAdapter>;
```

用**可选字段**而不是给携程/美团写空实现：空实现的 `isWatchableUrl` 永远返回 false，读代码的
人要点进去才知道"这渠道其实没做"；可选字段在 registry 一眼看得出谁有谁没有。

### 5.7 `gateway/rms/types.ts` ✏️ + mock 实现 🆕

```typescript
export interface RmsAmountChangeGateway {
  reportAmountChange(report: OtaAmountChangeReport): Promise<void>;
}
```

```typescript
/** 本次 mock：只 info 一条完整 payload，不发 HTTP。真实实现照
 *  HttpRmsHotelGateway 形状抄，用 createRmsApiCall + 认证 fetch。 */
export class MockRmsAmountChangeGateway implements RmsAmountChangeGateway {
  async reportAmountChange(report: OtaAmountChangeReport): Promise<void>;
}
```

---

## 6. 决策表

| # | 决策 | 理由 |
|---|---|---|
| 1 | 请求+响应**配对**，只上报渠道判定成功的 | 踩点有 `103810209 限价规则` 真实失败样本；漏这层会让失败改价触发跟价 → 渠道间价格不一致 |
| 2 | 不用 `Fetch.requestPaused` 阻塞式拦截 | 会侵入用户操作、有卡住页面的风险；本次不需要「先问 RMS 再放行」 |
| 3 | 不注入页面脚本、不 hook `fetch`/`XHR` | CDP 直接给明文 `postData`；渠道改前端实现不影响我们，只要端点不变 |
| 4 | 按 URL attach/detach，不全程常驻 | debugger 常驻有性能开销，且避开与酒店探测的 attach 独占冲突 |
| 5 | **不复用** `HotelProbeDispatcher` | 那边 intent 触发、一次性、会操作页面；这边 URL 触发、常驻、只旁听 |
| 6 | 不新增 `tab:navigated` 事件 | `BrowserManager` 已对 `did-navigate` + `did-navigate-in-page` 都发，且带 `webContents`/`channelId` |
| 7 | 渠道差异全部收进 `AmountChangeAdapter` 一个接口 | 机制（CDP 配对、生命周期）与渠道无关，写一次；加渠道 = 加一个适配器 + registry 一行 |
| 8 | 上报契约用 `source` + `channelExtra`，不用每渠道独立形状 | 与 `channels/bind-extra.ts` 的 `bindExtra` 既有套路一致；加渠道不改契约。RMS 本来就要按 source 分支反查 |
| 9 | 成功判定交给适配器，不写在机制层 | 抖音是 `BaseResp.StatusCode`，另两渠道形状未知 |
| 10 | registry 用**可选**字段而非空实现 | 一眼看出哪些渠道真的做了 |
| 11 | desktop **不查本地绑定**、不算 `hotelId` | 用户决定：RMS 自己反查。副作用见风险表 |
| 12 | 忠实透传原始 `requestBody`，不展开日期×房型 | RMS 已有语义展开逻辑；透传保留原始证据便于复盘 |
| 13 | capture 层**端点无关**（`saveEndpoints` 是 Map） | 二期房态只加一行常量，不碰机制 |
| 14 | 上报失败**不落盘重试** | 跟价时效性强，隔几分钟补报 RMS 可能已不适用；落盘会牵出重启补报/顺序保证一串问题 |

---

## 7. 边界情况

| 场景 | 处理 |
|---|---|
| 渠道无 `amountChangeAdapter`（美团本期） | watcher 直接返回，不 attach |
| 携程一次保存跨多家门店 | `otaHotelId` 取第一家，完整清单进 `channelExtra.hotelIds` 并记 info（§12） |
| 携程部分门店写入失败（`resultCode` 非 0） | 整体判失败，**不上报**（保守口径，§12） |
| 用户在**未绑定** RMS 的账号里改价 | 照常上报，RMS 反查不到自行丢弃（决策 11 的代价） |
| `postData` 缺失（body 过大） | `getRequestPostData` 兜底；仍失败则 warn 不上报 |
| 渠道返回失败（限价规则等） | warn 记渠道错误文案，**不上报** |
| 页面 URL 缺关键定位字段 | 适配器 `parse()` 返回 null，warn 不上报 |
| 响应体不是合法 JSON | 适配器 `isSuccessful` 返回 false → 不上报 |
| 用户点保存后立刻切酒店 | `pageUrl` 已在 `requestWillBeSent` 快照，归属正确 |
| 同页多次 pushState | `isWatchableUrl` 仍真且已 attach → 不重复 attach |
| tab 关闭 | `detach()` + 清 pending |
| debugger 已被酒店探测占用 | warn 跳过本次 attach（页面不重叠，实际不该发生） |
| 一次操作触发多个请求（房态 >10 条分批） | 会产生多条独立上报。**二期需 RMS 侧确认可接受** |
| 上报 HTTP 失败 | 重试 1 次后放弃并 warn（决策 14） |

---

## 8. 测试策略

机制层与渠道层分开测，前者是本次的架构风险所在：

| 目标 | 方式 |
|---|---|
| `AmountSaveCapture` 事件配对 | 假 `webContents.debugger`，按序喂 CDP 事件；覆盖 happy path + `postData` 缺失 + `loadingFailed` |
| `AmountChangeWatcher` 生命周期 | 假 `BrowserManager`，发 `tab:navigated` 序列；覆盖 进页 attach / 离页 detach / 无适配器渠道 |
| 抖音适配器 `parse()` | 用踩点里的真实 URL + body 样本，断言上报体字段 |
| 端到端 | **真机验证**（见 §9 风险 1、2），不做自动化 |

按 `docs/TESTING_STANDARDS.md` 的粒度约束：每个行为 1 个 happy path + 至多 2 个高价值边界。

---

## 9. 风险与权衡

| # | 风险 / 权衡 | 应对 |
|---|---|---|
| 1 | ✅ **已验证（2026-08-11，携程接入）**：预言的两条都命中了 —— 携程酒店 ID 确实在 body 里，且一次请求确实含多家酒店 | 契约扛住了：机制层与 `AmountChangeAdapter` 一行未改，`channelExtra` 这个逃逸阀装下了差异。唯一不合身的是 `otaHotelId` 单值，处理见 §12 |
| 2 | ⚠️ **未验证**：抖音改价页是否还有其他入口走不同端点 | 踩点只覆盖「勾房型+改价」一条路。`saveEndpoints` 可扩展，发现新端点加一行。**仍需在真实账号把改价页所有入口点一遍** |
| 3 | ✅ **已验证并纠正**（2026-08-10）：门店 ID 不在请求体、也不在菜单进入时的 URL 上 | 见 §11。改为靠 `product_id` 定位，`otaHotelId` 降级为尽力而为 |
| 4 | 未绑定账号的改价也上报 → RMS 收到无效流量 | 可接受。**但 RMS 侧要把「反查失败」当正常情况，不按错误告警** |
| 5 | 端点变更导致静默失效（改了价但没跟价） | 无法根治。上报路径全程 info 日志，便于事后定位 |
| 6 | 上报失败即丢弃（决策 14） | 已知取舍。若漏报不可接受，是另一量级设计，单独议 |
| 7 | debugger 常驻期间对页面的性能影响 | 只 `Network.enable`，不开 `Debugger`/`Profiler`；离页即 detach |

---

## 10. 真机验证纠正的三处设计（2026-08-10）

设计阶段的 `poi_id`/路径假设全部来自踩点文档的 referer，真机跑下来有三处不成立。

### 10.1 门店 ID 三处都没有

```
                                      poi_id?  lifeAccountId?
请求体                                  ❌        ✅（permission_common_param）
URL（走菜单 /hotel/price_amount_state） ❌        ❌   ← 真机常态
URL（带参跳入 /hotel/price）            ✅        ✅   ← 踩点那份，非常态
```

踩点里的 referer 带 `poi_id`，是因为那是从别处带参跳入的单店页面。用户走左侧菜单
「商品与货架 → 房价房态管理」进去，URL 上只有 `groupid`。

**改为靠 `product_id` 定位**：一个房型唯一属于一家门店，RMS 追价台账本来就把
`ota_sale_room_type_id`（= 抖音 `product_id`）与 `ota_hotel_id` 成对存着。

| 字段 | 改前 | 改后 |
|---|---|---|
| `otaHotelId` | 必填，缺则 `return null` **丢弃上报** | 尽力而为，缺则空串，不阻断 |
| 硬错误判定 | 缺 `poi_id` | 缺 `product_id`（那才说明拦到的不是改价请求） |
| `channelExtra` | `{merchantGroupId, lifeAccountId}` | 加 `productIds` —— RMS 反查的实际依据 |

> RPA 侧没这个问题是因为方向相反：它由 RMS 派任务给定 `ota_hotel_id`，调
> `select_poi_on_calendar_page()` 主动把页面切过去。我们是从用户操作反推。

### 10.2 pageUrl 必须取 referer，不是地址栏

`webContents.getURL()` 是地址栏；SPA 选门店常不回写地址栏。改为取 `requestWillBeSent`
的 `Referer` 头（头名大小写不敏感），缺失时回退地址栏。

附带收益：referer 由浏览器在发请求那刻填好，天然是「当刻快照」，§3 坑 3 那个
「用户点完保存立刻切店导致归错」的时序窗口**结构上消失**，不再靠抢时机去防。

### 10.3 两条真实路由，以及二期的坑

| 路由 | 何时 |
|---|---|
| `/p/travel-ari/hotel/price_amount_state` | 走菜单（真机常态） |
| `/p/travel-ari/hotel/price` | 带参跳入（踩点那份） |

`WATCH_PATH = '/p/travel-ari/hotel/price'` 前缀匹配同时覆盖两者。

⚠️ **二期做房态房量时**：页面路径是 `/p/travel-ari/hotel/status`，`isWatchableUrl`
必须放开这个路径 —— 只加 `saveEndpoints` 常量不够，页面匹配不上就根本不会 attach。
`productIdsOf` 已经同时认两个端点的嵌套结构（房态那个嵌在 `calendar_ari_list` 里且会重复，
已去重），这部分二期不用改。

---

## 11. 本期不做

- **美团适配器** —— 无踩点。架构留位，registry 可选字段
- **房态房量**（抖音 `batch_save_stock_state_calendar`、携程对应端点未踩点）的解析与上报
  （机制已就位，二期加端点常量 + 放开对应页面路径，见 §10.3）
- 携程改价页的其他入口是否走同一端点 —— 踩点只覆盖房价日历页批量设价一条路（§12 风险）
- 真实 RMS HTTP gateway（本次 mock；真实实现照 `HttpRmsHotelGateway` 抄）
- 上报失败的落盘队列与重启补报
- 任何 UI —— 用户无感，只在日志可见
- 共享 CDP 会话层（`CdpSession`）—— 页面不重叠，暂不需要
- `Fetch.requestPaused` 阻塞式拦截与「先问 RMS 再放行」

---

## 12. 携程接入（2026-08-11）

踩点：`docs/踩点/携程/改价.md`。**机制层与 `AmountChangeAdapter` 接口一行未改** ——
新增只有一个适配器文件 + registry 一行，验证了 §2.1「渠道差异只有一个落点」的设计。

### 12.1 与抖音的三处结构性差异

| 维度 | 抖音 | 携程 |
|---|---|---|
| 监听页 | `life.douyin.com` `/p/travel-ari/hotel/price*` | `ebooking.ctrip.com` `/ebkovsroom/inventory*` |
| 保存端点 | `/life/trip/hotel/save_amount_calendar` | `/ebkovsroom/api/inventory/batchsetroomprice` |
| 门店 ID 在哪 | 三处都没有，靠 `product_id` 让 RMS 反查 | **请求体里直接有**：`roomPriceInfoList[].hotelID` |
| 一次请求几家店 | 一家 | **可能多家**（踩点响应回了 `115348672` + `115582769`） |
| 成功判定 | `BaseResp.StatusCode === 0` 一处 | 外层 `code === 200` **且**内层每条 `resultCode === 0` |
| 房型 ID | `product_list[].product_id` | `roomTypeID` + `refRoomIDs`（联动房型，两者都要收） |

抖音那套「门店 ID 三处都找不到」的麻烦在携程不存在 —— 携程把 `hotelID` 明写在请求体里，
所以携程的**硬错误判定是「取不到任何 `hotelID`」**（对应抖音的「取不到任何 `product_id`」）。

### 12.2 契约的一处不合身：`otaHotelId` 是单值

§9 风险 1 预言的情况实际发生了：携程一次保存能跨多家门店，而
`OtaAmountChangeReport.otaHotelId` 是单值。

| 方案 | 结论 |
|---|---|
| A. 改契约为 `otaHotelIds: string[]` | ❌ 要动抖音适配器 + service + RMS 侧契约，为一个尚未真机确认频率的场景 |
| B. 一次保存拆成多条上报（每家一条） | ❌ `requestBody` 是整体证据，拆开后每条都带着别家的数据，反而更难复盘 |
| C. `otaHotelId` 取第一家 + 完整清单进 `channelExtra.hotelIds` | ✅ 采用。与抖音显式带出 `productIds` 同一套路，`channelExtra` 本就是逃逸阀 |

> ⚠️ **RMS 侧约定**：处理 `source === 'ctrip'` 时必须读 `channelExtra.hotelIds` 全量，
> **不能只认 `otaHotelId`** —— 那样会漏掉同一次保存里的其他门店。
> 真出现多店时 desktop 会记一条 info 日志备查。

### 12.3 成功判定取保守口径

携程是两层结果：外层 `code` 表示「请求处理完了」，每家门店的实际写入结果在
`data.roomPriceSetResults[].resultCode`。判定规则：

```
code === 200  且  roomPriceSetResults 非空  且  每条 resultCode === 0   → 成功
其余（含部分成功、结果明细为空、非法 JSON）                              → 失败，不上报
```

部分成功也整体判失败，理由与决策 1 一致：**跟错价是脏数据，漏跟一次只是少跟一次**。
请求体里的 `checkIllegalCommission: "T"` 说明携程服务端确实存在拒绝路径（佣金/限价校验）。

### 12.4 待验证

| # | 事项 |
|---|---|
| 1 | ⚠️ 真机验证：携程房价日历页的**所有改价入口**是否都走 `batchsetroomprice`（踩点只覆盖「批量设价」一条路） |
| 2 | ⚠️ 真机验证：`ebooking.ctrip.com` 上改价页的实际 referer 是否稳定为 `/ebkovsroom/inventory/*`（与抖音一样，referer 才是 `pageUrl` 的来源，不是地址栏） |
| 3 | 携程是否也存在「前端先 check 再 save」的双请求（抖音有，靠只收 `save_*` 规避）；踩点未见 check 请求 |
