## Context

动机见 `proposal.md`，行为契约见 `specs/`。这里只记录实现取舍。

上一个 change（`bind-hotel-flow`）留下的接缝，本次是它们的**第二例**——当时判断「等第二例再抽象」，现在验证这个判断：

| 接缝 | 位置 | 本次怎么用 |
|---|---|---|
| `OtaTabIntent` union | `ota-tab/intent.ts` | 加第二种 kind |
| `UiWaitingResultPayloads` 映射表 | `shared/types/ui-waiting-result-types.ts` | 加第二种 kind |
| `openExisting(credentialId, intent)` | `ota-tab/ota-tab-service.ts` | 原样复用 |
| `createWaitingUiResult` | `renderer/waiting-ui-result.ts` | 原样复用 |
| `suspendViewport/resumeViewport` | `browser-ota-tabs.svelte.ts` | 原样复用 |
| `createNavigationIntent` | `renderer/navigation-intent.ts` | 建第二条实例 |
| `findByChannelAndHotelId` | `database/ota-hotel-repository.ts` | 老数据反查直接用，**无需新增仓储方法** |

已确认的既有事实：

| 事实 | 影响 |
|---|---|
| `TabCredentialCheckedEvent` 已带 `credential` + `intent` | B 路要的信息在登录判定完成那一刻就齐了，不需要新事件 |
| `bindExtra` 目前只有 `merchantGroupId`/`otaPartnerId`，全部来自探测候选 | `channelAccountId` 的**写入侧本次才建**，不是已有数据 |
| `RmsOtaAccountGateway` 只有 `listOtaAccounts`/`bind`/`unbind` | B 路终点无处可落，需新增方法 |
| `bind()` 有「同 hotelId+source 已存在活跃绑定」拒绝规则 | B 路**不能**用 `bind` 实现——挡住它的正是要修的那条记录 |
| RMS 状态枚举未与服务端对齐 | 触发状态清单不在本次收口，代码里留一处集中定义 |

## Goals / Non-Goals

**Goals:**

- 两条恢复路线（刷新登录态 / 重新绑定）共用同一套 tab + 等待 + 弹窗机制，不建第二套
- `channelAccountId` 写入侧就位，让此后的远端记录自带账号关联，逐步摆脱「绕 `ota_hotel` 反查」
- 匹配失败不阻断——凭证可能已清理、可能换设备

**Non-Goals:**

- 不收口 RMS 状态枚举（服务端对齐后再做）
- 不做「过滤规则从远端下发」——本次规则硬编码在 renderer，与 mock 的业务规则对齐
- 不改三渠道 probe 实现
- 不为 B 路做失败重试/超时（与 `bind-hotel-flow` 的结论一致：超时值无法合理选取）

## Decisions

### 决策 1：B 路是事件总线的**兄弟订阅者**，不是 dispatcher 的分支

B 路要的是「登录判定完成 → **核对账号身份** → 拿新 cookie 更新远端」，全程不碰 probe。

```
LoginDetector（登录判定，triggerDiscovery 写库完成后广播）
   │
   └─ tab:credential-checked { credential, intent, webContents }
        ├─→ HotelProbeDispatcher      intent.kind === 'bind-hotel'  → probe → 候选
        └─→ OtaReauthDispatcher       intent.kind === 'reauth-ota'  → 比对身份 → 发结果
             （本次新增，channels/）        ↑ 两者互斥，各看各的 kind
```

| 方案 | 结论 |
|---|---|
| A. dispatcher 内部加 `if (kind === 'reauth')` 提前 return 并发通知 | ✗ 它叫 `HotelProbeDispatcher`，职责是「探测的调度」。塞进一条不探测的路径，名字和内容就对不上了 |
| B. 独立订阅者，各认各的 intent kind | **✓** 事件总线本来就是多订阅者模型；两条路线互不感知，加第三种 kind 时同样只加订阅者 |

`OtaReauthDispatcher` 同样放 `channels/`（与 probe dispatcher 并列）——它也是「订阅标签页事实 → 做渠道相关的事」，且同样需要 `notify` 窄回调（`channels/` 不认识 ipc/electron）。

