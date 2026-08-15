# design — 重新登录 intent 与 RMS 老数据自愈

> 动机见 `proposal.md`，行为契约见 `specs/`。本文只回答「怎么做」。

## 1. Context

### 1.1 两种绑定来源，`bindExtra` 形状不同

```
桌面端绑定  → confirmBinding 时 withChannelAccount() 写入
              { channelAccountId, channelAccountName, ...渠道字段 }   ✅ 能认账号

RMS 后台绑定 → 输入用户名密码，服务端起浏览器登录拿 cookie
              { }  或只有业务字段                                     ❌ 认不出账号
```

`channelAccountIdFromBindExtra`（`bind-extra.ts:88`）读不到就返回 null —— 这就是分流点。

### 1.2 现有两条路都套不上「门店已知、账号未知」

| | 现有重登（第 7 条路） | 现有绑定（第 6/8 条路） | **需要的** |
|---|---|---|---|
| 锚点 | `expectedChannelAccountId` | 无 | **`otaHotelId`** |
| 探测门店 | ❌ | ✅ | ✅ |
| 用户挑门店 | ❌ | ✅ | ❌ **门店已知** |
| 收尾 | `confirmReauth` | `confirmBinding` | **`confirmReauth`** |

**前半段像绑定、后半段像重登** —— 这是它必须单独成型的原因。

### 1.3 关键约束：渠道上下文只能从探测里来（已核实）

| 渠道 | `bindExtra` 字段 | 产出位置 | 能跳过探测吗 |
|---|---|---|---|
| 携程 | 无（`null`） | — | 门店信息在 `credentialExtra`，但仍需统一流程 |
| 抖音 | `merchantGroupId` | `douyin/hotel-prob.ts:127`，取自探测时页面 URL 的 `groupid` | ❌ |
| 美团 | `otaPartnerId` / `otaPartnerName` | `meituan/poi-infos.ts:50`，**逐个 poi 从响应里取** | ❌ |

美团的 `partnerId` 是**门店级**而非账号级的（在 `poiList` 循环里产出），所以即便知道
账号也必须拿到门店列表。**三渠道统一探测**，不做渠道分支。

## 2. Goals / Non-Goals

| | |
|---|---|
| ✅ Goal | 门店已知时反过来认账号，救回 RMS 老数据的登录态 |
| ✅ Goal | 核对通过顺手补齐 `bindExtra`，老数据一次走完即升级为新数据 |
| ✅ Goal | 探测复用底层 `HotelProbe`，不复用 `HotelProbeDispatcher` |
| ❌ Non-Goal | 不改第 8 条路（重登·换账号）的定性 —— 它产出新绑定，仍是绑定 |
| ❌ Non-Goal | 不做失败后的自动补救（不自动改门店、不自动解绑） |
| ❌ Non-Goal | 不做账号列表搜索（本轮只做分页） |
| ❌ Non-Goal | 不碰 partition 生命周期（另一个 change 的范围） |

## 3. Decisions

### 3.1 独立 `kind` 而非给 `ReauthOtaIntent` 加字段

```ts
// intent.ts —— 实现定稿
export type ReauthByHotelIntent = Readonly<{
  kind: 'reauth-by-hotel';
  requestId: string;
  /** 这条绑定的门店 —— 探测完拿它比对，不给用户挑。 */
  expectedOtaHotelId: string;
  /** 补写 bindExtra 的目标记录。名字与类型向既有 `confirmReauthInputSchema` 看齐。 */
  otaAccountId: number;
}>;

export type OtaTabIntent = BindHotelIntent | ReauthOtaIntent | ReauthByHotelIntent;
```

| 方案 | 判断 |
|---|---|
| A 给 `ReauthOtaIntent` 加可选 `expectedOtaHotelId` | ❌ 两个锚点字段的合法组合表达不出；且**探测行为不同**，订阅方要在一个 kind 内分叉 |
| **B 独立 kind** | ✅ 探测与否由 kind 决定，订阅方各管各的 |

判据是**订阅方是否相同**：`reauth-ota` 不探测，`reauth-by-hotel` 必探测，是两个
dispatcher，那就该是两个 kind。（此判据与第 8 条路相反 —— 那里订阅方与产出都和绑定
相同，故不新增 kind。）

