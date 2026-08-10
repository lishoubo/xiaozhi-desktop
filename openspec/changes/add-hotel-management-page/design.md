## Context

见 `proposal.md`。当前酒店管理页是 renderer 静态 mock，`model.ts` 的 `ManagedHotel` 只服务展示；desktop 尚无 RMS 酒店 Gateway、酒店管理 IPC 或远端绑定流程。main 已有两类本地事实：`OtaCredential` 表示可复用的本地登录态，`OtaHotelProb` 表示某 credential 探测出的 OTA 酒店。`OtaHotelProbFeature` 订阅 `tab:credential-checked`，调用渠道 Probe 后写本地 repository，但当前会在 credential 已有探测记录时直接跳过。

RMS 当前 `Hotel` 和 `OtaAccount` 是远端事实来源，但本期不修改 RMS。desktop 只定义所需的 Gateway 语义并注入有状态 mock；未来真实 adapter 负责匹配 RMS 接口。真实删除酒店是必需的远端能力，RMS 如何删除及处理关联数据不属于本设计。

## Goals / Non-Goals

**Goals:**

- 建立 RMS 酒店、OTA account 与本地 credential/prob 之间明确且不泄露凭证的模型边界。
- 用可替换 Gateway 支撑远端快照、新增酒店、删除酒店、解绑和新增绑定。
- 为 OTA 页面操作增加显式 intent，并先完整设计、实现新增绑定流程。
- 复用现有渠道 Probe 和账号选择交互；`OtaHotelProbFeature` 改为只响应显式 intent，不再对无 intent 的 checked 事件做默认探测。
- 让取消、失败、重复事件和重复确认具有确定语义。

**Non-Goals:**

- 不实现真实 RMS、`apps/server` 或 tRPC adapter。
- 不设计 RMS 删除酒店的内部实现。
- 不实现重新登录、刷新失效 Cookie、更换绑定 credential 或替换已绑定 OTA 酒店。
- 不改变 RMS `Hotel`、`OtaAccount` 的持久化结构。
- 不把远端绑定复制成本地 SQLite 权威数据。

## Decisions

### 1. 分开远端酒店、OTA account 与本地登录事实

共享安全模型按远端实体定义，不再把 renderer 展示类型当作事实来源：

```ts
type RmsHotel = Readonly<{
  id: number;
  name: string;
  status: number;
}>;

type RmsOtaAccount = Readonly<{
  id: number;
  hotelId: number;
  otaHotelId: string | null;
  otaHotelName: string | null;
  status: string;
  source: ChannelId;
  bindExtra: JsonObject | null;
}>;

type RmsHotelOtaAccountsDto = Readonly<{
  hotels: readonly RmsHotel[];
  otaAccounts: readonly RmsOtaAccount[];
}>;
```

`RmsHotel` 是页面需要的最小酒店投影。`RmsOtaAccount.id` 是远端账号的稳定身份，用于精确解绑；`hotelId + source` 只用于聚合和检查同一酒店渠道是否已有活跃绑定，不能替代远端账号 ID。`RmsOtaAccount` 不包含 `orgId`、`username`、password、Cookie 或其他展示无关字段。renderer 按 `hotelId` 聚合并在 presentation 层派生紧凑展示信息。`OtaCredential` 与 `OtaHotelProb` 继续是本机事实，不增加 `rmsHotelId` 或远端 account ID。

替代方案是继续扩展 `renderer/hotel-management/model.ts` 并直接传 mock 对象；这会跳过 IPC 运行时校验，也会把远端模型和组件 presentation 混在一起，因此不采用。

### 2. 用两个窄 Gateway 表达 desktop 对远端的要求

domain port 使用框架无关接口：

```ts
interface RmsHotelGateway {
  listHotels(): Promise<readonly RmsHotel[]>;
  createHotel(input: RmsHotelCreateInput): Promise<RmsHotel>;
  deleteHotel(hotelId: number): Promise<void>;
}

interface RmsOtaAccountGateway {
  listOtaAccounts(): Promise<readonly RmsOtaAccount[]>;
  bind(input: RmsOtaAccountBindInput): Promise<RmsOtaAccount>;
  unbind(otaAccountId: number): Promise<void>;
}
```