**为什么不能复用 `HotelProbeDispatcher` 的 notify**：两者 payload 不同（一个是候选列表，一个是「成功了」），走各自的 envelope kind。

### 决策 1b：B 路必须核对账号身份，否则会把 cookie 串到别的绑定上

**「登录判定完成」不等于「登录的还是原来那个账号」。** `LoginDetector` 只判断 URL 离开了
登录页；用户完全可能在页面上登了另一个账号（浏览器里残留着别的登录态、手滑登错）。

不核对的后果不是「白跑一趟」，而是**把账号 B 的 cookie 更新到账号 A 的那条绑定上**——
远端记录的门店关系没变、状态还变成正常了，实际却指向另一个账号的登录态。这比原来的
「过期」更糟，且不会报错。

核对**不需要新的渠道适配器**：`triggerDiscovery` 已经完成身份识别并把
`channelAccountId` 写进 credential，事件里直接可读。所以：

```
intent 里带 expectedChannelAccountId（发起时用户选的那个账号）
        ↓
credential.channelAccountId === intent.expectedChannelAccountId ?
   ├─ 是 → notify { ok: true, credentialId }
   └─ 否 → notify { ok: false, actualChannelAccountId }
```

| 方案 | 结论 |
|---|---|
| A. 不核对，登录成功即视为刷新成功 | ✗ 上述串号问题，静默且后果比原状态更糟 |
| B. 新增一种 probe 专门读身份 | ✗ 重复造轮子——`triggerDiscovery` 已经读过了，再读一次还多操作一次页面 |
| C. 比对 `credential.channelAccountId` | **✓** 零新增渠道代码，dispatcher 比 `HotelProbeDispatcher` 还薄 |

**不一致时不自动降级到 A 路**：弹窗保持打开、提示实际登录的是别的账号、让用户回到列表
重新选择。想换账号有「新登录账号」入口（走 A 路），两条路各司其职；替用户决定"那就改成
重新绑定吧"会让一次误操作直接改掉门店关系。

### 决策 2：B 路的终点是新增 `reauthenticate`，不是 `bind`

```ts
export interface RmsOtaAccountGateway {
  listOtaAccounts(): Promise<readonly RmsOtaAccount[]>;
  bind(input: RmsOtaAccountBindInput): Promise<RmsOtaAccount>;
  unbind(otaAccountId: number): Promise<void>;
  /** 只换凭证：门店关系不变，因此不吃 otaHotelId/bindExtra。 */
  reauthenticate(input: RmsOtaAccountReauthInput): Promise<RmsOtaAccount>;
}

export type RmsOtaAccountReauthInput = Readonly<{
  operationId: string;
  otaAccountId: number;                       // 要修的是哪条绑定
  cookies: readonly RmsCookieSnapshotEntry[];
  channelAccountId: string | null;            // 顺带补齐老记录的账号关联
}>;
```

| 方案 | 结论 |
|---|---|
| A. 复用 `bind()` | ✗ 会撞「已存在活跃绑定」——挡住它的正是要修的那条记录 |
| B. 先 `unbind()` 再 `bind()` | ✗ 中间态：失败会把一条本来只是过期的绑定变成没有绑定，比原状态更糟 |
| C. 新增 `reauthenticate()` | **✓** 语义与用户动作一一对应；门店关系不进参数＝类型上就保证不会被改 |

真实 RMS 接口形状未知（见 Risks）。按 `bind` 当初的处理：接口先定，实现落 mock，真实接入时只换实现。

### 决策 2b：两端都挂 `HotelManagementService`，cookie 读取复用现成能力

`startReauth` / `confirmReauth` 挂在 `HotelManagementService` 上，与
`startBinding`/`confirmBinding` 并排——该类的现有职责就是「绑定流程的两端」，重新登录是
同一形状的第二例，且**零新增依赖**：

| `confirmReauth` 需要 | 现状 |
|---|---|
| `readCookieSnapshot` | ✅ 已注入（`confirmBinding` 在用） |
| `otaCredentialRepository.findById` | ✅ 已注入 |
| `otaAccountGateway` | ✅ 已注入（加 `reauthenticate` 方法） |
| `generateRequestId` / `logger` | ✅ 已注入 |

