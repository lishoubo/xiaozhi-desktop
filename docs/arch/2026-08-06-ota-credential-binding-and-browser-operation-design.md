# OTA Credential、本地 OTA Account 与浏览器 intent/probe 设计

> 日期：2026-08-06
>
> 状态：方案草案，供后续 OpenSpec proposal/design/tasks 使用
>
> 前置现状：`docs/arch/2026-08-05-ota-login-and-hotel-binding-current-state.md`

## 1. 核心判断

登录态和酒店不是同一个概念，但部分渠道会让它们看起来相同：

- 抖音：一份登录态可以访问多个 `groupId`，明显是一对多。
- 美团：当前可能只能探测出一个 `hotelId`，看起来是一对一。
- 携程：登录身份结构还需要继续踩点。

不能因为美团当前是一对一，就把 credential 定义成 hotel；否则抖音会再次被迫用复制 partition 或复制 cookie 解决多酒店问题。

本地保留两个模型：

1. `OtaCredential`：一份可复用登录态，持有唯一 partition 和渠道登录身份信息。
2. `OtaAccount`：该 credential 已发现的一个可操作 OTA 酒店入口。

这不是回到旧模型。旧 `OtaAccount` 同时承担登录态、partition 和酒店；新模型把它拆开：

```text
OtaCredential 1 ────── * OtaAccount
   登录身份                  可绑定酒店入口
   partition                 otaHotel + bindExtra
```

流程也随之简化：登录或 cookie 导入时完成 credential probe 和 hotel probe，形成可复用的本地账号目录；绑定 RMS 酒店时优先直接选择本地 `OtaAccount`。

## 2. 模型总览

| 模型 | 位置 | 职责 |
|---|---|---|
| `OtaCredential` | desktop 本地 | 登录身份、partition、渠道 credential 原始信息 |
| `OtaAccount` | desktop 本地 | credential 可访问的 OTA 酒店及进入上下文 |
| `RmsHotel` | RMS | 实体酒店 |
| `RmsOtaAccount` | RMS | 实体酒店与 OTA 酒店的正式绑定 |
| `RmsOtaCredential` | RMS | 服务端使用的 credential、cookie 和健康状态 |

跨系统名称在 RMS 内部去掉 `Rms` 前缀：`RmsHotel` → `Hotel`、`RmsOtaAccount` → `OtaAccount`、`RmsOtaCredential` → `OtaCredential`。

本地和 RMS 都有 `OtaAccount`，含义接近但权威性不同：

- 本地 `OtaAccount` 是“这个 credential 最近探测到哪些酒店”的目录，可以重新生成。
- `RmsOtaAccount` 是“哪个实体酒店绑定了哪个 OTA 酒店”的业务事实，不能由探测自动覆盖。

## 3. 本地数据模型

### 3.1 `OtaCredential`

```ts
type OtaCredential = Readonly<{
  id: OtaCredentialId;
  channel: ChannelId;
  partitionName: string;
  credentialExtra: CredentialExtra | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;
```

字段语义：

- `id`：本地与远端共同使用的 credential 关联键。
- `partitionName`：Electron session 的唯一权威指针。
- `credentialExtra`：credential probe 返回的渠道原始登录身份信息。
- `lastRefreshedAt`：最近一次成功完成 credential probe 的时间。

`credentialExtra` 是渠道特定、经过校验的 JSON。示例：

```ts
type DouyinCredentialExtra = Readonly<{
  loginId: string | null;
  displayName?: string;
}>;

type MeituanCredentialExtra = Readonly<{
  hotelId: string;
}>;
```

美团的 credential 信息即使只有 `hotelId`，也可以如实保存。它与本地 `OtaAccount.otaHotelId` 数值相同并不构成问题：前者是“用什么身份登录”，后者是“这个身份能操作哪家酒店”。这是渠道事实导致的 1:1，而不是领域模型必须合并。

`credentialExtra` 不保存原始 cookie、密码或验证码。cookie 仍只存在于 Electron session；需要同步 RMS 时由 desktop main 导出。

`partitionName` 和 `credentialExtra` 不进入 renderer。renderer 只读取脱敏后的 credential 摘要。

### 3.2 本地 `OtaAccount`

```ts
type OtaAccount = Readonly<{
  id: OtaAccountId;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: OtaBindExtra | null;
  discoveredAt: number;
  lastSeenAt: number;
}>;
```

