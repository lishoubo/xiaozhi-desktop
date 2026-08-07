## Context

现状链路（不含酒店探测拆分）：

```
BrowserManager.checkUrlPastLogin() 命中
  → 写死的 onUrlPastLogin 回调
  → LoginTabOpener → DiscoverAndCreate.trigger()
  → discoverCtrip/discoverDouyin/discoverMeituan（一次调用同时拿身份+酒店）
  → persistIdentifiedResult()：同一方法内先归并 OtaCredential，再逐个 upsertAccount()
```

三渠道探测函数内部结构差异（决定了能否拆分）：

| 渠道 | 身份来源 | 能否拆成"先探身份、再探酒店"两阶段 |
|---|---|---|
| 携程 | 从酒店 DOM 顺带解析（`channelAccountId` = 酒店ID） | 不能——身份不是独立数据源 |
| 美团 | 两次独立 `executeJavaScript`（先读身份，再读门店列表），互不冲突 | 能，且干净 |
| 抖音 | 读 session storage（不碰 CDP）→ 挂 CDP 抓门店列表（独占资源） | 能，且必须拆（CDP 独占） |

三渠道 URL 可信域名校验逻辑完全重复（协议+hostname 判断），只是硬编码域名不同：

```ts
// 三份几乎一样的代码，分别在 discover-ctrip.ts / discover-douyin.ts / discover-meituan.ts
function isTrustedXxxUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === '固定域名'; }
  catch { return false; }
}
```

renderer 侧已确认无任何界面消费 `OtaAccount` 数据（上一次 IPC 收敛改动核实），本
次是纯 main 进程内部重构，不涉及 IPC/preload。

## Goals / Non-Goals

**Goals:**
- `ota-credential` 收敛为单一职责：登录判定 + 身份归并，不再级联写酒店信息
- 酒店探测独立成 `OtaHotelProbFeature`，通过广播事件触发，自行判断、自行去重、
  自行分发到渠道实现
- 三渠道重复的 URL 可信域名校验收敛成一个共用函数
- 目录结构统一：`ota-credential`/`ota-hotel-prob` 两个 Feature 各自按渠道分子目录

**Non-Goals:**
- 不改 `OtaCredential` 归并规则本身
- 不迁移已有 `ota_account` 表数据到新表（见"迁移策略"）
- 不实现"发现新酒店"的增量场景（同一凭证多次导航只探测一次，见 spec 去重规则）
- 不改 IPC/preload/renderer（无任何界面消费此数据）
- 不在这次把 `TabEventBus` 做成支持多种事件类型的通用总线——只做导航事件广播，
  CDP/网络请求类的广播机制留待真正需要时再设计（对应上一版架构文档 7.7 节的边界）

## Decisions

### 决策 1（已被真机验证推翻并修复，见"实施后修复记录"）：最初方案是并行广播

最初方案是 `BrowserManager` 在 `did-navigate` 那一刻，与 `checkUrlPastLogin`
并行广播一个只含 `{tabId, partitionName, channel, url, webContents}` 的原始
事件（`emitNavigated`/`tab:navigated`），`OtaHotelProbFeature` 收到后自己去
`credentialRepository.findByPartitionName(...)` 查credential。这个方案已经
**在真机验证中被证实有真实竞态 bug**，完整问题描述和修复方案见本节末尾"实施后
修复记录"，当前代码采用的是修复后的方案，不是这里最初描述的方案。

保留这段记录是为了说明最初的候选方案取舍依然成立（要不要改 `checkUrlPastLogin`
统一分发、要不要在 `DiscoverAndCreate` 探测完成后再广播），只是"并行广播、两条
链路互不感知"这个具体实现在真机场景下不成立，被下面的修复方案取代：

| 候选方案 | 说明 | 结论 |
|---|---|---|
| 改造 `checkUrlPastLogin`，让它统一分发给多个订阅者 | 需要重写现有登录判定的分发逻辑 | 最初放弃，修复时采纳（见下） |
| `DiscoverAndCreate` 探测完成后再广播 | `OtaHotelProbFeature` 变成下游消费者，不是独立订阅者 | 放弃：不满足"各自独立判断"的架构原则，修复方案里也未采纳 |
| ~~并行广播，两条链路互不感知~~ | `BrowserManager` 只多一行 `emit`，老链路一行不改 | **已推翻**：存在真实时序竞态，见下 |