`RmsOtaAccountBindInput` 包含 `operationId`、`hotelId`、`source`、`otaHotelId`、`otaHotelName`、`bindExtra` 和渠道 Cookie 快照。它不包含由 renderer 提交的 `orgId`，也不把本机 `credentialId` 当作远端字段。

本期两个有状态 mock Gateway 在 main composition root 构造，mutation 后返回或暴露更新后的远端事实。mock 不进入 renderer，页面不得直接 import mock 数据。真实接入时，先在 `packages/api` 定义同语义共享 contract，再由 `apps/server` adapter 调用 RMS 授权接口；RMS 需要提供完整列表、新增/删除酒店、创建/删除绑定能力，但其内部实现不在本 change 范围。

替代方案是一个包含所有操作的 `HotelManagementGateway`。拆分后权限、测试替身和未来 adapter 与两个远端聚合边界一致，也避免 OTA Cookie 输入出现在普通酒店操作接口上。

### 3. 页面查询、CRUD 与绑定由不同职责响应

酒店管理是现有 `/hotels` 路由下的 `HotelManagementPage.svelte`，不是新的 Electron 窗口。页面挂载时由 renderer 页面控制器调用 `window.hotelButler.hotelManagement.load()`；它只维护 loading/error/snapshot 和弹窗状态，不直接读取 Gateway 或本地 repository。

```text
HotelManagementPage.onMount
  → preload.hotelManagement.load()
  → registerHotelManagementHandlers 校验 sender 与空参数
  → HotelManagementFeature.load()
      ├→ RmsHotelGateway.listHotels()
      └→ RmsOtaAccountGateway.listOtaAccounts()
  → RmsHotelOtaAccountsDto
  → renderer 按 otaAccount.hotelId 聚合并渲染
```

`HotelManagementFeature` 负责远端列表、新增酒店、删除酒店和解绑的应用编排。IPC handler 只做信任边界校验和调用转发，Gateway 只负责远端访问。新增、删除与解绑成功后，renderer 统一重新调用 `load()`；不在本地数组中模拟远端成功。

preload 的职责按业务边界拆成两个 namespace：

```text
hotelManagement
  load
  createHotel
  deleteHotel
  unbindOtaAccount(otaAccountId)
  startBinding({ hotelId, credentialId })
  confirmBinding({ operationId, otaHotelId })
  cancelBinding(operationId)
  onBindingCandidatesReady
  onBindingFailed

otaCredential
  listByChannel(channel)  // 已有
```

credential 列表属于通用本地登录能力，不放入 `hotelManagement`。酒店管理页直接复用现有 `otaCredential.listByChannel` IPC；该 handler 已经调用 `OtaCredentialRepository.listByChannel` 并返回 `OtaCredentialDto[]`。renderer 再复用现有 `buildLoginCredentialOptions` 将 DTO 转成选择项，不新增 `listOptionsByChannel`、新的 preload 方法或专门的 credential 查询类。

现有 `OtaCredentialDto` 包含 `partitionName`，因为 BrowserWorkspace 用它判断活动登录态。本 change 不顺手重构该既有 contract；酒店绑定 UI 不展示或回传 `partitionName`，`startBinding` 只接收 `hotelId/credentialId`。`RmsHotelOtaAccountsDto` 和任何远端 mutation 均不包含 partition、Cookie 或完整 credential。

shared 层使用严格 Zod schema 校验新增 IPC 输入、返回值和 main→renderer 事件。main handler 继续校验 sender；renderer 只能提交公开 ID 和表单字段，不能创建 intent，也不能提交 Cookie 或任意 URL。

### 4. renderer 先选择 RMS 酒店和渠道，再查询通用 credential 列表

现有 `AccountSwitcherDialog` 同时负责账号选择、活动 tab、Cookie 导入和新登录。新增绑定只需要“列出指定渠道的安全 credential 摘要并选择一项”。实现时抽取可复用的 credential 列表/选择视图，绑定弹窗提供以下上下文：