与当前实现相比：

- 增加 `credentialId`。
- `partitionName` 移到 `OtaCredential`。
- `channelContext` 政名为 `bindExtra`，含义与远端绑定保持一致。
- 同一 credential 可以关联多条本地 `OtaAccount`。

`bindExtra` 保存进入具体酒店所需的上下文，例如：

```ts
type OtaBindExtra = Readonly<{
  merchantGroupId?: string; // 抖音 groupId
  lifeAccountId?: string;
  otaPartnerId?: string; // 美团集团/加盟商
}>;
```

本地账号的去重不能再使用当前的 `(channel, otaHotelId)`。至少要包含 `credentialId` 和渠道定义的稳定酒店入口身份；抖音需要把 `groupId` 纳入判断。具体唯一键由各渠道 hotel probe 提供，不在通用层解析任意 JSON。

hotel probe 只 upsert 本次发现的账号，不因一次结果缺失就删除历史账号。后续若要识别账号已失效，另行设计明确的完整快照或校验机制。

### 3.3 本地关系

```text
OtaCredential
  id = credential-1
  channel = douyin
  partition = persist:ota/douyin/credential-1
  credentialExtra = { loginId: ... }
       │
       ├── OtaAccount A
       │     otaHotelId = hotel-a
       │     bindExtra = { merchantGroupId: group-a }
       │
       └── OtaAccount B
             otaHotelId = hotel-b
             bindExtra = { merchantGroupId: group-b }
```

## 4. 远端模型

### 4.1 `RmsOtaAccount`

```ts
type RmsOtaAccount = Readonly<{
  id: number;
  orgId: number;
  hotelId: number;
  channel: ChannelId;
  credentialId: string | null;
  bindSource: 'APP' | 'RMS';
  otaHotelId: string | null;
  otaHotelName: string | null;
  bindExtra: OtaBindExtra | null;
  status: string;
  bindError: string | null;
}>;
```

这里的 `status` 只表示绑定、初始化或酒店匹配状态。`RmsOtaAccount` 不包含 credential、cookie 或密码的健康状态。

### 4.2 `RmsOtaCredential`

```ts
type RmsOtaCredential = Readonly<{
  id: string;
  orgId: number;
  channel: ChannelId;
  authMethod: 'APP_SESSION' | 'PASSWORD' | 'SMS';
  username: string | null;
  credentialExtra: JsonObject | null;
  status: 'UNKNOWN' | 'VALID' | 'EXPIRED' | 'FAILED';
  lastVerifiedAt: string | null;
}>;
```

RMS 内部的 `OtaCredential` 可以持有加密后的 password/cookie，但公共 DTO 不返回秘密字段。APP 创建或刷新 credential 时，将本地脱敏身份信息和导出的 cookie 提交给 RMS。

### 4.3 本地账号与远端绑定

绑定时，将选中的本地 `OtaAccount` 投影为远端绑定：

```text
local OtaAccount.credentialId  → RmsOtaAccount.credentialId
local OtaAccount.channel       → RmsOtaAccount.channel
local OtaAccount.otaHotelId    → RmsOtaAccount.otaHotelId
local OtaAccount.otaHotelName  → RmsOtaAccount.otaHotelName
local OtaAccount.bindExtra     → RmsOtaAccount.bindExtra
selected RmsHotel.id           → RmsOtaAccount.hotelId
```

探测可以更新本地目录，但不能自动改变已有 `RmsOtaAccount`。正式绑定必须经过用户确认。

## 5. 两类 Probe

### 5.1 CredentialProbe

每次新登录、cookie 导入或刷新 credential 时运行，用于回答：

- 当前是否已经登录。
- 当前渠道登录身份是谁。
- 应保存哪些脱敏的渠道原始信息。

```ts
type CredentialProbeResult<TExtra> = Readonly<{
  channelIdentity: string | null;
  displayName: string | null;
  extra: TExtra | null;
}>;

interface CredentialProbe<TExtra> extends OtaProbe<CredentialProbeResult<TExtra>> {}
```

不同渠道结果可以不同：

- 抖音：从 cookie/页面事实判断登录状态，并取得 `loginId` 等信息。
- 美团：如果唯一可靠信息就是 `hotelId`，结果可以只包含它。
- 携程：待踩点后定义自己的 extra，不要求提前套入抖音或美团结构。

这里的“probe cookie”是从 cookie 中提取身份事实，不是把原始 cookie 放进 probe 结果或 SQLite。

