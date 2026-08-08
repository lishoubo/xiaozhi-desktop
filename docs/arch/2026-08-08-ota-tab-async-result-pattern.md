# OTA 标签页异步结果对接范式

**适用场景**：UI 发起一个流程 → 打开 OTA 标签页 → 用户在页面上操作（登录/验证）→
主进程从这次操作里得到结果 → 结果回到发起方的 UI。

典型例子：绑定酒店（探测门店候选）、重新登录（校验账号身份）。**新增同类流程时照本文
对接，不要另起一套机制。**

## 为什么不能用一次 invoke 解决

最直觉的写法是 `const result = await ipc.startSomething()`，等主进程把整件事做完再返回。
这条路走不通：

| 问题 | 后果 |
|---|---|
| 用户可能永远不完成登录 | Promise 永久挂起 |
| 用户可能中途关掉标签页 | 同上，且主进程要为「有人在等」保存 resolve 回调 |
| 主进程重启 | 等待状态丢失，UI 空等 |

所以形状必须是**发起与结果分离**：发起时只拿一个 `requestId`，结果经事件通道带着同一个
`requestId` 回来。主进程全程不保存「谁在等」。

## 整体形状

```
【发起页】用户操作
   │
   ├─① ipc.startXxx()  →  只回 { requestId }        主进程不开 tab、不存状态
   ├─② navigationIntent.set({ requestId, ... })     跨路由一次性信箱
   └─③ push('/')                                     跳到浏览器工作区
   
【浏览器工作区】XxxDialog 挂载
   ├─④ intent.consume()                             读取即清空
   ├─⑤ waiting.await(kind, requestId, cb)           先登记，不会错过结果
   └─⑥ browserOtaTabs.openExisting(credentialId, intent)
         └→ ipc otaTab.openExisting（intent 过 schema 校验）
              └→ OtaTabService → LoginDetector.register(tabId, channel, intent)
         ←─ 返回 tab，store 的 adopt() 做三步收尾
   
【主进程】与上面不是同一条调用栈
   LoginDetector：导航 → 判定 → triggerDiscovery 写库
      └→ TabEventBus 广播 tab:credential-checked { credential, intent, webContents }
           ├→ HotelProbeDispatcher      intent.kind === 'bind-hotel'   → probe → 候选
           └→ OtaReauthDispatcher       intent.kind === 'reauth-ota'   → 比对身份
                （各认各的 kind，互不感知）
                     │
                     └→ notify(envelope)  窄回调，channels/ 不认识 ipc/electron
                          └→ composition root → window.webContents.send
   
   ⑦ renderer 收到 → requestId 匹配 → 就地弹窗
        ├─ 用户否决 → 关弹窗（主进程什么都不用做）
        └─ 用户确认 → ipc.confirmXxx(...) → service 读 cookie → 远端
```

①②③ 是一条链，⑦ 是另一条，**中间隔着事件总线，不是函数返回**。

## 五个必须遵守的点

### 1. tab 由渲染进程开，主进程不代劳

开 tab 之后有三件事**只有渲染进程做得了**（依赖 DOM 几何）：进标签栏、设为活动标签并
切渠道、按视口尺寸 `syncBounds()`。主进程代劳会开出一个界面不认识的标签页——
`WebContentsView` 没尺寸等于没渲染，页面不渲染后续探测必然失败。

所以 `startXxx()` 退化为**纯发号器**。这条踩过坑，见
`openspec/changes/bind-hotel-flow/known-issues.md` 问题 1。

### 2. 先登记等待，再开标签页

```ts
cancelWaiting = waiting.await(kind, requestId, cb);   // 先
await browserOtaTabs.openExisting(credentialId, intent);  // 后
```

反过来写有窗口期：结果可能在登记完成前就到了。先登记不会错过任何结果。

### 3. 等待表放渲染进程，不放主进程

| | renderer 持有 | 主进程持有 |
|---|---|---|
| 生命周期 | 随组件，卸载即消亡 | 需显式清理 |
| 用户关窗/切页 | 自动没了 | 泄漏 |
| 主进程重启 | 无关 | 状态丢失，UI 空等 |

主进程唯一「记住」intent 的地方是 `LoginDetector.loginTabs`（按 tabId 的 Map），它已有
清理路径：`tab:closed` 时 `loginTabs.delete(tabId)`。intent 挂在同一条记录上，随 tab 关闭
一起消失，**不新增生命周期**。

### 4. 弹窗开合必须让位视口

`WebContentsView` 是原生视图，**永远盖在所有 HTML 之上**，z-index 管不到。弹窗打开时
`suspendViewport()`、关闭时 `resumeViewport()`，否则弹窗在界面上根本看不见。

ESC 和点遮罩要走 `onOpenChange`，否则会绕过恢复，视口再也回不来。

### 5. `channels/` 不认识 ipc 与 electron

dispatcher 住在 `channels/`，eslint 禁止它 import `services/`/`database/`/`gateway/`/
`ipc/`/`composition/`。要往外送结果就注入窄回调：