### 决策 2：`OtaHotelProbFeature` 自带判定逻辑，不复用 `ota-credential` 的登录判定

这条决策本身不受下面的修复影响，继续成立：`OtaHotelProbFeature` 自己判断"这是
不是能看到酒店列表的页面"（`isProbeableUrl`），不问 `ota-credential` 内部是怎么
判定登录成功的，两者不共享判定代码、不互相调用——变化的只是"credential 数据
从哪里来"这一点（修复前是自己查数据库，修复后是从事件里直接拿），不是"判定逻辑
该不该独立"这条原则。

### 决策 3：三渠道在广播/接口层完全一致，差异只在各自 `probe()` 内部实现

`OtaHotelProbFeature` 对三个渠道走同一套流程：收到广播 → 查 `HotelProbe` →
`probe.isProbeableUrl()` 判断 → `probe.probe(credential, webContents)` 拿结果
→ 落库。三个渠道注册的都是同一个 `HotelProbe` 接口，广播事件、去重逻辑、落库
逻辑对三渠道没有任何分支：

```ts
export interface HotelProbe {
  isProbeableUrl(url: string): boolean;
  probe(
    credential: OtaCredential,
    webContents: WebContents,
  ): Promise<HotelProbeOutcome>;
}
```

差异体现在各渠道 `probe()` 内部**怎么拿到酒店数据**，不体现在接口或触发机制上：

| 渠道 | `credential.credentialExtra` 是否已含酒店字段 | `probe()` 内部实现 |
|---|---|---|
| 携程 | 是（`{hotelId, hotelName, identitySource:'hotel-dom'}`，见 Context 一节） | 不碰页面，直接解析 `credential.credentialExtra` 翻译成 `OtaHotelProb` |
| 抖音 | 否（`credentialExtra` 只有账号资料） | 真的操作页面：点门店管理菜单 + CDP 抓包 |
| 美团 | 否（`credentialExtra` 只有账号资料） | 真的操作页面：读门店列表 `executeJavaScript` |

`isProbeableUrl()` 对携程的实现直接返回 `true`（只要能查到 credential 就有酒店
字段可读，不依赖当前 URL 处于哪个具体页面）；抖音/美团的实现按各自渠道的域名和
路径判断当前是否已经在能读到酒店数据的页面上。

**不引入任何"`ota-credential` 主动推送结果给 `ota-hotel-prob`"的旁路接口**——
三渠道在"接收广播、决定要不要探测"这一层完全统一，携程只是恰好不需要碰页面，
这个差异被封装在它自己的 `probe()` 实现内部，`OtaHotelProbFeature` 的主流程代码
不knowing/不区分渠道。

### 决策 4：抖音探测顺序化，不是并发防护

抖音的"账号身份读取"和"酒店探测"仍然是**顺序**执行（先读身份、后挂CDP探测酒
店），只是现在分属两个 Feature 各自的调用链路。不需要引入锁/信号量协调 CDP 占
用——因为：

```
ota-credential 侧 discover-douyin.ts（拆分后只剩"读身份"部分）
  执行时不碰 CDP，读完身份就返回，函数调用栈结束
    ↓（时间上完全结束之后）
OtaHotelProbFeature 收到广播、判定该 credential 尚未探测酒店
  才开始 attach CDP
```

两者不会同时发生，因为"读身份"这个动作本身很快（几个 `executeJavaScript` 调
用），不持有 CDP，`OtaHotelProbFeature` 触发时机自然晚于身份读取完成。

**这段"天然会跳过等下一次导航事件再试"的描述已被真机验证证伪**，见下方"实施后
修复记录"：查不到 credential 时确实会跳过，但**不是所有场景都有"下一次导航"**
（比如携程登录通常只触发一次 `did-navigate`），跳过等于永久错过，不是安全的
降级。修复方案见下，`OtaHotelProbFeature` 现在不再自己查 credential。