### 5.2 HotelProbe

在 credential probe 成功后运行，用于回答“当前 credential 可操作哪些 OTA 酒店”。它返回零个、一个或多个本地 `OtaAccount` 所需事实。

```ts
type DiscoveredOtaHotel = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: OtaBindExtra | null;
  stableKey: string;
}>;
```

`stableKey` 由渠道 probe 生成，仅用于同一 credential 下的本地账号 upsert。例如抖音可纳入 `groupId`，通用层不理解其组成。

CredentialProbe 和 HotelProbe 可以使用不同的页面、URL、cookie 或 network response。通用层不规定“必须登录后先去哪一页”，由 feature 和渠道 probe 决定。

### 5.3 共同运行机制

Probe 只负责探测事实和清理监听器，不负责 UI、落库、远端 mutation 或业务顺序。

每个 probe 注册自己的超时和重试策略；小型 `ProbeRunner` 统一处理 timeout、retry、cancel 和 cleanup。结果结构由具体 probe 定义，不建立跨渠道统一状态机或候选模型。

## 6. BrowserIntent 与 Feature

### 6.1 BrowserIntent

Intent 表达本次打开 partition 的目的，不持久化到 credential：

```ts
type BrowserIntent =
  | { kind: 'CREATE_OTA_CREDENTIAL' }
  | { kind: 'REFRESH_OTA_CREDENTIAL' }
  | { kind: 'DISCOVER_OTA_ACCOUNTS' }
  | { kind: 'BROWSE_OTA_ACCOUNT'; otaAccountId: OtaAccountId };
```

BrowserManager 只管理 tab、session、本次 intent 和受信任 probe 的挂载，不理解绑定业务。renderer 不能指定 partition、任意 URL、任意 probe 或脚本。

### 6.2 创建或导入 credential

由 `CreateOtaCredentialFeature` 编排：

```text
创建 credentialId 和 partition
  → 用户新登录或导入 cookie
  → CredentialProbe
  → 保存 OtaCredential.credentialExtra
  → HotelProbe
  → upsert 0..N 个本地 OtaAccount
  → 同步或创建 RmsOtaCredential
```

酒店发现不再等到绑定时才做。即使没有发现酒店，只要 credential probe 成功，也可以保存 credential，稍后重新探测。

### 6.3 绑定 OTA 账号

由 `BindOtaAccountFeature` 编排：

```text
用户选择 RmsHotel 和 channel
  → 列出本地 OtaAccount
  → 用户选择一个本地 OtaAccount
  → 确认 OTA 酒店与 bindExtra
  → 创建/更新 RmsOtaAccount
```

绑定本身通常不打开浏览器、不运行 probe，也不重新导出 cookie。若本地没有可选账号，feature 引导用户先执行“新建/导入 credential”；完成后回到选择。

抖音还可以从已有 credential 发起“重新发现账号”：

```text
选择已有 Douyin OtaCredential
  → intent=DISCOVER_OTA_ACCOUNTS 打开首页
  → HotelProbe 获取当前可见的多个公司/酒店
  → upsert 本地 OtaAccount
  → 返回绑定选择
```

这里不再在“选择公司”页面设计持续 probe。只在抖音首页读取已经确定的公司/酒店上下文。如果首页一次能够返回多个公司下的酒店，就一次入库多条；如果只能返回当前 `groupId`，则每次用户切换并进入首页后增量发现，不假设 probe 能枚举不可见公司。

### 6.4 刷新 credential

由 `RefreshOtaCredentialFeature` 编排：

```text
选择 OtaCredential
  → 使用原 partition 重新登录或导入 cookie
  → CredentialProbe 更新 credentialExtra
  → HotelProbe 增量刷新本地 OtaAccount
  → 导出 cookie并更新 RmsOtaCredential
```

所有引用该 `credentialId` 的远端绑定自然使用刷新后的 credential。刷新不会自动解绑、改变 `bindSource` 或覆盖远端酒店绑定。

### 6.5 渠道 feature 的边界

优先由通用 create/refresh/discover feature 组合渠道 probe。只有抖音出现跨页面多轮交互、多个 probe 相互反馈等真实差异时，再拆 `DouyinCredentialFeature` 或 `DouyinAccountDiscoveryFeature`。

稳定抽象仍然只有 intent 和 probe；feature 使用普通显式控制流，不实现统一状态机。