新建 `OtaReauthService` 要把这五个依赖再注一遍，而它操作的是同一批远端账号记录。

```ts
/** 只换凭证，不动门店关系——因此不写本地 ota_hotel（没有要更新的东西）。 */
async confirmReauth(input: ConfirmReauthInput): Promise<RmsOtaAccount> {
  const credential = this.deps.otaCredentialRepository.findById(
    toOtaCredentialId(input.credentialId),
  );
  if (!credential) throw new Error('未找到该登录凭据');

  const cookies = await this.deps.readCookieSnapshot(credential.partitionName);
  return this.deps.otaAccountGateway.reauthenticate({
    operationId: this.deps.generateRequestId(),
    otaAccountId: input.otaAccountId,
    cookies,
    channelAccountId: credential.channelAccountId,
  });
}
```

比 `confirmBinding` 更简单：**没有本地写入那半段**，因此不存在「远端成功、本地失败」的
两难（那个问题在 `bind-hotel-flow` 里修过）。

**cookie 的时序与形状**（复用 `app-scope.ts` 的 `readCookieSnapshot`，不新写）：

| 要点 | 现状 |
|---|---|
| 格式含 `domain` | ✅ `{domain, name, value}`，即 `RmsCookieSnapshotEntry` |
| 是最新的 | ✅ 调用瞬间从该 partition 的实时 session 读，不走缓存、不落本地 |
| 时序 | **必须先登录成功、再读**——所以读取在 `confirmReauth`，不在 dispatcher |
| 读取位置 | service 层。`channels/` 不得碰 session（eslint 禁止），dispatcher 只负责比对与通知 |

⚠ `cookies.get({})` 不传过滤条件，返回该 partition 下所有域的 cookie（含统计/CDN 等第三方
域）。现有 `bind` 就是这么做的，B 路保持一致。**按域白名单过滤是个独立议题**（涉及传给
远端的数据量与敏感面），不在本次范围。

### 决策 3：账号匹配两条来源，新数据优先

```
RmsOtaAccount
   ├─ bindExtra.channelAccountId ──直接匹配──→ OtaCredential.channelAccountId   【新数据】
   │                                            （同 channel 内唯一）
   └─ (source, otaHotelId) ──→ ota_hotel ──→ credentialId ──→ OtaCredential     【老数据】
                                findByChannelAndHotelId（已存在，无需新增）
```

顺序是「先新后老」：新数据的关联是绑定那一刻写下的事实，老数据的反查依赖本地 `ota_hotel` 有对应记录——而该表可能被清理、也可能因为绑定发生在别的设备上而根本没有。

匹配纯粹是**展示增强**，命中与否都不改变可选项集合。这一点写进 spec 的「匹配不到任何本地凭证」场景，实现上体现为：匹配结果只用于加标注，不参与过滤。

计算放 renderer 的纯函数（`hotel-management/model.ts` 旁），输入是「远端账号 + 该渠道凭证列表 + 本地酒店记录」，输出是「哪个 credentialId 该标注」——可穷举测试，不需要起主进程。

### 决策 4：`channelAccountId` 在 service 层合入，不在 renderer 拼

`confirmBinding` 已经握有 credential（要读 `partitionName` 取 cookie），顺手取 `channelAccountId` 即可：

```ts
// hotel-management-service.ts confirmBinding 内
bindExtra: withChannelAccountId(input.hotel.bindExtra, credential.channelAccountId),
```

renderer 侧不碰——它拿到的候选 `bindExtra` 是探测产物，不该由它去拼账号关联（renderer 甚至不该关心远端记录的形状）。

`channelAccountId` 为空时省略字段而非写 `null`（spec 的「凭证没有渠道账号标识」场景）：`null` 会让下次读取无法区分「没有这个字段」和「这个字段是空的」。

### 决策 5：过滤在 renderer 做，用已经加载好的数据

酒店管理页 `load()` 已经同时拿到 `hotels` 与 `otaAccounts`，「这家酒店在哪些渠道已有绑定」是这份快照的纯派生：

