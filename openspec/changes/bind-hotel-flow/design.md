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
【浏览器工作区】用户发起绑定
   │
   │ ① ipc hotelManagement.startBinding(credentialId, rmsHotelId)
   │      └→ HotelManagementService 生成 requestId
   │         └→ OtaTabService.openExisting(credId, {kind:'bind-hotel', requestId})
   │      ←─ 返回 { requestId }
   │
   │ ② renderer: waiting.await('bind-hotel', requestId, cb) → cancel
   │
   ├── 主进程侧（与上面不是同一条调用栈）───────────────
   │   LoginDetector.register(tabId, channel, intent)
   │      → 导航 → 判定 → 写 credential
   │      → TabEventBus 广播（事件带 intent）
   │      → HotelProbeDispatcher：选 probe → probe() → 候选
   │           · webContents.isDestroyed() → 丢弃
   │           · notify({requestId, kind, payload:{credentialId, hotels}})
   │              └→ composition root 接到 webContents.send
   │
   │ ③ renderer 收到，requestId 匹配 → 就地弹窗（不跳转）
   │      ├─ 否决 → 关弹窗，可换渠道重来
   │      └─ 选定 → ipc hotelManagement.confirmBinding(...)
   │                  └→ gateway.bind() → 成功后 repository.save()
   └─
```

①② 是一条链（发起 + 登记等待），③ 是另一条（结果送达）。**中间隔着事件总线，不是函数返回**。

| 方案 | 结论 |
|---|---|
| A. `startBinding` 返回 Promise，等探测完成才 resolve | ✗ 探测可能永不发生（用户没登录成功/关了 tab），Promise 永久挂起；主进程必须保存 resolve 回调 = pending 状态 |
| B. 发起与结果分离，用 requestId 关联 | **✓** 主进程无状态；用户放弃时 renderer 单方面取消即可 |

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
gateway.bind(...)  ──成功──> repository.save(...)
       │
       └──失败──> 抛出，不写本地
```

理由：远端是绑定关系的权威。若先写本地再写远端，远端失败会留下「本地有、远端无」的孤儿记录，而本地表根本不表达绑定关系，这条记录无从解释。反向则最坏只是「远端有、本地无酒店信息」，下次探测保存即可自愈。

### 决策 7：cookie 快照从哪来

`RmsOtaAccountBindInput` 要求 `cookies: RmsCookieSnapshotEntry[]`。凭证的 partition 里有实时 cookie，需在 `confirmBinding` 时从对应 session 读取。

`services/` 不得 import `browser/`（eslint），因此读 cookie 的能力由 composition root 注入窄回调 `readCookieSnapshot(partitionName) => Promise<RmsCookieSnapshotEntry[]>`，实现落在 composition 层调用 `sessionFactory`。

### 决策 8：弹窗位置

挂在 `components/browser/`（浏览器工作区），不挂酒店管理页。用户否决后要能立刻换渠道重试，跳转会把一个循环拆成往返。

因此**不需要跨路由 intent**——用户全程不离开浏览器页。监听器随弹窗组件挂载/卸载。

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