```text
RMS 目标酒店 + 目标渠道
  → 同渠道本地 credential 摘要
  → 选择 credential
  → startBinding
```

完整入口流程为：

```text
用户在 RMS 酒店 H1 行点击“新增绑定”
  → renderer 记录目标 hotelId=H1
  → 用户选择尚未绑定的渠道 C
  → otaCredential.listByChannel(C)                 // 复用已有 IPC
  → buildLoginCredentialOptions(credentials)       // 复用已有 renderer helper
  → 用户选择 credential K1
  → hotelManagement.startBinding({ hotelId: H1, credentialId: K1 })
```

选择组件只展示 `credentialId` 对应的渠道和账号标签，不展示 DTO 中的 `partitionName`。本期没有 credential 时只引导用户先去浏览器工作区完成登录，不从该弹窗创建新登录。

`startBinding` 属于酒店绑定命令，不能由 renderer 先调用普通 `otaCredential.openExisting` 再补交 intent：这样 intent 来源不可信，且绑定上下文与 tab 可能串线。renderer 只表达“用 K1 给 H1 新增绑定”；main 的 `HotelBindingFeature` 才创建业务 operation 和可信 intent。

### 5. 在 `features/` 下集中定义 OTA intent 和跨 Feature 事件

intent 属于 OTA tab 的通用执行上下文，不属于 hotel-management 或 `OtaHotelProbFeature`。为避免各 Feature 重复定义协议，本期在 `apps/desktop/src/main/features/` 建立三个公共文件：

```text
features/
  ota-intent.ts             // 所有 OtaTabIntent variant
  ota-event-models.ts       // 跨 Feature 的纯业务结果和 OtaEventMap
  ota-tab-intent-bus.ts     // OtaTabIntentBus 实现
```

`ota-event-models.ts` 定义 `ProbedHotel`、纯业务结果、callback key 常量及其类型映射；`ota-intent.ts` 引用 callback key 并定义 intent union。这样 key 只有一个事实来源，后续重新登录、会话检查或其他 OTA 页面能力继续扩展对应模型：

```ts
// ota-event-models.ts
const OTA_HOTEL_PROB_RESULT_CALLBACK = 'otaHotelProbResultCallback' as const;

// ota-intent.ts
type ProbeOtaHotelsIntent = Readonly<{
  kind: 'PROBE_OTA_HOTELS';
  resultCallbackKey: typeof OTA_HOTEL_PROB_RESULT_CALLBACK;
}>;

type OtaTabIntent = ProbeOtaHotelsIntent;
```

两个字段分别表达：

- `kind`：tab 要执行的能力；这里是主动探测 OTA 酒店。
- `resultCallbackKey`：执行完成后使用哪个稳定回调键发布业务结果；它不是随机值。本次使用 `otaHotelProbResultCallback`，词序与现有 `OtaHotelProbFeature` 一致，其他业务可以定义自己的 callback key。

intent 不包含 `requestId`、`intentId`、`operationId` 或 `OtaTabIntentEventKey`。这些字段既不是 tab 要执行的能力，也不是结果回调类型。没有 intent 表示沿用现有默认行为，不需要额外的 `LOCAL_DISCOVERY` variant。

main 创建 intent 的流程如下：

```text
registerHotelManagementHandlers.startBinding
  → HotelBindingFeature.start({ hotelId, credentialId })
      ├→ 从当前 RMS 数据/Gateway 确认酒店存在且目标渠道未绑定
      ├→ OtaCredentialRepository.findById(credentialId)，由 credential 推导 channel
      ├→ 确认当前没有未排空的绑定流程
      ├→ 创建并保存 ActiveHotelBinding(operationId, hotelId, credentialId, channel, ...)
      └→ LoginTabOpener.openExistingForIntent(credential, {
           kind: 'PROBE_OTA_HOTELS',
           resultCallbackKey: 'otaHotelProbResultCallback'
         })
           → BrowserManager.createWithAlreadyPartition(...)
           → 注入 LoginUrlMatcher、credential 回调和 tab-bound intent
      → 标签页创建成功后向 renderer 返回 { operationId }
```