```ts
// 已绑定渠道集合 = 该酒店的远端账号里所有活跃的 source
const boundChannels = new Set(
  accountsOfHotel.filter(isActiveBinding).map((a) => a.source),
);
```

不新增 IPC。「什么算活跃绑定」与状态枚举同源，收在一处定义（见决策 6）。

### 决策 6：状态判断集中一处，等服务端对齐

本次涉及两处状态判断：「哪些状态算需要重新登录」「哪些状态算活跃绑定」。两者都依赖尚未对齐的 RMS 枚举。

集中到 `renderer/hotel-management/account-status.ts`：

```ts
/** ⚠ 待与 RMS 服务端对齐（openspec/changes/add-ota-reauth-and-channel-filter）。 */
export function needsReauth(status: string): boolean;
export function isActiveBinding(status: string): boolean;
```

对齐时只改这一个文件。**不**散落 `['LOGIN_FAILED', 'LOGIN_EXPIRED', ...]` 这类字面量数组——`HotelManagementPage.svelte:26` 现在就有一处，本次一并收进来。

### 决策 7：两个弹窗的「新登录账号」入口指向同一条既有路径

「新登录账号」＝ `browserOtaTabs.openForNewLogin(channelId, url)`，与浏览器工作区「新建账号」完全同一条链。差别只在**开完之后做什么**：

| 入口 | 开 tab 后 |
|---|---|
| 浏览器工作区「新建账号」 | 什么都不做（用户自己逛） |
| 新增绑定弹窗的快捷入口 | 带 `bind-hotel` intent，登录成功后探测候选 |
| 重新登录弹窗的「新登录账号」 | 同上（A 路：换了账号要重新确认门店） |

所以两个弹窗的快捷入口在实现上是同一件事：**带着绑定意图开一个新登录 tab**。这需要 `openForNewLogin` 也支持 intent（目前只有 `openExisting` 支持）——本次补上，形状与 `openExisting` 一致。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 真实 RMS 没有「只更新凭证」接口 | 接口先定、实现落 mock（与 `bind` 同样的处理）。真接不上时退路是「先 unbind 再 bind」，但那是有损的，届时需要产品决策——**不在本次静默降级** |
| `ota_hotel` 目前是空表（`bind-hotel-flow` 的落库验证尚未跑通） | 老数据反查这条路**短期内几乎必然匹配不上**。已在 spec 里把「匹配不到」定义成正常路径而非异常 |
| 状态枚举未对齐，`needsReauth`/`isActiveBinding` 现在是猜的 | 集中一处 + 注释标记来源。对齐前按用户口述的三类（失效/过期/绑定失败）处理 |
| 过滤按渠道整体做，可能挡掉用户真正想绑的另一个账号 | 这是远端规则的镜像，不是本地策略——展示了也会被拒绝。若远端将来允许一渠道多绑，此处与 mock 规则同步放开 |
| B 路「刷新成功」的通知与 A 路候选通知共用一条 IPC 频道 | envelope 的 `kind` 已经区分，`createWaitingUiResult` 按 `requestId` 认领——两条流程的 requestId 不同，天然隔离 |
| 用户在 B 路中途关掉 tab | 与 A 路一致：`LoginDetector` 的 `tab:closed` 清掉 intent，等待随组件卸载消亡 |
| 用户登录了另一个账号 | 决策 1b 的身份核对拦住，提示后回到账号列表重选；**不静默更新远端** |
| 渠道账号标识为空的老凭证（`channelAccountId` 可空） | 无法核对身份 → 按不一致处理（拒绝刷新），而不是放行。宁可让用户走 A 路重新绑定，也不赌 |

## Migration Plan

无数据迁移。`bindExtra.channelAccountId` 是增量字段，老记录读不到时走反查路径。新增 IPC 频道与 gateway 方法属增量。

## Open Questions

无。匹配依据、两条路线的分界、过滤口径、写入侧归属均已与用户确认。状态枚举待服务端对齐，但已隔离到单一文件，不影响本次的接口形状与任务拆分。
