# tasks — 重新登录 intent 与 RMS 老数据自愈

> 方案见 `design.md`，行为契约见 `specs/`。按顺序执行，每组结束可独立验证。

## 已核实的起点（2026-08-15）

| 事实 | 位置 |
|---|---|
| `channelAccountIdFromBindExtra` 读不到返回 null —— 分流点 | `main/channels/bind-extra.ts:88` |
| `confirmReauth` **已经**写 `withChannelAccount(null, credential)` | `main/services/hotel-management-service.ts:151` |
| ↳ 但基底写死 `null`，**带不上探测出的渠道字段** —— 本次要改的正是这里 | 同上 |
| 抖音 `merchantGroupId` 取自探测时页面 URL | `main/channels/douyin/hotel-prob.ts:127` |
| 美团 `otaPartnerId` 是**门店级**，在 `poiList` 循环里产出 | `main/channels/meituan/poi-infos.ts:50` |
| 携程门店信息随账号身份一起存，`probe()` 不碰页面 | `main/channels/ctrip/hotel-prob.ts` |
| 无 `channelAccountId` 的凭证会被劝退 —— 场景 2 要放宽 | `renderer/components/hotel/ReauthOtaAccountDialog.svelte:80` |

---

## 1. 契约层（shared）

- [x] 1.1 `shared/browser.ts` 新增 `reauthByHotelIntentSchema`
      （`kind` / `requestId` / `expectedOtaHotelId` / **`otaAccountId`**），
      并入 `otaTabIntentSchema` 的 discriminatedUnion
      - ⚠️ 字段名用 `otaAccountId`（number）而非 design 里写的 `rmsOtaAccountId`
        （string）：`confirmReauthInputSchema` 既有字段就叫这个且是 number，
        新契约向既有契约看齐，避免同一个 id 两个名字两种类型
- [x] 1.2 `ReauthOutcomeDto` 扩 `reason: 'hotel-mismatch'`，同步 envelope schema
      - 顺带扩了两个 design 未预见的字段（见下方「实现中的契约调整」）
- [x] 1.3 `confirmReauthInputSchema` 加可空 `bindExtra`
- [x] 1.4 定向测试：`ota-tab-intent-boundary.test.ts` +4 条（两个起点各一、
      缺锚点被拒、两种锚点混用被拒），13 tests 通过

## 2. 主进程 intent 与 dispatcher

- [x] 2.1 `main/ota-tab/intent.ts` 新增 `ReauthByHotelIntent`，并入 `OtaTabIntent`；
      注释写明它与 `ReauthOtaIntent` 的分界（锚点不同、是否探测不同）
- [x] 2.2 新建 `main/channels/reauth-by-hotel-dispatcher.ts`
      - 只认 `intent.kind === 'reauth-by-hotel'`
      - 复用 `probes.get(channel).probe()`，**不复用 `HotelProbeDispatcher`**
      - 比对 `expectedOtaHotelId` 是否在候选里
      - 命中 → `notify({ kind: 'reauth-ota', payload: { ok: true, credentialId } })`
        并把命中门店的 `bindExtra` 交给收尾
      - 未命中 → `payload: { ok: false, reason: 'hotel-mismatch' }`
      - 探测失败（`kind: 'none'`）与「未命中」**分开报**，日志可区分
      - 沿用现有守卫：`webContents.isDestroyed()` 时丢弃
- [x] 2.3 composition root 注册新 dispatcher（照 `OtaReauthDispatcher` 的注入套路）
- [x] 2.4 定向测试：命中 / 未命中 / 探测失败 / tab 已关四条分支

## 3. 收尾与补写

- [x] 3.1 `confirmReauth` 的 `withChannelAccount(null, credential)` 基底改为
      入参 `bindExtra`（缺省仍为 null，场景 1 行为不变）
- [x] 3.2 场景 2 命中后把探测出的 `hotel.bindExtra` 透传到 `confirmReauth`
- [x] 3.3 凭证无 `channelAccountId` 时不补写账号标识，但渠道字段照补
      （`withChannelAccount` 已有此行为，补测试锁住）
- [x] 3.4 定向测试：补写内容按渠道正确（抖音带 `merchantGroupId`、
      美团带 `otaPartnerId`、携程只有账号字段）

## 4. Renderer 流程分流