### 决策 5：URL 可信域名校验收敛到 Feature 层 common

```
main/features/common/ota/trusted-hotel-url.ts

export function isTrustedHotelUrl(url: string, expectedHostname: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === expectedHostname;
  } catch {
    return false;
  }
}
```

`ota-credential/ota/{ctrip,douyin,meituan}/` 和 `ota-hotel-prob/ota/{douyin,meituan}/`
各自 import，不再各写一份内联判断。携程侧 `ota-hotel-prob` 不需要，不引入依赖。

### 决策 6：目录结构

```
main/browser/
  browser-manager.ts             改动：新增 TabEventBus 依赖，checkUrlPastLogin
                                  改为异步，credential 确认后才广播（见"实施后
                                  修复记录"，不是最初设想的"并行广播一行"）
  session-factory.ts             不动
  tab-event-bus.ts                新增

main/features/common/
  ota/
    trusted-hotel-url.ts          新增：URL 可信域名校验

main/features/ota-credential/     （原 main/account-discovery/ 整体移入 + 原有内容）
  login-tab-opener.ts             不动
  discover-and-create.ts          移入，内部逻辑不改（仍归并 credential；不再
                                   直接 upsertAccount，见决策 7）
  discovery-probe-port.ts         移入
  discovery-probe.ts              移入
  login-url-matcher.ts            移入
  ota/
    ctrip/
      discover-ctrip.ts           移入，不拆
      hotel-dom.ts                移入
      login-url-matcher.ts        移入（原 ctrip-login-url-matcher.ts）
    douyin/
      discover-douyin.ts          移入，拆分：只保留读身份部分
      account-identity.ts         移入
      login-url-matcher.ts        移入（原 douyin-login-url-matcher.ts）
    meituan/
      discover-meituan.ts         移入，拆分：只保留读身份部分
      account-identity.ts         移入
      login-url-matcher.ts        从 main/ota/meituan/ 移入，位置对齐携程/抖音

main/features/ota-hotel-prob/     新增
  ota-hotel-prob-feature.ts
  hotel-prob-port.ts               HotelProbe 接口定义
  ota/
    ctrip/
      hotel-prob.ts                消费 ota-credential 侧结果，不独立操作页面
    douyin/
      hotel-prob.ts                点门店管理菜单 + CDP 抓包（原 discover-douyin.ts 后半段）
      dsl-get-response-capture.ts  移入（原属 discover-douyin.ts 内部类）
    meituan/
      hotel-prob.ts                读门店列表（原 discover-meituan.ts 后半段）
      poi-infos.ts                 移入

main/ota/                          删除（内容已全部移入上述两个 Feature 目录）
main/account-discovery/            删除（内容已全部移入 ota-credential）
```

### 决策 7：新表与迁移策略

```sql
CREATE TABLE ota_hotel_prob (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES ota_credential(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  ota_hotel_id TEXT NOT NULL,
  ota_hotel_name TEXT,
  bind_extra TEXT,
  discovered_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ota_hotel_prob_channel_hotel_idx ON ota_hotel_prob(channel, ota_hotel_id);
CREATE INDEX ota_hotel_prob_credential_idx ON ota_hotel_prob(credential_id);
```

字段结构与现有 `ota_account` 完全一致（对齐现有 `OtaAccount` 类型），domain 层
新增 `OtaHotelProb` 类型（不复用 `OtaAccount` 类型名，避免和保留中的旧模型混淆）：

```ts
// domain/ota-hotel-prob.ts
export type OtaHotelProb = Readonly<{
  id: OtaHotelProbId;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  discoveredAt: number;
}>;
```

| 旧表处理方式 | 说明 | 结论 |
|---|---|---|
| 迁移脚本把 `ota_account` 数据搬到 `ota_hotel_prob` | 需要处理字段映射、迁移失败回滚 | 放弃：本次改动不要求历史数据延续，重新登录即可重新探测 |
| 保留 `ota_account` 表和 `OtaAccountRepository`，停止写入 | 现有代码依赖它的地方（domain 类型、Repository 接口）暂不删除 | 采用：风险最低，后续单独一次改动清理 |
| 立即删除 `ota_account` 表 | 一步到位 | 放弃：本次改动已经涉及大量文件移动，不叠加删表风险 |