### 3.2 新 dispatcher，复用底层 probe

```
                         tab:credential-checked
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
HotelProbeDispatcher      OtaReauthDispatcher      ReauthByHotelDispatcher 🆕
kind==='bind-hotel'       kind==='reauth-ota'      kind==='reauth-by-hotel'
        │                         │                         │
   probe() ──┐                比对 accountId          probe() ──┤ 同一个 HotelProbe
        │    │                     │                     │      │
  候选发给 UI │                 成/败                自己比对 hotelId
  用户挑一家  │                                      + 补写 bindExtra
             └────────── 复用 probes.get(channel) ──────────┘
```

复用的是 `HotelProbe`（`probe()` 本身），**不是** dispatcher —— 两者探测后的去向
完全不同（发给 UI 挑 vs 自行比对），塞进一个 dispatcher 会让判断散开。

### 3.3 校验结果沿用 `ReauthOutcomeDto`，扩一个 reason

```ts
export type ReauthOutcomeDto =
  | Readonly<{ ok: true; credentialId: string }>
  | Readonly<{
      ok: false;
      reason: 'account-mismatch' | 'identity-unavailable' | 'hotel-mismatch';  // 🆕
    }>;
```

两条路径产出相同（只换凭证），所以共用 waiting kind `'reauth-ota'`，不新增 waiting
契约。`hotel-mismatch` 让 UI 能说清「该账号管不了这家门店」。

> ⚠️ waiting kind 与 intent kind **不必一一对应**：intent 说「为什么打开」，waiting
> 说「在等什么结果」。这里是「两种打开方式、同一种结果」。

### 3.4 补写 bindExtra：复用 `withChannelAccount`

⚠️ **实现修正**：合并不在 dispatcher 里做。`channels/` 不认识 gateway（eslint 禁止），
所以探测出的 `bindExtra` 随结果 payload 回到 UI，用户确认后交给 `confirmReauth`
（service 层）合并并提交 —— 与 `OtaReauthDispatcher` 把读 cookie 推迟到 confirm 同理。

```
dispatcher  探测命中 → payload { ok: true, credentialId, bindExtra }
                                                    │
UI          用户确认 → confirmReauth({ otaAccountId, credentialId, bindExtra })
                                                    │
service     withChannelAccount(input.bindExtra ?? null, credential) → gateway
```

```ts
// hotel-management-service.ts —— 基底由入参决定，缺省 null（常规重登行为不变）
bindExtra: withChannelAccount(input.bindExtra ?? null, credential),
```

`probedHotel.bindExtra` 已含渠道字段（抖音 `merchantGroupId` / 美团 `otaPartnerId`），
`withChannelAccount` 再叠账号标识与名字。服务端**按键合并**，不冲掉远端已有字段
（`bind-extra.ts:18` 注释所述的既有约定）。

### 3.5 放宽 `startReauth` 的旧拦截

`ReauthOtaAccountDialog:80` 现在会劝退没有 `channelAccountId` 的凭证。场景 2 下这
拦截必须放宽 —— 用户选的凭证可能自己就是老的，但只要能按门店核对，路就是通的。

| 场景 | 凭证有 accountId | 拦截 |
|---|---|---|
| 1 | 必须有（否则无从核对） | 保留 |
| 2 | 不要求 | **放宽**；无 accountId 时核对照做，只是补写那步跳过 |

## 4. 流程

```
点「去登录」
   │
   ├─ bindExtra.channelAccountId 有 ──→【场景 1】
   │     弹窗：预选并锁定该凭证
   │     openExisting + reauth-ota{ expectedChannelAccountId }
   │     → 账号身份探测（现有）→ 比对 accountId
   │         ├ 一致   → confirmReauth（只换凭证）
   │         └ 不一致 → 'account-mismatch'
   │
   └─ 无 ────────────────────────────→【场景 2】
         弹窗：列出凭证（可推测则标注依据），或「新登录账号」
              ├ 选已有 → openExisting        ┐
              └ 新登录 → openForNewLogin     ┘ 都带 reauth-by-hotel
         → 登录成功 → 【门店探测】三渠道一律执行
         → expectedOtaHotelId 在候选里吗？
             ├ 在   → confirmReauth + 补写 bindExtra（自愈）
             └ 不在 → 'hotel-mismatch'，提示后由用户重选或解绑
```