- [x] 4.1 `ReauthOtaAccountDialog` 按 `bindExtra.channelAccountId` 有无分两态
- [x] 4.2 场景 1：预选并**锁定**匹配到的凭证，文案「将恢复账号 X」
- [x] 4.3 场景 2：列出凭证；能推测则预选并标注依据，不能则不预选并提示需自选
- [x] 4.4 场景 2 放宽 `:80` 的 accountId 劝退拦截（场景 1 保留）
- [x] 4.5 场景 2 两个起点（选已有 / 新登录）都带 `reauth-by-hotel` intent
      —— 注意「新登录账号」当前走的是**绑定意图**（第 8 条路），
      场景 2 下必须改带新 intent，否则会误走绑定流程改掉门店
- [x] 4.6 `hotel-mismatch` 的提示带上「该账号管的是 X」（探测结果在手）；
      只提示，**不自动跳转到绑定或解绑**
- [x] 4.7 场景 2 的等待期文案落在**发起前**的弹窗说明里（「登录成功后会核对该账号
      是否管理 X」），未做独立的探测进度条 —— 探测期间原生 WebContentsView 盖在
      HTML 之上，此时弹进度条看不见（`suspendViewport` 要等结果到达才调用）。
      抖音 30s 的等待目前靠这句预告说明，真机验证时确认是否足够（见 6.4）

## 5. UI 分页

- [x] 5.1 `ReauthOtaAccountDialog` 账号列表分页（**每页 5 条**，不是暂定的 10：
      弹窗宽度有限且每条占两行，5 条正好一屏不出滚动条）
- [x] 5.2 `AddOtaBindingDialog` 账号列表同样分页
- [x] 5.3 抽出共用分页组件或 helper，两处不各写一份
- [x] 5.4 「上次绑定过」标注的凭证在分页后仍应可见（优先落到首页）

---

## 实现中的契约调整（design.md 未预见，已落地）

| # | 调整 | 为什么 |
|---|---|---|
| 1 | `ok: false` 加 `actualHotels?` | 4.6 要求提示「该账号管的是 X」，这份数据只有 dispatcher 手上有 |
| 2 | intent 字段名 `otaAccountId`（number），非 design 的 `rmsOtaAccountId`（string） | 向既有 `confirmReauthInputSchema` 看齐，避免同一个 id 两个名字两种类型 |
| 3 | 新增 `shared/bind-extra-fields.ts` | 分流判据 `channelAccountIdFromBindExtra` 两端都要用，但原实现在 `main/channels/`，renderer 不得 import。移到 `shared/`，主进程侧改为转出，保持既有 import 路径不变 |
| 4 | 场景 2 复用 `ReauthDialog` 而非新建弹窗 | 两条路产出相同（只换凭证），共用 waiting kind `'reauth-ota'`；差别只在文案 |
| 5 | 场景 1 不渲染单选列表，改为「将恢复账号 X」的只读卡片 | 该恢复哪个已经确定，列出其余账号只会诱导用户选一个必然核对失败的 |
| 6 | 新增场景 1 的第三态：远端有标识但本机无对应凭证 | 换设备/凭证已清理时既不能锁定也不该让用户乱选，只留「新登录账号」出口 |

### 🔴 中途推翻的两处（用户指出，已改正）

| # | 一度做成 | 为什么错 | 最终 |
|---|---|---|---|
| A | 场景 2 把探测命中门店的 `bindExtra` 透传回来补写远端 | **门店级字段每店不同**（同账号 cookie 共用但 `merchantGroupId`/`otaPartnerId` 不共用）。场景 2 没让用户确认门店，探测值取自当时页面上下文，写进去会让 RPA 拿错参数跑 | 只补账号级（`channelAccountId`/`channelAccountName`）。`ReauthOutcomeDto.bindExtra`、`confirmReauthInputSchema.bindExtra` 整条透传链路全部撤除 |
| B | 分流条件只看「有无 `channelAccountId`」 | 漏了「两个锚点都没有」的第三种：`otaHotelId` 也为空时被拉进场景 2，撞上「请改用新登录账号」的提示 —— 而用户点的就是新登录账号，**死循环** | 条件改为「无 accountId **且有门店**」；无门店的单独判为「未绑定成功」，走补写门店流程 |
| C | 场景 2 选已有账号时用 `openExisting`（复用 partition） | 抖音复用 partition 会**跳过选公司页直落上次那家**（记忆在服务端，清本地无效）。探测因此只看到 1 家，账号明明管着目标门店也被判 `hotel-mismatch`。真机复现：广昊假日酒店 `discoveredCount: 1` | 抖音改走 `openExistingForBinding`（新建 partition 逼它重新问），携程/美团维持复用 —— 它们没有选公司页，换 partition 只白留目录 |