## 7. 本地 OTA 登录信息页面

新增一个本地登录信息页面，按 credential 展示：

```text
抖音 · 登录身份 A · 最近刷新时间
├── 酒店 A / group-a
├── 酒店 B / group-b
└── 操作：刷新登录态、重新发现酒店、打开

美团 · hotel-123 · 最近刷新时间
└── 酒店 C
```

页面目的不是复制 RMS 酒店管理，而是管理本机可用登录态：

- 查看有哪些 credential。
- 查看每个 credential 已发现的本地 OTA 账号。
- 刷新失效 credential。
- 对支持的渠道重新发现酒店。
- 从酒店绑定流程中选择这些账号。

页面只展示脱敏的 `credentialExtra` 摘要，不展示 cookie、`partitionName` 或密码。删除 credential/partition 属于高风险生命周期操作，首期可以不提供。

## 8. 关键约束

1. 一个本地 credential 只有一个权威 partition。
2. 一个 credential 可以关联零个、一个或多个本地 `OtaAccount`。
3. 多个 `RmsOtaAccount` 可以引用同一个 credential。
4. `(RmsHotel, channel)` 最多一个活跃远端绑定。
5. 本地探测结果不能自动覆盖远端绑定。
6. 登录过期不自动解绑；解绑不自动删除 credential。
7. cookie、密码和 `partitionName` 不进入 renderer、日志或普通 DTO。
8. credential probe 和 hotel probe 失败时保留已有本地数据，不把暂时失败解释为账号已消失。
9. 普通浏览不意外触发探测；只有 feature 根据 intent 注册 probe。

## 9. 对现有实现的影响

现有 `ota_account` 数据可以原地演进，也可以拆表迁移；目标结构必须满足：

```text
ota_credential
  id, channel, partition_name, credential_extra,
  discovered_at, last_refreshed_at

ota_account
  id, credential_id, channel, ota_hotel_id, ota_hotel_name,
  bind_extra, discovered_at, last_seen_at
```

迁移原则：

1. 先按现有 `partition_name` 建立 `OtaCredential`。
2. 现有每条 `ota_account` 保留为一条本地酒店入口，并关联对应 credential。
3. `channel_context` 迁移为 `bind_extra`。
4. 不根据本地数据猜测 `RmsHotel` 或自动创建远端绑定。
5. 不删除已有 partition 目录。

建议组件边界：

```text
src/main/features/ota-account/
├── create-ota-credential.ts
├── refresh-ota-credential.ts
├── discover-ota-accounts.ts
└── bind-ota-account.ts

src/main/browser/
├── browser-manager.ts
├── browser-intent.ts
└── session-factory.ts

src/main/account-discovery/
├── credential-probe.ts
├── hotel-probe.ts
├── probe-runner.ts
├── probe-registry.ts
└── <channel>-*.ts
```

## 10. 待验证事实

方案不依赖这些问题已有答案，但实现前需要逐渠道踩点：

- 美团的 `hotelId` 是否同时是稳定登录身份和唯一酒店入口。
- 携程可从 cookie、首页或接口获得哪些 credential 身份信息。
- 抖音首页接口一次返回当前 `groupId`，还是能返回当前 login 下的全部公司/酒店。
- cookie 导入后是否必须真实导航一次，才能完成 credential/hotel probe。
- 某渠道 hotel probe 返回的是完整快照还是增量结果。

## 11. 实施与验收建议

正式实现涉及 domain、SQLite、IPC、共享 contract、server 和 RMS 接口，应先建立 OpenSpec 三件套。建议拆为：

1. 本地 `OtaCredential` + `OtaAccount` 拆分、两类 probe、登录信息页面。
2. 使用本地账号的简化绑定流程。
3. `RmsOtaCredential` 及 RMS credential/绑定同步。

关键验收：

- 美团可以表达一 credential 对一账号，而无需特殊模型。
- 同一抖音 credential 可发现并保存多个带不同 `groupId` 的账号。
- 新登录和 cookie 导入都会运行 credential probe 与 hotel probe。
- 绑定已有本地账号时不重新登录、不重复探测。
- 刷新 credential 后，已有远端绑定保持不变。
- 本地登录信息页能按 credential 展示关联酒店。
- 探测失败不会删除已有账号或改变远端绑定。
- renderer、日志和普通 DTO 中无 cookie、密码或 `partitionName`。