## 实施后修复记录：credential 时序竞态（真机验证发现）

### 问题

初版实施（决策1最初方案）用真实携程/抖音账号真机验证时，携程渠道
`ota_credential` 归并成功、但对应的 `ota_hotel_prob` 记录始终没有生成，无 error
日志、只有静默丢失。抖音渠道这次同样应该受影响，但因为操作时偶然对同一账号
额外多打开了一次（触发了第二次 `did-navigate`），侥幸探测成功，掩盖了问题。

### 根因

`BrowserManager` 在 `did-navigate` 事件里，`checkUrlPastLogin()`（触发
`DiscoverAndCreate.trigger()`，异步写入 credential）和
`tabEventBus.emitNavigated(...)`（广播原始事件）是**并行**执行的，广播不等
credential 真正写完。真机实测携程从触发到 credential 写入数据库耗时约
660ms（抖音约5秒多，因为要等 CDP 抓包）。`OtaHotelProbFeature` 收到广播后立刻
`credentialRepository.findByPartitionName(...)`，如果这次查询发生在 660ms
窗口内，查到的是 `null`，代码逻辑是"查不到就跳过，等下一次导航再试"——但
携程这次登录整个过程只触发了**一次** `did-navigate`，没有"下一次"，这次机会
错过后 `ota_hotel_prob` 永久没有记录。

抖音之所以这次侥幸成功，是因为真机操作时对同一账号多打开了一次（这次导航发生
在 credential 已写完之后），不是代码本身没有这个竞态——三个渠道都受影响，只是
携程最容易暴露（唯一"零页面操作、必然只有一次导航"的渠道）。

### 修复方案

不再"并行广播 + 下游自己查数据库再重试"，改成"credential 确认完毕后才广播，
事件本身携带查询结果"：

1. `DiscoverAndCreate.trigger()` 返回类型从 `Promise<boolean>` 改为
   `Promise<OtaCredential | null>`——返回值就是这次处理最终确认的 credential，
   不再只是"是否成功"这个布尔值。
2. `LoginTabOpener` 里 `onUrlPastLogin` 回调不再 `void` 掉
   `triggerDiscovery(...)` 的返回值，改为直接 `return`，把这个结果继续
   透传给 `BrowserManager`。
3. `BrowserManager.checkUrlPastLogin()` 改为 `async`：四个判定分支（已触发过/
   未挂业务回调/URL未命中/确实需要处理）各自决定何时广播——前三种不需要处理
   的场景立刻广播（`outcome.kind: 'not-applicable'` 或 `'not-yet-past-login'`），
   第四种场景 `await tab.onUrlPastLogin(...)` 跑完、拿到确认的 credential 后
   才广播（`outcome.kind: 'checked', credential`）。
4. `TabEventBus` 的事件从 `emitNavigated`/`tab:navigated`（只有原始字段，没有
   订阅者）整体替换为 `emitCredentialChecked`/`tab:credential-checked`（带
   `CredentialCheckOutcome`，直接包含处理结果）。旧事件删除，唯一订阅者
   `OtaHotelProbFeature` 完全切到新事件。
5. `OtaHotelProbFeature` 不再依赖 `OtaCredentialRepository`（不用自己查了），
   只在 `outcome.kind === 'checked' && outcome.credential` 时才继续判断
   `isProbeableUrl`/发起探测——`credential` 直接从事件里取，已经是真实写入
   数据库的数据。

### 决策 4（时序）随之更新

原决策4论证"抖音探测顺序化，不需要锁"这条结论依然成立（读身份和挂 CDP 本来就
是两个 Feature 各自的调用链路，天然不会同时发生）；但论证过程中"查不到
credential 就安全跳过、等下一次导航再试"这条前提已被推翻，见上。

