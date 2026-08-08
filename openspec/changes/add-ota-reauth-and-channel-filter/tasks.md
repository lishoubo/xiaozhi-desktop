## 1. 状态判断集中（前置：另外两节都依赖它）

- [ ] 1.1 新增 `renderer/hotel-management/account-status.ts`：`needsReauth(status)` 与 `isActiveBinding(status)`，注释标明「待与 RMS 服务端对齐」（design 决策 6）
- [ ] 1.2 把 `HotelManagementPage.svelte:26` 现有的 `['LOGIN_FAILED', 'LOGIN_EXPIRED', ...]` 字面量数组收进该文件，页面改调函数
- [ ] 1.3 单测：两个函数对已知状态的判定；未知状态的兜底行为

## 2. 需求 1：绑定入口按渠道过滤

- [ ] 2.1 `renderer/hotel-management/model.ts` 新增纯函数 `boundChannelsOfHotel(accounts)` → `ReadonlySet<string>`，用 `isActiveBinding` 判定
- [ ] 2.2 `AddOtaBindingDialog.svelte` 接收该酒店的远端账号列表，过滤掉已绑定渠道的**全部**账号（design 决策 5）
- [ ] 2.3 `HotelManagementPage.svelte` 把 `accountsByHotelId` 里对应酒店的账号传给弹窗
- [ ] 2.4 列表为空时区分两种文案：「该酒店所有渠道都已绑定」vs「暂无已登录账号」——后者才给「新登录账号」入口
- [ ] 2.5 单测：`boundChannelsOfHotel` 的分组与过滤（含全绑定、无绑定、部分绑定三种）

## 3. `channelAccountId` 写入侧

- [ ] 3.1 `shared/browser.ts`（或就近）新增 `withChannelAccountId(bindExtra, channelAccountId)`：非空才合入，空则原样返回（design 决策 4）
- [ ] 3.2 `hotel-management-service.ts` 的 `confirmBinding` 用它包一层 `bindExtra` 再交给 `gateway.bind`
- [ ] 3.3 单测：有 `channelAccountId` 时字段存在且与探测字段并存；为空时字段不出现（不得写 null 占位）

## 4. 共享契约（intent / payload / 频道）

- [ ] 4.1 `main/ota-tab/intent.ts`：`OtaTabIntent` 加 `ReauthOtaIntent`（`kind: 'reauth-ota'` + `requestId` + `expectedChannelAccountId`）
- [ ] 4.2 `shared/browser.ts`：对应的 zod schema，并入 `otaTabIntentSchema` union（IPC 边界要校验，intent 来自渲染进程是不可信输入）
- [ ] 4.3 `shared/types/ui-waiting-result-types.ts`：`UiWaitingResultPayloads` 加 `'reauth-ota'` → `{ ok: true; credentialId } | { ok: false; reason }`
- [ ] 4.4 `shared/ipc-channels.ts`：`hotelManagement.startReauth` / `confirmReauth`
- [ ] 4.5 `shared/browser.ts`：`confirmReauthInputSchema`（`otaAccountId` + `credentialId`）

## 5. 远端 gateway

- [ ] 5.1 `main/gateway/rms/types.ts`：`RmsOtaAccountReauthInput` + `RmsOtaAccountGateway.reauthenticate`（design 决策 2，门店字段**不进参数**）
- [ ] 5.2 `rms-ota-account-gateway-mock.ts` 实现：按 `otaAccountId` 找记录 → 状态改回 `BOUND` → 合入 `channelAccountId`；找不到则明确失败
- [ ] 5.3 单测：刷新后状态恢复且 `otaHotelId`/`hotelId` 不变；`otaAccountId` 不存在时报错

## 6. 身份核对与结果下行

- [ ] 6.1 新增 `main/channels/ota-reauth-dispatcher.ts`：订阅 `tab:credential-checked`，只认 `kind === 'reauth-ota'`（design 决策 1、1b）
- [ ] 6.2 同文件：比对 `credential.channelAccountId` 与 `intent.expectedChannelAccountId`，一致发 `ok:true`，不一致发 `ok:false`
- [ ] 6.3 同文件：`credential` 为 null 或 `channelAccountId` 为空时按**不一致**处理（Risks：宁可拒绝也不赌）
- [ ] 6.4 同文件：`webContents.isDestroyed()` 时丢弃并记日志（照 `HotelProbeDispatcher` 的形状）
- [ ] 6.5 `main/composition/window-scope.ts` 装配，`notify` 接到 `webContents.send`，窗口已销毁时记 warn
- [ ] 6.6 单测：一致/不一致/credential 为 null/`channelAccountId` 为空/tab 已关闭 五条路径

