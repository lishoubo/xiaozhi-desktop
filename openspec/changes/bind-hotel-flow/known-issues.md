# 已知问题（未修复）

状态：Change 3 代码已提交但**绑定流程未跑通**，真机验证卡在下面第 1 条。
提交这一版是为了留存进度，不代表功能可用。

---

## 问题 1（阻塞）：绑定开出的标签页，renderer 不知道它的存在

**症状**：从酒店管理页发起绑定、选中抖音账号后，标签页在主进程里确实开了，但界面
仍停留在携程渠道、显示携程的内容。用户以为"打开抖音账号结果展示携程酒店"。

**根因**：`startBinding` 在**主进程内部**开 tab，返回值只有 `requestId`，tab 被丢弃：

```ts
// HotelManagementService.startBinding —— 当前实现
startBinding(input) {
  const requestId = this.deps.generateRequestId();
  this.deps.tabOpener.openExisting(input.credentialId, { kind: 'bind-hotel', requestId });
  return { requestId };            // ← tab 丢在这里
}
```

而 renderer 里所有既有的开 tab 路径都依赖返回的 tab 做三件事
（`BrowserWorkspace.openExistingCredentialTab`）：

```ts
const tab = await window.hotelButler.otaTab.openExisting(credential.id);
updateTab(tab);                              // 加进 tabsByChannel
activeTabIds[credential.channel] = tab.id;   // 设为该渠道的活动 tab
await syncBounds();                          // 同步 WebContentsView 位置
```

绑定这条路径跳过了这三步，所以 renderer 的 `tabsByChannel` 里没有这个 tab，
`activeChannelId` 也没切换。

**这是设计缺陷，不只是实现疏漏**：`design.md` 决策 1 的链路图就是这么画的
（`startBinding → OtaTabService.openExisting`，返回 `{ requestId }`）。写 design 时
没有读 `openExistingCredentialTab`，不知道 renderer 对 tab 返回值有实质依赖；
决策 1 的方案对比表只比较了「startBinding 要不要等探测结果」，**没有比较
「tab 由谁开」**——这个选择从未进入设计视野。

**修复方向**（未实施，待重新梳理后确认）：让绑定走与其他入口相同的路径——
renderer 调 `otaTab.openExisting(credentialId, intent)` 拿到 tab 并复用
`openExistingCredentialTab` 的三步；`startBinding` 退化为纯发号器。
需要 `ota-tab-handlers.ts` 与 preload 的 `openExisting` 支持透传 intent。

**同时要改**：`design.md` 决策 1 的链路图、`tasks.md` 4.2。

---

## 问题 2（独立）：抖音探测在本次真机中失败

```
17:22:52.498  Douyin discovery saved credential { channel: 'douyin' }
17:22:56.722  Douyin hotel probe: aside menu never became ready
17:23:22.500  Douyin hotel probe: no dsl/get response captured
```

抖音 `probe()` 返回 `none`，dispatcher 按设计直接 return，不通知、不弹窗。

**怀疑与问题 1 同源**：tab 没有被 `syncBounds` 正确布局，页面可能根本没渲染，
侧边菜单自然 never ready。修完问题 1 后需重新验证；若仍失败再单独排查抖音
适配器。

---

## 问题 3（设计缺口）：探测失败时用户无任何反馈

`HotelProbeDispatcher` 遇到 `outcome.kind === 'none'` 直接 return，不通知 UI。
从用户视角是「点了绑定 → 跳过去 → 登录完 → 没有下文」，无法区分"还在等"和
"已经失败"。

这是 `design.md` 有意定的行为（"没候选就不通知"），但真机一跑就暴露了体验问题。
待定：是否给 payload 加空列表 + UI 提示，还是另设一种失败 kind。

---

## 已验证可用的部分

链路的上半段在真机上是通的（携程）：

```
17:22:35.458  Discovery triggered { channel: 'ctrip' }
17:22:36.672  Ctrip discovery outcome { kind: 'found' }
17:22:36.676  Ctrip discovery saved credential { channel: 'ctrip' }
17:22:36.676  Hotel probe found candidates { channel: 'ctrip', hotelCount: 1 }
```

顺带澄清一个前两个 change 遗留的疑点：`XXX discovery saved credential` 此前一直
没出现，**并非缺陷**——那两次运行 credential 已存在、`bound` 集合直接早退。本次
换了新 partition（`ctrip:6e774f52`）后该日志正常打出。

静态与单元层面全绿：check 833 files 0 errors、lint 通过、单元测试 51 files 239 tests。
`ota_hotel` 仍为 0 行（未走到确认绑定这一步，符合当前进度）。