如果 credential 校验或标签页创建失败，`startBinding` 清理尚未开始的 `ActiveHotelBinding` 并直接拒绝 IPC，不留下占用中的流程。

`HotelBindingFeature` 负责查询并校验 renderer 选中的 credential、创建 operation 和 intent，然后委托 `LoginTabOpener` 开页。`LoginTabOpener` 只负责把 credential partition、渠道登录判定和 intent 交给 BrowserManager，不理解 RMS 酒店绑定规则。`BrowserManager` 只把 intent 保存到对应 `ManagedTab` 并随事件透传，不解释 `kind` 或 `resultCallbackKey`。

现有普通 `otaCredential.openExisting` 没有 `LoginUrlMatcher/onUrlPastLogin`，只会广播 `not-applicable`，不能直接复用为绑定入口。`LoginTabOpener.openExistingForIntent` 必须挂上登录后判定；判定成功后返回调用前选中的 credential，而不是依赖 `DiscoverAndCreate.bound` 再做一次 credential 创建流程。

```text
OTA 页面越过登录页
  → BrowserManager.checkUrlPastLogin()
  → credential 回调返回已选择的 OtaCredential
  → TabEventBus.emitCredentialChecked({ outcome, intent, ... })
  → OtaHotelProbFeature 收到同一个 tab 的 credential + intent
```

intent 必须绑定到具体 tab，不能使用全局“当前 intent”，避免两个标签页串线。renderer 不创建或提交 intent。

### 6. 用 `OtaTabIntentBus` 按 callback key 发布纯业务结果

`TabEventBus` 继续只广播浏览器与 credential 检查事实。Feature 执行 intent 后产生的结果走独立的 `OtaTabIntentBus`，防止把两个方向塞进同一个事件总线：

```ts
// ota-event-models.ts
type OtaHotelProbResult =
  | Readonly<{
      kind: 'HOTELS_PROBED';
      hotels: readonly ProbedHotel[];
    }>
  | Readonly<{
      kind: 'PROBE_FAILED';
      reason: 'CREDENTIAL_MISSING' | 'NOT_PROBEABLE' | 'PROBE_FAILED';
    }>;

type OtaEventMap = Readonly<{
  [OTA_HOTEL_PROB_RESULT_CALLBACK]: OtaHotelProbResult;
}>;
```

`ota-tab-intent-bus.ts` 只实现类似现有 `TabEventBus` 的订阅与广播能力。它可以 type-only import `OtaEventMap` 获得 key 与 payload 的对应关系，但不定义或判断任何具体 intent、callback key、Probe 结果或酒店绑定规则：

```ts
// ota-tab-intent-bus.ts
interface OtaTabIntentBus {
  on<K extends keyof OtaEventMap>(
    resultCallbackKey: K,
    callback: (result: OtaEventMap[K]) => void,
  ): () => void;

  publish<K extends keyof OtaEventMap>(
    resultCallbackKey: K,
    result: OtaEventMap[K],
  ): void;
}
```

`OtaHotelProbResult` 是 `ota-event-models.ts` 中的纯业务结果，只包含 Probe 成功/失败及现有 `ProbedHotel` 数据，不包含 credential、channel、intent 或酒店绑定 operation 字段。`OtaEventMap` 保持 `resultCallbackKey → result type` 的编译期对应关系；Bus 只消费这个映射来提供类型安全的通用能力，不能退化为 `string + unknown/any`。`on` 返回取消监听函数，由 composition root 在窗口关闭时释放。

`HotelBindingFeature` 在构造/装配时注册一次稳定回调，而不是为每次 operation 注册一个动态事件：

```ts
intentBus.on('otaHotelProbResultCallback', (result) => {
  this.handleOtaHotelProbResult(result);
});
```

由于 callback 在接受任何 `startBinding` 请求前已经注册，不存在“页面探测太快、结果先于监听”的竞态。`HotelBindingFeature` 自己持有唯一的 `ActiveHotelBinding`，包括 RMS hotel、credential、channel、tab 和业务 `operationId`；Probe Feature 与结果模型都不理解这些绑定上下文。

`OtaHotelProbFeature` 本期改为只响应显式 intent，不再对普通浏览产生副作用：