```ts
notify: (envelope: UiWaitingResultEnvelope) => void;
```

composition root 负责把它接到 `window.webContents.send`。同理，**读 cookie、调远端一律
不在 dispatcher 里做**——推迟到用户确认后的 `confirmXxx`，那是 service 层的事。

## 加一种新流程要改哪些文件

| 文件 | 改动 |
|---|---|
| `shared/types/ui-waiting-result-types.ts` | `UiWaitingResultPayloads` 加一个 kind → payload |
| `shared/browser.ts` | intent schema、payload schema（IPC 边界要校验） |
| `shared/ipc-channels.ts` | `startXxx` / `confirmXxx` 两个频道 |
| `main/ota-tab/intent.ts` | `OtaTabIntent` union 加一个成员 |
| `main/channels/xxx-dispatcher.ts` | **新增**订阅者，只认自己的 kind |
| `main/services/…-service.ts` | `startXxx`（只发号）+ `confirmXxx`（读 cookie → 远端） |
| `main/ipc/…-handlers.ts` | 两个 handler，只做校验 → 调一个 service → 错误转换 |
| `main/composition/window-scope.ts` | 装配 dispatcher，把 `notify` 接到 `webContents.send` |
| `preload/namespaces/…` | 两个 invoke，带 zod 校验 |
| `renderer/…/cross-route-intents.ts` | `createNavigationIntent` 建一条实例 |
| `renderer/components/browser/XxxDialog.svelte` | 自给自足：consume → 开 tab → 登记等待 → 弹窗 |

**不需要改**：`createWaitingUiResult`、`openExisting`、`LoginDetector`、`TabEventBus`、
`browser-ota-tabs.svelte.ts` 的 `adopt/suspendViewport`。这些是通用的。

`UiWaitingResultPayloads` 那张映射表是类型安全的关键——kind 与 payload 焊死，
`waiting.await('bind-hotel', id, p => p.hotels)` 里的 `p` 自动收窄，写错字段编译期报错。

## 两个已落地的实例

| | 绑定酒店 | 重新登录 |
|---|---|---|
| intent kind | `bind-hotel` | `reauth-ota` |
| 打开时带的额外信息 | — | `expectedChannelAccountId` |
| dispatcher | `HotelProbeDispatcher` | `OtaReauthDispatcher` |
| dispatcher 做什么 | 选 probe → `probe()` → 候选 | 比对 `credential.channelAccountId` |
| 要不要碰页面 | 要（抖音点菜单、拦 CDP） | **不要**（身份已由 `triggerDiscovery` 识别） |
| payload | `{ credentialId, hotels[] }` | `{ ok:true, credentialId }` / `{ ok:false, reason }` |
| 弹窗组件 | `BindHotelDialog` | `ReauthDialog` |
| 弹窗让用户做什么 | 单选门店 → 确认 | 看结果；不一致时回账号列表重选 |
| 发起页组件 | `AddOtaBindingDialog` | `ReauthOtaAccountDialog` |
| 跨路由意图 | `hotelBindingWaiting` | `otaReauthWaiting` |
| `confirmXxx` 写本地吗 | 写 `ota_hotel` | **不写**（门店关系没变） |
| 远端方法 | `bind()` | `reauthenticate()` |

**开 tab 的两种来源**：`openExisting(credentialId)` 是「用已有账号」；「新登录账号」
此刻还没有凭证，走 `openForNewLogin(channelId, url, intent)` 开空登录页，登录成功后
照样触发探测。两者带的是同一个 intent，跨路由意图里 `credentialId` 与
`newLoginChannel` 二选一。

两例的差异集中在 dispatcher 内部和 payload 形状，**外围机制完全一致**——这正是本范式
成立的依据。

## 容易忽略的坑

| 坑 | 现象 | 对策 |
|---|---|---|
| 默认激活覆盖 | 标签开了、渠道切了，内容区却是另一个渠道 | 兜底激活用 `activateIfIdle()` 给显式激活让位 |
| 探测触发条件 | 普通登录被顺带劫持成一次探测 | dispatcher **先判 intent 再做事**，无意图直接 return |
| 静默失败 | UI 一直等，用户分不清「还在等」和「已失败」 | dispatcher 的每条 return 路径都记日志；失败态最好也发 envelope |
| 通知丢弃无痕 | 日志显示 delivered，实际没送到 | `window.isDestroyed()` 分支要记 warn |
| 错误文案带壳 | 界面显示 `Error invoking remote method '…': …` | 用 `bindingFailureMessage` 剥壳后再展示 |

## 相关文档

- `openspec/changes/bind-hotel-flow/design.md` —— 第一例的完整决策（为什么发起与结果分离、
  状态归属、候选不落 staging）
- `openspec/changes/bind-hotel-flow/known-issues.md` —— 真机踩坑记录
- `openspec/changes/add-ota-reauth-and-channel-filter/design.md` —— 第二例
- `openspec/specs/desktop-main-layering/spec.md` —— 分层边界的事实来源
