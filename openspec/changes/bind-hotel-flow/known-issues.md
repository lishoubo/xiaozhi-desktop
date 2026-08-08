# 已知问题

状态：问题 1、2 已修并**真机验证通过**（候选弹窗正常出现）。问题 3 已解决一半：
`confirmBinding` 的失败原因现在会透传给用户，探测端的静默失败仍未处理。

真机验证遗留：绑定成功后 `ota_hotel` 落库**仍未确认**——2026-08-08 20:23 那次运行
连续三次绑定（douyin / meituan / ctrip）全部撞上问题 4 的 seed 冲突。见文末「真机
日志（2026-08-08）」。**下次必须选 1003 苏州平江府**，它是唯一三个渠道都没被 seed
占用的酒店。

---

## 问题 1（已修）：绑定开出的标签页，renderer 不知道它的存在

**症状**：从酒店管理页发起绑定、选中抖音账号后，标签页在主进程里确实开了，但界面
仍停留在携程渠道、显示携程的内容。

**根因**：`startBinding` 在主进程内部开 tab，返回值只有 `requestId`，tab 被丢弃；
而开 tab 有三步收尾只有渲染进程做得了（进 `tabsByChannel`、设为活动标签并切渠道、
`syncBounds`）。这是设计缺陷不只是实现疏漏——`design.md` 决策 1 的方案对比表只比较
了「startBinding 要不要等探测结果」，**没有比较「tab 由谁开」**。

**修复**：让绑定走与其他入口相同的路径。

| 改动 | 位置 |
|---|---|
| 新增渲染进程侧 OTA tab 状态层，收敛三步收尾 | `renderer/components/browser/browser-ota-tabs.svelte.ts` |
| `BrowserWorkspace` 只渲染 + 注册视口，不再持有 tab 状态 | `BrowserWorkspace.svelte` |
| `BindHotelDialog` 自给自足：consume 意图 → 开 tab → 登记等待 | `BindHotelDialog.svelte` |
| `startBinding` 退化为纯发号器，`tabOpener` 依赖删除 | `hotel-management-service.ts` + composition |
| intent 穿过 IPC，边界过 `otaTabIntentSchema` 校验 | `ota-tab-handlers.ts` + preload |
| 跨路由意图带上 `credentialId` | `hotel-management/cross-route-intents.ts` |

`design.md` 决策 1 已补「tab 由谁开」对比表，并新增决策 9 记录渲染进程侧状态层。

真机复验时又暴露出三个后续断点，都已修复：

| 断点 | 现象 | 根因 | 修复 |
|---|---|---|---|
| 默认激活覆盖 | 标签开了、渠道切了，但内容区是携程 | `browser.list()` 的「默认激活携程」与绑定开 tab 是两条并行异步链，前者后完成把后者顶掉 | store 记 `#explicitlyActivated`，兜底激活改用 `activateIfIdle()` 让位 |
| `bound` 早退吞凭证 | 绑定 tab 开了但连 `Discovery triggered` 都不打 | `OtaCredentialService.trigger` 对已探测过的 partition 返回 `null`，下游据此认定「没登录成功」跳过探测。而绑定选的就是已登录账号，`bound` 里几乎总有它 | 早退时改为 `findByPartitionName()` 返回已有凭证；`inflight` 分支保持返回 null |
| 弹窗被原生视图遮住 | 候选已送达、回调已触发，但界面上看不到弹窗 | `WebContentsView` 是原生视图，永远盖在所有 HTML 之上，z-index 管不到 | 弹窗开合时 `suspendViewport()` / `resumeViewport()`；尺寸对齐 `AccountSwitcherDialog` |

**验证**：check 835 files 0 errors、lint 0 problems、单元 246 tests 全过。真机确认
候选弹窗正常出现（日志 `Binding candidates claimed` 与 `delivered` 的 requestId 一致）。

---

## 问题 2（已修）：抖音探测在上一次真机中失败

```
17:22:56.722  Douyin hotel probe: aside menu never became ready
17:23:22.500  Douyin hotel probe: no dsl/get response captured
```

**确认与问题 1 同源**：tab 没有被 `syncBounds` 正确布局，WebContentsView 没有尺寸
等于没渲染，侧边菜单自然 never ready。问题 1 修复后抖音探测稳定成功：

```
19:11:56.142  Hotel probe found candidates { channel: 'douyin', hotelCount: 1,
                                             intentKind: 'bind-hotel' }
```

抖音适配器本身无需改动。

---

## 问题 3（部分处理）：失败时用户无反馈

**已解决——`confirmBinding` 的失败**：远端的业务拒绝（如「该酒店的此渠道已存在活跃
绑定」）此前被统一显示为「绑定失败，请重试」，用户重试多少次都不会成功。现在透传
真实文案，并剥掉 Electron 的 `Error invoking remote method '<channel>': ` 包装
（`binding-failure-message.ts`，3 个单测覆盖）。