```text
收到不带 intent 的 checked 事件
  → 静默 return，不探测、不写入 OtaHotelProb

收到 intent.kind = PROBE_OTA_HOTELS
  → 主动 Probe（不存在旧的 credential 级短路可跳过）
  → 保存或刷新本地 OtaHotelProb
  → intentBus.publish(intent.resultCallbackKey, {
       kind: 'HOTELS_PROBED',
       hotels
     })

收到未来其他 intent kind
  → 忽略，由对应 Feature 处理
```

这是对现有行为的收窄：普通打开 OTA 页面（无绑定意图）不再产生或刷新 `OtaHotelProb` 记录，只有携带 `PROBE_OTA_HOTELS` intent 的酒店绑定流程会写入。项目内当前没有其他 Feature 依赖无 intent 场景下产生的 `OtaHotelProb` 记录；若未来出现需要"打开页面即探测并记录"的场景，应为其定义新的 intent kind，而不是恢复隐式默认探测。

Probe 正常完成但没有酒店时发布 `HOTELS_PROBED` 且 `hotels=[]`；找不到 credential、URL 不可探测或 Probe 抛错时发布 `PROBE_FAILED`。显式 intent 一旦到达可执行的 checked 事件，必须产生一个终态结果，不能静默 return 让发起方永久等待。

`OtaHotelProbFeature` 不 import 或调用 `HotelBindingFeature`，也不发送 renderer IPC。它只理解 `PROBE_OTA_HOTELS` 并把结果发布到 intent 指定的 callback key。

`HotelBindingFeature.handleOtaHotelProbResult` 收到结果后：

1. 读取当前唯一的 `ActiveHotelBinding`；没有活动流程时将结果视为无消费者结果并记录安全日志；
2. 失败或空列表时把当前 operation 置为 `FAILED` 并通知 renderer；
3. 有候选时保存候选，将当前 operation 置为 `AWAITING_CONFIRMATION`；
4. 向 renderer 发送只含 `operationId`、RMS 酒店、渠道和 OTA 酒店候选的业务事件。

`resultCallbackKey` 不进入 renderer；renderer 后续仍以 `operationId` 确认候选。

固定 callback key 本身不区分并发执行，因此本期明确只允许一个未排空的酒店绑定流程。`startBinding` 在当前流程处于探测、等待确认、提交或取消后等待 tab/probe 结束时拒绝第二次启动。取消时关闭对应 tab 并撤销其 tab-bound intent；只有旧流程已收到终态 Probe 结果，或 BrowserManager 确认该 tab 在 Probe 开始前已关闭且不会再发布结果，才清空上下文并允许下一次绑定。这样无需把关联 ID 塞入 intent 或 `OtaHotelProbResult`，也不会把旧结果应用到新酒店。

### 7. 用户确认后才导出 Cookie 和创建绑定

`ActiveHotelBinding` 是 main 内存中的单实例业务状态机：

```text
PROBING
  → AWAITING_CONFIRMATION
  → SUBMITTING
  → COMPLETED

任一未完成状态 → CANCELLING / CANCELLED / FAILED
```

候选规则：0 个显示失败；1 个仍需确认；多个先选一个再确认。这是流程中的第二次酒店选择：入口处选的是目标 RMS 酒店，此处选的是要绑定的 OTA 酒店。renderer 调用 `confirmBinding(operationId, otaHotelId)` 后，`HotelBindingFeature` 必须重新检查：

- operation 仍处于 `AWAITING_CONFIRMATION`；
- 候选属于该 operation；
- RMS 酒店仍存在且目标渠道没有活跃绑定；
- credential、channel 与 `ActiveHotelBinding` 开始时保存的选择一致。

通过后，main 从该 credential 的 partition 读取 Cookie，按现有渠道 Cookie 域名规则过滤，确定性排序并限制总大小。Cookie 快照只在 main 内存中短暂存在，直接传给 `RmsOtaAccountGateway.bind`；不得进入 renderer、SQLite、通知文本或普通日志。