**C 的归因**（值得记住的教训）：`openExistingForBinding` 与那段 CDP 排查注释一直
都在，代码没被改坏。错在**按名字归类**——「场景 2 叫重新登录 → 重登要复用 partition」
这条推理抄自第 7 条路，但两者的前提相反：

```
第 7 条路  知道该登哪个账号 → 落到「上次那家」正是要的
场景 2     不知道该登哪个   → 落到「上次那家」恰恰不行，要看这账号管哪些店
```

新增流程时应回到 `ota-tab-entry-and-partition-lifecycle/design.md §3.2` 那张 8 条路
入口表逐条比对「该用哪个开口」，而不是照着名字相近的那条抄。

### 契约固化：按字段来源分级（应用户要求）

服务端 `bindExtra` 是宽接口（四个字段都可选），desktop 侧**不照抄这份宽松**，
按「谁决定这个字段」建模，让传错在编译期就报错：

```
RmsChannelAccountFields   账号级 —— 登录哪个账号决定，同凭证下各门店相同
RmsChannelHotelFields     门店级 —— 绑哪家门店决定，同账号下每店可能不同

bind()            两类都要       用户当场选定门店
reauthenticate()  只要账号级     不确认门店 → 门店级不可信
backfillHotel()   两类都要       + otaHotelId/otaHotelName 必填（成对）
```

**这个约束当场抓到一个真实缺陷**：`rms-ota-account-gateway-http.test.ts` 原有一条
测试断言 reauth 会发送 `merchantGroupId` —— 正是要避免的写法，此前一直被当成正确
行为锁在测试里。

---

## 6. 验证

- [x] 6.1 全量单测（中任务，跑一次）—— **594 tests / 83 files 全通过**；
      `npm run check`（tsc + svelte-check 997 files）与 `npm run lint` 均 0 错误；
      改动文件 prettier 全通过（仓库另有 21 个**既有**未格式化文件，与本次无关）
- [x] 6.2 真机：场景 1 抖音 ×2（2026-08-15 19:33 / 19:34，本地 rms-server）——
      `anchor: 'channel-account'` → `Reauth identity confirmed` → 用户确认成功，
      与改动前一致。**携程 / 美团未测**
- [x] 6.2b 真机：**补写门店流程走通**（用户实测确认）——「未绑定成功」→
      重新选择门店 → 探测 → 选定 → `PUT` 补写成功
- [x] 6.4 真机：**场景 2 抖音走通**（2026-08-15，广昊假日酒店，本地 rms-server）——
      首次失败暴露了上表 C：复用 partition 直落上次那家门店，`discoveredCount: 1`
      核对不过；改走 `openExistingForBinding` 后停在选公司页，选定目标门店即通过
- [x] 6.6 真机：`hotel-mismatch` 拦截生效（即 6.4 首次失败那两次）——
      明确提示且**未写入任何数据**，符合「只提示不自动跳转」的设计
- [ ] 6.3 真机：场景 2 携程 —— 核对通过 → 检查远端只补 `channelAccountId`
      （**不应**出现 `merchantGroupId` / `otaPartnerId`）
- [ ] 6.5 真机：场景 2 美团
- [x] 6.7 **远端 `bindExtra` 落库核查通过**（2026-08-15，广昊假日酒店·美团，reauth）：
      远端结果 `{bindSource, otaPartnerId:"4947602", channelAccountId:"292462264",
      channelAccountName:"guanghaojiariAI"}`。desktop 只送了账号级两个键，
      **门店级 `otaPartnerId` 是库里原值且完好保留** —— 一次同时验证「只补账号级」
      与「服务端按键合并」两条断言。详见 design §7.1
- [ ] 6.7 🔴 联调确认服务端接受 desktop 补写 `bindExtra` 键（用户已确认支持，需实测）；
      若被拒，按 `design.md` §5 降级为只更新本地
- [ ] 6.8 记录验证证据到 `verification.md`

## 7. 规范同步

- [ ] 7.1 本次改动跨模块接口（新 IPC intent kind），触发完成门禁 ——
      验收后把 `specs/` 两份 delta 合并进 `openspec/specs/`
- [ ] 7.2 `ota-tab-entry-and-partition-lifecycle/design.md` §3.4 与 §9 最后一条
      标注「已由本 change 承接」，避免两处并列的未决问题