## 7. 服务与 IPC

- [ ] 7.1 `hotel-management-service.ts`：`startReauth()` 只发号
- [ ] 7.2 同文件：`confirmReauth(input)` → 查 credential → `readCookieSnapshot` → `gateway.reauthenticate`；**不写本地 `ota_hotel`**（design 决策 2b）
- [ ] 7.3 `main/ipc/hotel-management-handlers.ts`：`HotelManagementOrchestrator` 加两个方法，注册两个 handler，复用 `logFailure`
- [ ] 7.4 `preload/namespaces/hotel-management.ts`：两个 invoke，带 zod 校验
- [ ] 7.5 单测：`confirmReauth` 凭证不存在时不调远端；成功路径传给 gateway 的参数正确（含 `channelAccountId`）

## 8. 渲染进程：重新登录流程

- [ ] 8.1 `renderer/hotel-management/model.ts` 新增匹配纯函数：输入「远端账号 + 该渠道凭证列表 + 本地酒店记录」→ 输出该标注的 `credentialId`（design 决策 3，先 `bindExtra.channelAccountId`，再绕 `ota_hotel`）
- [ ] 8.2 单测：新数据命中、老数据命中、两者都不命中（不得抛错、不得过滤掉任何账号）
- [ ] 8.3 新增「重新登录」弹窗（酒店管理页侧）：列出该渠道账号 + 「上次绑定过」标注 + 「新登录账号」入口
- [ ] 8.4 `cross-route-intents.ts` 新增 `otaReauthWaiting` 意图（`createNavigationIntent` 第二条实例）
- [ ] 8.5 `BoundOtaAccountCard` 的 `action === 'login'` 改为打开该弹窗，替换 `showAccountAction` 里的「暂未实现」提示
- [ ] 8.6 新增 `renderer/components/browser/ReauthDialog.svelte`：consume 意图 → 登记等待 → `openExisting(credentialId, intent)` → 收结果
- [ ] 8.7 结果为 `ok:true` → 调 `confirmReauth` → 提示「已重新登录成功」；`ok:false` → 提示登录的不是所选账号，**弹窗保持打开**让用户回列表重选（design 决策 1b）
- [ ] 8.8 弹窗开合调 `suspendViewport`/`resumeViewport`；ESC/点遮罩走 `onOpenChange`
- [ ] 8.9 失败文案用 `bindingFailureMessage` 剥壳

## 9. 「新登录账号」快捷入口

- [ ] 9.1 `OtaTabService.open()` 支持 `intent` 参数（目前只有 `openExisting` 支持），透传给 `loginDetector.register`
- [ ] 9.2 `browser-ota-tabs.svelte.ts` 的 `openForNewLogin` 加 `intent` 参数；preload/handler 同步放行（过 schema 校验）
- [ ] 9.3 两个弹窗的「新登录账号」入口都走 A 路：带 `bind-hotel` intent 开新登录 tab（design 决策 7）
- [ ] 9.4 单测：`open()` 带 intent 时 `register` 收到；缺省时不影响既有行为

## 10. 验证

- [ ] 10.1 `npm run check --workspace @hotel-butler/desktop` 通过
- [ ] 10.2 `npm run lint --workspace @hotel-butler/desktop` 通过（确认 `channels/` 新增 dispatcher 未引入违规依赖）
- [ ] 10.3 迭代期定向测试：改到哪个文件跑哪个
- [ ] 10.4 完成态跑一次 `npm run test:unit:desktop` 全量
- [ ] 10.5 **真机**：已绑定渠道的账号不出现在新增绑定弹窗
- [ ] 10.6 **真机**：对失效账号点重新登录 → 选原账号 → 登录 → 提示成功 → 远端状态恢复、门店关系不变
- [ ] 10.7 **真机**：故意登另一个账号 → 提示「不是所选账号」→ 远端未被更新 → 可回列表重选
- [ ] 10.8 **真机**：`confirmBinding` 后远端记录的 `bindExtra` 含 `channelAccountId`
- [ ] 10.9 验证证据写入 `openspec/changes/add-ota-reauth-and-channel-filter/verification.md`

## 11. 文档

- [ ] 11.1 `docs/arch/2026-08-08-ota-tab-async-result-pattern.md` 已建（本次范式文档）；实现完成后回填「两个已落地的实例」表里与代码不符的地方
- [ ] 11.2 触发完成门禁的部分（`bindExtra` 契约变化）合并进 `openspec/specs/local-ota-credentials/spec.md`