绑定成功后 operation 变为 `COMPLETED` 并触发页面重新加载。Cookie 导出或 Gateway 失败时变为 `FAILED`；本地 prob 可保留，但 UI 不显示已绑定。

### 8. 删除酒店与解绑完全服从远端结果

`deleteHotel` 是 desktop 对真实远端的明确接口要求。desktop 在确认后调用它；远端成功才刷新列表，远端拒绝则原样展示安全错误。desktop 不猜测 RMS 会软删、硬删、级联还是拒绝有关联账号的酒店，也不在调用前自动解绑。

`unbind(otaAccountId)` 用远端稳定主键精确删除指定 OTA 绑定。`hotelId + source` 只用于展示聚合和新增绑定唯一性检查，不作为解绑身份。成功解绑后，本地 credential、partition 和 prob 仍可能被其他酒店绑定或普通浏览复用，因此全部保留。

### 9. 幂等、取消与日志

- `operationId` 只属于酒店绑定业务：供 renderer 确认/取消并作为远端 bind 幂等键，不进入 `OtaTabIntent` 或 `OtaHotelProbResult`；同一 operation 只允许从确认态进入一次提交态。
- 页面重复点击、重复事件及网络重试不得产生第二次 create 调用语义。
- 关闭对应 tab、显式取消或应用退出会取消未提交 operation；取消中的旧 tab/probe 排空前不接受新的绑定流程，进程重启不恢复等待确认的 operation。
- 候选弹窗等待期间不持有数据库事务。
- 日志只记录 operationId、渠道、RMS hotel ID、结果种类和候选数量，不记录 Cookie、partition、用户名或 `bindExtra` 原文。

## Risks / Trade-offs

- [mock Gateway 与未来 RMS contract 漂移] → Gateway 输入输出使用严格 schema；真实接入前先在 `packages/api` 固化 contract，并用 adapter contract test 替换 mock。
- [已有 credential 的普通打开路径不触发登录后检查] → 在现有 `LoginTabOpener` 增加 `openExistingForIntent`，为它挂上 `LoginUrlMatcher` 和 tab-bound 回调，并覆盖主导航与页内导航的定向测试。
- [已有 prob 去重导致绑定不触发] → `OtaHotelProbFeature` 不再对无 intent 的 checked 事件做默认探测，`PROBE_OTA_HOTELS` intent 始终主动重新探测，不受历史记录影响。
- [稳定 callback key 无法区分并发流程] → 本期只允许一个未排空的 `ActiveHotelBinding`；第二次启动明确失败，不向业务结果添加关联字段。
- [取消后旧 Probe 结果迟到并污染下一次绑定] → 取消进入 `CANCELLING`，关闭 tab/撤销 intent，并在旧执行确认终止前禁止启动下一次绑定。
- [Cookie 采集范围过宽] → 将现有 cookie import 域名映射抽成共享 main policy，导出时只允许目标渠道域名并设置大小上限。
- [酒店删除的 RMS 语义未知] → desktop 只依赖显式 delete 接口并展示远端结果，不设计或模拟服务端级联规则。

## Migration Plan

1. 先加入共享模型、Gateway port 与有状态 mock，不改变现有页面。
2. 接入酒店管理 IPC 并将页面从静态 mock 切换到 mock Gateway 快照。
3. 依次开启新增酒店、删除酒店和解绑；每项失败均以远端 mock 结果为准。
4. 加入 binding operation、intent、候选确认和 Cookie 导出，保持普通本地探测回归测试通过。
5. 未来真实接入时先发布共享 server contract，再在 composition root 将 mock Gateway 替换为远端 adapter；renderer 与绑定 Handler 不变。

回滚新增绑定功能时可停止暴露对应 IPC 和入口，不删除本地 credential/prob。回滚远端 adapter 时可重新注入 mock；任何回滚均不得清理用户 partition。

## Open Questions

- RMS Cookie jar 的最终序列化格式与请求大小限制由真实 adapter 接入时确认；不改变 Cookie 仅在 main 导出和传输的边界。
- 各渠道是否需要在 Cookie 白名单之外补充 localStorage/sessionStorage，由后续真实绑定验证决定；本期 Gateway mock 只接收 Cookie 快照。