## 实施后修复记录二：`onLoadFinished` 独立通道从未接入广播（真机验证发现）

### 问题

修复完上面的竞态后再次真机验证：抖音、美团都正常产出 `Hotel probe saved
hotels` 日志、`ota_hotel_prob` 表有对应记录；携程 `ota_credential` 依然保存
成功，但依然没有 `ota_hotel_prob` 记录，且这次连一条 warn/error 日志都没有。

### 根因

`BrowserManager.createTab` 除了 `did-navigate` 触发的 `checkUrlPastLogin`
（上面已修复），还有一条完全独立的第二通道：`onLoadFinished`——`loadURL()`
一 resolve 就立即调用，不经过 `checkUrlPastLogin`，从建立起（早于
`TabEventBus` 存在）就没有接广播。`LoginTabOpener.createFromCookie` 里携程
分支专门走这条通道（"cookie 有效直接落地页面，无效被重定向回登录页，交给
探测层自行区分"），这是"携程 cookie 登录"（设置页"登录账号"入口）这唯一
一条真实用户路径，其余入口（新建账号、抖音 cookie 登录等）都走
`onUrlPastLogin`/`loginUrlMatcher`，没有这个问题。

第一版修复给 `onLoadFinished` 补了一次广播调用（保留独立通道，让它也发
`tab:credential-checked`），进一步复核后发现这个独立通道本身就是多余的：
`ctripLoginUrlMatcher.isPastLogin(url)` 判据是"URL 不含 `/login/`"——cookie
有效会直接跳转到非 `/login/` 的酒店后台页（命中），cookie 失效会被重定向回
`/login/` 登录页（不命中），跟其他渠道用的是同一套"URL 是否跳出登录页"语义，
没有理由单独维护一条"不等待、页面加载完就无条件触发"的通道。

### 修复方案

删除 `onLoadFinished`（`BrowserManager.createAndNewPartition`/`createTab`
参数、`ManagedTab` 里由 `OnUrlPastLogin` 类型别名统一后不再需要区分），携程
`createFromCookie` 改为与抖音一致，统一传 `loginUrlMatcher` + `onUrlPastLogin`。
携程和抖音在 `LoginTabOpener.createFromCookie` 里从此走同一段代码，不再有
按渠道分叉的 if 分支。

### 教训

`TabEventBus` 广播是这次拆分要求的新契约，只把它接到"看起来主要"的那条路径
（`did-navigate`）是不够的——同一个功能有几条独立触发路径，就要挨个确认是否
都过了新契约，不能假设只有一条。真机验证覆盖到"携程 cookie 登录"这个具体
入口才暴露出来，纯读代码/单测没有发现（单测里 `onLoadFinished` 分支本身测的
是"这条路径存在且被调用"，没有测"它是否接了广播"）。

## Risks / Trade-offs

**[风险] `BrowserManager` 是通用容器，这次改动触碰它，且比最初设想的改动面更
大** → **缓解**：初版方案（并行广播，两处各一行）已被真机验证证伪，修复后
`checkUrlPastLogin` 从同步改为异步，是这次改动里对 `BrowserManager` 触碰最深
的一处；但四个判定分支的现有逻辑一行未改，只是包了一层 `async`/在各分支末尾
决定广播时机，改动是"重新组织现有分支的收尾动作"，不是重写判定逻辑本身。

**[风险] `ota_account` 表保留但停止写入，代码里会同时存在"活的"新表和"僵尸"旧
表** → **缓解**：`OtaAccountRepository`/`domain/ota-account.ts` 保留但不再被
`DiscoverAndCreate` 调用，属于已知技术债，design 明确记录，不在本次改动中处理，
避免范围蔓延。

**[风险] 抖音/美团探测函数拆分后，两个 Feature 各自的部分如果渠道页面改版，需
要同时理解两处代码才能排查问题** → **缓解**：账号身份读取和酒店探测本身是两件
独立的业务动作，拆开后各自的改动半径更小；原文件顶部的详细踩坑注释（尤其抖音
CDP 抓包那部分）随对应代码块一起搬到新文件，不丢失历史排错线索。