**未解决——探测端的静默失败**：`HotelProbeDispatcher` 有**三条**静默 return 路径：
`outcome.kind === 'none'`、没有对应 probe、`isProbeableUrl` 为 false、`probe()` 抛
异常。任一条命中 UI 都收不到通知，用户无法区分「还在等」和「已经失败」。

已确认**本次不做**（不加常驻等待提示、不加超时）。要补的话应在 dispatcher 层统一
收敛为一种失败通知，而不是只补 `none` 一种。

> 后续更新：原本的第四条「无绑定意图」已随 design 决策 3b 消失——没有意图现在
> 根本不进探测，不存在「探完了没人接」的状态。剩下三条仍在。

---

## 问题 4（非缺陷）：绑定报错「该酒店的此渠道已存在活跃绑定」

真机测试时对 `hotelId: 1001` + 抖音发起绑定会失败。这**不是后端缺失**——
`MockRmsOtaAccountGateway.bind()` 已实现，这是它的业务规则：seed 数据里该酒店的
抖音绑定已存在（上海云栖酒店，`LOGIN_EXPIRED`）。换一家酒店即可绑定成功。

此前 UI 把它显示成「请重试」掩盖了真实原因，现已透传（见问题 3）。

---

## 已验证可用的部分

链路上半段在携程上一直是通的：

```
17:22:35.458  Discovery triggered { channel: 'ctrip' }
17:22:36.672  Ctrip discovery outcome { kind: 'found' }
17:22:36.676  Ctrip discovery saved credential { channel: 'ctrip' }
17:22:36.676  Hotel probe found candidates { channel: 'ctrip', hotelCount: 1 }
```

顺带澄清一个前两个 change 遗留的疑点：`XXX discovery saved credential` 此前一直
没出现，**并非缺陷**——那两次运行 credential 已存在、`bound` 集合直接早退。换了新
partition（`ctrip:6e774f52`）后该日志正常打出。

`ota_hotel` 落库尚未亲眼确认（见顶部状态）。

---

## 真机日志（2026-08-08 20:23，含「无意图不探测」的验证）

日志 `~/Library/Logs/小智酒店管家/main.log`，数据库
`~/Library/Application Support/小智酒店管家/hotel-butler.sqlite`。

**已验证：普通登录不再触发探测**（design 决策 3b 的效果）。三个渠道走完整登录，
credential 全部落库，全程**没有任何 `Hotel probe` 日志**：

```
20:23:38.246  Discovery triggered { channel: 'ctrip' }
20:23:38.805  Ctrip discovery saved credential
20:23:54.178  Discovery triggered { channel: 'douyin' }
20:23:55.486  Douyin discovery saved credential
20:24:08.364  Discovery triggered { channel: 'meituan' }
20:24:13.011  Meituan discovery saved credential
```

**已验证：只有带意图才探测**，且 requestId 全程对得上：

```
20:24:13.304  Binding waiting registered { requestId: a5c8de6f… }
20:24:17.889  Hotel probe found candidates { channel: 'douyin', hotelCount: 1,
                                             intentKind: 'bind-hotel' }
20:24:17.890  Binding candidates claimed { requestId: a5c8de6f… }
```

**未验证：`ota_hotel` 落库。** 三次绑定全部失败，`ota_hotel` 仍为 0 行：

```
20:24:19.961  [warn] Hotel binding failed { errorName: 'Error' }   douyin
20:25:18.547  [warn] Hotel binding failed { errorName: 'Error' }   meituan
20:29:17.097  [warn] Hotel binding failed { errorName: 'Error' }   ctrip
```

`errorName: 'Error'` 是普通 `Error`，对应 mock 的 `throw new Error('该酒店的此渠道
已存在活跃绑定')`；若是 `toOtaHotelId` 抛的会显示 `InvalidIdentifierError`。
⚠ 日志只记 `errorName` 不记 message，「是哪条业务拒绝」是从 seed 数据反推的，
不是日志直接写的——排查同类问题时注意这个盲点。

seed 把三个渠道占了两家酒店，正好覆盖这次试的全部组合：

| hotelId | 酒店 | 已被 seed 占用的渠道 |
|---|---|---|
| 1001 | 上海云栖酒店 | ctrip、douyin |
| 1002 | 杭州西溪悦榕酒店 | meituan |
| **1003** | **苏州平江府** | **无——下次用这家** |

⚠ 补充：`bind()` 的拒绝只看 `hotelId + source`、**不看 status**——LOGIN_EXPIRED 的记录
照样挡住新绑定，所以「换个渠道试试」没用，必须换酒店。

⚠ 另一个坑：RMS mock 是**内存态**，应用一重启就回到 seed，而本地 sqlite 的 `ota_hotel`
不会重置。重启后看到「本地有酒店记录、远端却没有对应绑定」是 mock 的产物，不是缺陷。
mock 全貌见 `openspec/changes/add-ota-reauth-and-channel-filter/tasks.md` 第 10 节的说明。