## 5. Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **抖音探测 30s 且会挪走用户页面**（`hotel-prob.ts` 点「门店管理」菜单 + 拦 `dsl/get`） | 场景 2 是存量兜底、走一次即自愈，不是日常路径；加进度提示「正在确认门店，请勿操作页面」 |
| **服务端是否接受 desktop 补写 bindExtra 键** —— 待联调验证 | 用户已确认服务端支持，联调时实测；若被拒则降级为只更新本地 `ota_hotel`，本机仍自愈、换设备失效 |
| 用户在场景 2 选错账号 | 门店核对拦住，不写任何数据；错误提示带上「该账号管的是 X」（探测结果在手） |
| 新增第三个 intent kind 增加分支面 | 三个 dispatcher 各自只认一个 kind，`switch` 收在订阅侧；`OtaTabIntent` 是判别联合，漏处理编译期报错 |
| 场景 2 探测失败（超时/页面异常）与「门店不匹配」混淆 | `kind: 'none'` 与「比对不中」分开报：前者提示重试，后者提示换账号 |

## 6. Migration Plan

无数据迁移：老记录不批量刷，**在用户下次对该绑定发起重新登录时就地自愈**。

| | |
|---|---|
| 部署 | 主进程与渲染进程同版本发布，IPC 契约同步生效 |
| 回滚 | 移除新 kind 即可；已补写的 `bindExtra` 字段对旧版本无害（旧版只读不写这些键） |
| 兼容 | 未走过场景 2 的老记录行为不变，仍走原路径 |

## 7. Open Questions

### 7.1 ✅ 已结：`bindExtra` 是**按键合并**，不是整体替换

desktop 侧 `gateway/rms/types.ts` 原注释写的是「整体替换」，**与服务端实现不符**，
已订正。服务端源码（`AppOtaBindAppService:251`）：

```java
DeskBindExtra.of(account.getBindExtra())   // 先读库里现值
        .applyFromDesktop(desktopExtra)     // 再叠加本次传的
        .takeOverFromRpa();
// 注释：判据是【合并后的最终结果】，本次没传但库里已有算通过。
```

rms-server 的 `app-ota-binding-backfill-hotel/api.md` §7 也明确确认了这一点。
所以 desktop 只发变化的键是安全的，未传的键保留原值。

**真机实证（2026-08-15，广昊假日酒店·美团，走 reauth）**：

```
desktop 送出   { channelAccountId, channelAccountName }          ← 只有账号级两个键
远端结果       { bindSource:"DESKTOP", otaPartnerId:"4947602",
                 channelAccountId:"292462264", channelAccountName:"guanghaojiariAI" }
```

一次验证了两条断言：

- ✅ **desktop 只补账号级**：没有新写任何门店级字段
- ✅ **服务端确实按键合并**：库里原有的 `otaPartnerId` 完好保留 —— 若真是整体替换，
  这次只送两个键，它必然消失

`bindSource` 是旁证：该字段服务端**明确不接受客户端传**（`AppBindExtraRequest`
注释：「由服务端盖章，客户端传了也不采纳」），它能出现在结果里，只可能来自库里
现值 —— 同一次合并里的 `otaPartnerId` 同理。

⚠️ 仍需留意：reauthenticate 会「把同一登录凭据（`channelAccountId` 相同）下**其余
酒店**的 cookie 一并更新」。这是服务端有意设计（同账号本就共享登录态），但意味着
一次重登的影响面不止当前这条记录 —— 真机验证时值得确认符合预期。

### 7.2 其余

- [ ] 美团 `hotel-prob.ts` 的探测代价具体多大（注入脚本发请求，预计远低于抖音的
      30s）—— 不影响方案形状，实现时实测，必要时只调进度提示文案
- [ ] 分页每页条数（暂定 10 条）—— 实现时看实际列表密度定
