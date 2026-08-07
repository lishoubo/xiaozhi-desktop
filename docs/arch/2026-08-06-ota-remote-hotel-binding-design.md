# RMS 酒店 OTA 绑定：目标设计（未实现）

> 日期：2026-08-06
>
> 状态：设计草案，**本文描述的流程尚未实现**；本文不等同于 OpenSpec
> proposal/spec/tasks，进入实现前需要先建立三件套
>
> 前置文档：
> `docs/arch/2026-08-06-ota-local-login-and-account-discovery.md`（本地登录建号现状，
> 已实现）
> `docs/arch/2026-08-05-ota-login-and-hotel-binding-current-state.md`

## 1. 文档目的

本地登录建号链路（`OtaCredential` + `OtaAccount`）已经实现，见前置文档。本文要解决的是
下一步：把本地发现的 OTA 酒店正式绑定到远端 `RmsHotel`，以及处理绑定失效后的修复流程。

当前 `DiscoverAndCreate.trigger()` 只有一种后置动作（本地 upsert）。远端绑定引入之后，同一
份"探测到的渠道身份 + 酒店"事实，后置动作会变成好几种：新增绑定、修复失效绑定、更换绑定
的登录账号、或者只是本地追加酒店而不碰远端。这些流程会跑相同的渠道探测代码，但探测之后
允许的动作不同：有的允许创建远端绑定，有的必须只更新指定的远端记录，绝不能新建。

本文列出每条流程的 Intent、Probe、Handler、关键模型值、允许的写操作和失败语义。

## 2. 远端模型

### 2.1 `RmsHotel`

```ts
type RmsHotel = Readonly<{
  id: string;
  orgId: string;
  name: string;
  city: string | null;
  status: string;
}>;
```

示例：

```text
RmsHotel H1
  id      = 1001
  orgId   = 20
  name    = 西子酒店
  city    = 杭州
  status  = ACTIVE
```

### 2.2 `RmsOtaAccount`

当前 RMS `ota_account` 是聚合模型，包含物理酒店、渠道、OTA 酒店、状态、加密 Cookie 和
`bindExtra`。目标公开 DTO 不返回 Cookie 明文或密文，但需要包含酒店管理和恢复流程所需字段：

```ts
type RmsOtaAccountView = Readonly<{
  id: string;
  orgId: string;
  hotelId: string;
  source: ChannelId;
  clientCredentialId: string | null;
  username: string | null;
  status:
    | 'PENDING_LOGIN'
    | 'IN_PROGRESS'
    | 'BOUND'
    | 'LOGIN_FAILED'
    | 'LOGIN_EXPIRED'
    | 'HOTEL_NAME_MISMATCH'
    | 'HOTEL_NAME_AMBIGUOUS'
    | 'INIT_FAILED';
  otaHotelId: string | null;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  bindError: JsonObject | null;
  lastLoginAt: string | null;
  lastInitAt: string | null;
  updatedAt: string;
}>;
```

`clientCredentialId` 是目标 contract 需要补充的关联键，用来把远端绑定定位到本机
`OtaCredential`。它不是 partition，也不包含秘密。已有远端数据允许为 `null`，此时恢复流程
必须让用户重新选择本地 Credential 或登录新账号，不能按酒店名、手机号或 `groupId` 静默猜测。

示例：

```text
remote account R1
  id                  = 9001
  hotelId             = 1001
  source              = meituan
  clientCredentialId  = cred-meituan-001
  status              = BOUND
  otaHotelId          = poi-10001
  otaHotelName        = 西子酒店
  bindExtra           = { otaPartnerId: "partner-9" }
  cookieJarCipher     = <仅 RMS 内部保存，不进入 View>
```

`clientCredentialId` 是否直接落入当前 RMS 表，仍需 RMS contract 和迁移确认；但无论物理实现
如何，desktop 必须获得一个明确且不可猜测的 Credential 关联键。

### 2.3 本地模型与远端模型的边界

本地 `OtaAccount` 与 `RmsOtaAccount` 不是同一条记录：

- 本地 `OtaAccount` 是可重新发现的本机目录，但目前没有对应的展示界面（见前置文档第 5 节）；
- `RmsOtaAccount` 是正式业务绑定；
- 本地探测成功不能自动创建、替换或删除远端绑定；
- 远端绑定只有在对应 Handler 获得用户确认后才能改变。

## 3. 目标分层：Landing Ready、Probe、Handler

### 3.1 两个拆分维度

目标不是简单把 `DiscoverAndCreate` 改名，而是同时拆开：

1. **取得什么事实**：选择哪一种 Probe；
2. **事实取得后做什么**：由 Intent 对应的 Handler 决定。

```text
BrowserManager 检测到登录后页面
              │
              ▼
handleOtaLandingReady({ intent, browserContext })
              │
              ├── 按 intent 选择 Probe
              ▼
         ProbeOutcome
              │
              ├── 按 intent 选择 Handler
              ▼
 创建/更新本地目录、等待用户确认、创建远端绑定或修复指定绑定
```

`DiscoverAndCreate.trigger()` 建议改名为 `handleOtaLandingReady()`：修复远端账号时可能只
检查 Session，并不发现酒店，继续使用 discovery 命名会掩盖真实职责。

### 3.2 BrowserManager 边界

BrowserManager 只负责：

- 创建或复用 partition；
- 创建、激活、关闭标签页；
- 注入导入 Cookie；
- 监听 URL 和页面加载；
- 在满足调用方提供的登录后判据时回调。

BrowserManager 不负责：

- 解释酒店绑定 Intent；
- 选择渠道 Probe；
- 创建 Credential 或 OtaAccount；
- 导出并同步 Cookie；
- 创建、更新或删除远端绑定。

Intent 由 main Feature 创建并通过回调闭包带回业务入口。普通浏览不传业务回调，因此不会
意外运行 Probe。

### 3.3 Probe A：完整账号与酒店发现

完整发现用于新登录、本地追加酒店和新增绑定：

```ts
type FullDiscoveryOutcome =
  | Readonly<{ kind: 'LOGIN_REQUIRED' }>
  | Readonly<{
      kind: 'DISCOVERED';
      credential: CredentialObservation | null;
      hotels: readonly OtaHotelObservation[];
    }>
  | Readonly<{
      kind: 'FAILED';
      stage: 'IDENTITY' | 'HOTEL';
      retryable: boolean;
    }>;
```

它可以执行渠道页面操作，例如抖音点击"门店管理"和 CDP 响应捕获，但不得写 repository 或
调用远端 mutation。

### 3.4 Probe B：Session 健康检查

Session 健康检查主要用于远端失效恢复：

```ts
type SessionHealthOutcome =
  | Readonly<{
      kind: 'AUTHENTICATED';
      credential: CredentialObservation | null;
    }>
  | Readonly<{ kind: 'LOGIN_REQUIRED' }>
  | Readonly<{ kind: 'UNKNOWN'; retryable: boolean }>;
```

它只回答当前 partition 是否已登录以及可选的渠道身份，不点击与酒店发现有关的菜单，不创建
本地账号。`UNKNOWN` 不能被当成 `LOGIN_REQUIRED`，否则渠道接口临时失败会错误地要求用户
重新登录。

### 3.5 Cookie 导出不是 Probe

Cookie 导出是确认后的敏感写流程输入，由 main Gateway 执行：

```text
从指定 Credential 的 partition 读取 Cookie
  → 只保留当前渠道 ChannelManifest.cookieDomains 范围
  → 包含该范围内当前完整 Cookie 值和必要属性
  → 确定性排序和大小校验
  → 通过 HTTPS 发送给 server/RMS
```

Cookie 不经过 renderer，不写普通日志，不写本地 SQLite，不读取其他渠道域名。

### 3.6 Intent 与创建权限

```ts
type OtaBrowserIntent =
  | Readonly<{ kind: 'CREATE_LOCAL_CREDENTIAL' }>
  | Readonly<{
      kind: 'DISCOVER_ADDITIONAL_HOTEL';
      credentialId: OtaCredentialId;
    }>
  | Readonly<{
      kind: 'BIND_WITH_EXISTING_CREDENTIAL';
      rmsHotelId: string;
      credentialId: OtaCredentialId;
    }>
  | Readonly<{
      kind: 'BIND_WITH_NEW_CREDENTIAL';
      rmsHotelId: string;
    }>
  | Readonly<{
      kind: 'REPAIR_EXISTING_RMS_ACCOUNT';
      rmsOtaAccountId: string;
      credentialId: OtaCredentialId;
    }>
  | Readonly<{
      kind: 'REPLACE_BINDING_CREDENTIAL';
      rmsOtaAccountId: string;
      credentialSource:
        | Readonly<{ kind: 'EXISTING'; credentialId: OtaCredentialId }>
        | Readonly<{ kind: 'NEW' }>;
    }>
  | Readonly<{ kind: 'BROWSE'; credentialId: OtaCredentialId }>;
```

| Intent | 可创建本地 Credential | 可创建本地 OtaAccount | 可创建远端 RmsOtaAccount |
|---|---:|---:|---:|
| `CREATE_LOCAL_CREDENTIAL` | 是；身份已存在时复用 | 是 | 否 |
| `DISCOVER_ADDITIONAL_HOTEL` | 否 | 是 | 否 |
| `BIND_WITH_EXISTING_CREDENTIAL` | 否 | 用户确认后可补建 | 是 |
| `BIND_WITH_NEW_CREDENTIAL` | 是；身份已存在时复用 | 用户确认后可建 | 是 |
| `REPAIR_EXISTING_RMS_ACCOUNT` | 否 | 默认否 | 绝对否，只能更新指定记录 |
| `REPLACE_BINDING_CREDENTIAL` | 选择 NEW 时可创建 | 目标酒店匹配且确认后可补建 | 绝对否，只能更新指定记录 |
| `BROWSE` | 否 | 否 | 否 |

`CREATE_LOCAL_CREDENTIAL` 对应现状文档已实现的建号链路。`DISCOVER_ADDITIONAL_HOTEL`
对应的"追加酒店"场景，后台的保存逻辑本身已经支持（同一登录身份发现新酒店会正常追加），
但界面入口已经不存在——现状文档第 5 节提到的"发现其他酒店"入口是遗留代码，没有页面在用。
引入这个 Intent 时需要同时决定：是重新做一个入口 UI，还是把这个场景合并进"登录新渠道
账号"的隐式行为里。其余五个 Intent 都是本文新引入、尚未实现的远端绑定流程。这些权限必须
由不同 Handler 和不同远端 API 强制执行，不能只依赖 UI 文案。

## 4. 流程总表

| 编号 | 流程 | 状态 | Partition | Probe | 核心 Handler 结果 |
|---|---|---|---|---|---|
| F0 | 加载酒店管理页 | 未实现 | 不打开 | 无 | 读取远端 Hotel + RmsOtaAccount View |
| F1 | 普通浏览已有 Credential | 已实现 | 复用 | 无 | 只打开页面 |
| F2 | 手动登录建立本地账号 | 已实现 | 新建 | Full Discovery | 创建/归并 Credential，upsert 本地 OtaAccount |
| F3 | Cookie 导入建立本地账号 | 已实现 | 新建并注入 Cookie | Full Discovery | 与 F2 相同 |
| F4 | 已有 Credential 追加 OTA 酒店 | 部分已实现* | 复用 | Full Discovery | 不建 Credential，可建本地 OtaAccount |
| F5 | 使用已有 Credential 新增远端绑定 | 未实现 | 复用 | Full Discovery | 确认酒店、导出 Cookie、创建远端绑定 |
| F6 | 登录新账号并新增远端绑定 | 未实现 | 新建 | Full Discovery | 创建/归并 Credential，确认后创建远端绑定 |
| F7 | 远端失败但本地 Session 有效 | 未实现 | 复用 | Session Health | 直接同步 Cookie，更新指定远端绑定 |
| F8 | 远端失败且本地 Session 需重登 | 未实现 | 复用 | Session Health | 登录成功后同步 Cookie，更新指定远端绑定 |
| F9 | 远端绑定缺少可用本地 Credential | 未实现 | 选择复用或新建 | Session/Full Discovery | 显式替换 Credential，仍更新原远端绑定 |
| F10 | 删除远端绑定 | 未实现 | 不要求打开 | 无 | 远端软删除；本地 Credential/Account 保留 |

\* F4：现状代码里，同一 Credential 复用 partition 探测到新酒店时会正常 upsert（因为
`upsertAccount` 本身按 `channel + otaHotelId` 判定），但目前没有专门的"发现其他酒店"入口 UI
和显式 Intent 区分，是一条隐式路径而非独立流程。F1-F3 的具体行为见现状文档，本文不重复
展开。

## 5. 逐步流程与模型变化

### F0：加载酒店管理页

**目的**：登录后展示当前员工可管理的 `RmsHotel`、每家酒店绑定的 OTA 酒店和状态。

**输入**：当前登录员工身份；renderer 不提交可信的 `orgId`。

**步骤**：

1. renderer 请求酒店管理列表；
2. desktop main 使用已认证 server session 调用共享 contract；
3. server 从当前员工身份解析组织和酒店权限；
4. server/RMS 返回 `RmsHotel[]` 和嵌套或可关联的 `RmsOtaAccountView[]`；
5. renderer 按物理酒店聚合显示渠道、OTA 酒店名称、状态和允许操作；
6. Cookie、密码密文、partition、完整 `credentialExtra` 不进入响应。

**模型变化**：无，只读。

**失败行为**：保留上次画面或显示可重试错误；不得退化为 mock 数据。

### F4：使用已有 Credential 追加本地 OTA 酒店

**Intent**：`DISCOVER_ADDITIONAL_HOTEL { credentialId: C1 }`

**典型场景**：抖音同一登录身份切换公司/`groupId` 后发现另一家酒店。

**前提**：以下步骤 1 描述的"发现其他酒店"入口当前界面上不存在（现状文档第 5 节），实现
这条流程前需要先决定入口放在哪里。

**前置模型**：

```text
C1 已存在，partitionName = P1
C1 下可能已有 A1
```

**步骤**：

1. 用户明确选择"发现其他酒店"；
2. main 按 C1 复用 P1；
3. BrowserManager 打开渠道选择页或首页；
4. 用户完成公司/商户上下文选择；
5. Full Discovery Probe 返回 credential observation 和酒店候选；
6. Handler 验证 Probe 身份仍与 C1 一致；
7. 身份一致时，更新 C1 的身份刷新时间，但不创建新 Credential；
8. 对新酒店创建本地 OtaAccount，对已有酒店只更新发现信息；
9. 刷新本地账号目录。

**模型变化**：

```text
before
  C1 ── A1(group-a, hotel-a)

after
  C1 ── A1(group-a, hotel-a)
     └─ A2(group-b, hotel-b)
```

**冲突行为**：若 P1 中实际登录成另一个渠道身份，不得创建新 Credential 或把 C1 静默改成
另一个人；暂停并提示用户返回原账号，或显式转入"登录新账号"。

**远端变化**：无。

### F5：使用已有 Credential 新增远端酒店绑定

**Intent**：

```text
BIND_WITH_EXISTING_CREDENTIAL
  rmsHotelId  = H1
  credentialId = C1
```

**前置模型示例**：

```text
H1 = 西子酒店
C1 = 已保存的美团登录账号，partition = P1
H1 当前没有目标 OTA 酒店绑定
```

**步骤**：

1. 用户在 H1 的目标渠道点击"新增绑定"；
2. renderer 请求该渠道的本地 Credential 摘要；
3. 用户选择 C1；renderer 不接触 P1；
4. main 创建上述 Intent，并按 C1 打开 P1；
5. 如果页面停在登录页，用户先登录；
6. 到达登录后页面后运行 Full Discovery Probe；
7. Probe 返回 credential observation 和 0..N 个 OTA 酒店候选；
8. Handler 验证实际渠道身份与 C1 一致，不允许创建另一条 Credential；
9. 若只有一个候选，弹出确认组件；若有多个，使用同一组件先选择再确认；
10. 用户确认把候选 O1 绑定到 H1；
11. Handler upsert O1 对应的本地 OtaAccount A1；
12. main 从 P1 导出当前渠道完整 Cookie 快照；
13. main 调用远端"创建绑定"接口，提交 H1、C1.id、O1、bindExtra 和 Cookie；
14. RMS 校验当前员工对 H1 的权限和绑定唯一规则；
15. RMS 创建 R1，加密保存 Cookie，并返回最终状态；
16. renderer 重新读取酒店列表，以远端响应为成功事实。

**成功后的模型值**：

```text
local
  C1 保持同一 id 和 partition P1
  A1 = { credentialId: C1.id, otaHotelId: O1.id, ... }

remote
  R1 = {
    hotelId: H1.id,
    source: C1.channel,
    clientCredentialId: C1.id,
    otaHotelId: O1.id,
    otaHotelName: O1.name,
    bindExtra: O1.bindExtra,
    status: BOUND,
    cookieJarCipher: encrypt(cookieSnapshot)
  }
```

**失败行为**：

- Probe 未找到酒店：不创建远端绑定；
- 用户取消确认：不创建远端绑定，可保留已刷新成功的本地 Credential；
- Cookie 导出失败：不调用远端创建；
- 远端创建失败：本地发现结果可以保留，但页面不得显示"已绑定"；
- 重复请求使用幂等键，不能创建两条远端绑定。

### F6：登录新账号并新增远端酒店绑定

**Intent**：`BIND_WITH_NEW_CREDENTIAL { rmsHotelId: H1 }`

**与 F5 的核心差异**：允许创建或归并本地 Credential。

**步骤**：

1. 用户在 H1 的新增绑定弹窗选择"登录新渠道账号"；
2. main 创建新 pending partition P2；
3. 用户完成登录；
4. Full Discovery Probe 返回 credential observation 和酒店候选；
5. Handler 按渠道身份查找已有 Credential；
6. 身份已存在时复用已有 Credential id 并把权威 partition 更新为 P2；
7. 身份不存在时创建 C2；
8. 进入与 F5 相同的候选选择和确认组件；
9. 用户确认后 upsert 本地 OtaAccount；
10. 从最终 Credential 的权威 partition 导出 Cookie；
11. 创建远端 RmsOtaAccount。

**重要差异**：即使入口叫"新账号"，Probe 发现身份已经存在时也不创建重复 Credential；它只
允许创建，不代表必须创建。

### F7：远端失败，但本地 Session 仍有效

**Intent**：

```text
REPAIR_EXISTING_RMS_ACCOUNT
  rmsOtaAccountId = R1
  credentialId    = C1
```

**前置模型**：

```text
remote R1.status = LOGIN_FAILED 或 LOGIN_EXPIRED
remote R1.clientCredentialId = C1.id
local C1.partitionName = P1
P1 实际仍处于登录状态
```

**步骤**：

1. 用户点击 R1 的"重新登录/修复"；
2. main 按 R1.clientCredentialId 查到 C1；
3. main 复用 P1 打开该渠道首页；
4. Session Health Probe 判断当前 Session 已认证；
5. Repair Handler 不运行酒店发现，不创建 Credential，不创建本地 OtaAccount；
6. main 从 P1 导出当前渠道 Cookie；
7. 调用远端"刷新指定绑定 Cookie"接口，参数必须包含 R1.id；
8. RMS 更新 R1 的 Cookie、`lastLoginAt` 和状态；
9. renderer 刷新远端列表。

**模型变化**：

```text
local
  C1 不变
  A1 不变

remote
  R1.id          不变
  R1.hotelId     不变
  R1.otaHotelId  不变
  R1.status      LOGIN_EXPIRED → BOUND
  R1.lastLoginAt → now
  R1.cookie      → 当前 P1 Cookie
```

远端接口必须是 update/refresh，不得在 R1 不存在时退化成 create。

### F8：远端失败，本地 Session 需要重新登录

**Intent**：与 F7 相同。

**前置模型**：R1 和 C1 映射存在，但 P1 停在登录页。

**步骤**：

1. 按 F7 打开 P1；
2. Session Health Probe 返回 `LOGIN_REQUIRED`；
3. 页面保留在当前标签页，提示用户完成登录；
4. LoginUrlMatcher 命中登录后页面；
5. 再次运行 Session Health Probe，确认已认证并读取可用身份事实；
6. Handler 验证登录身份仍然是 C1；
7. 身份一致时只更新 C1 的身份资料和 `lastRefreshedAt`；
8. 导出 P1 Cookie并更新指定 R1；
9. 不运行酒店发现，不改变 R1 的 OTA 酒店绑定。

**身份冲突**：用户在 P1 登录成另一个渠道身份时，不得覆盖 C1、不得创建新远端账号、不得
把 Cookie 写入 R1。UI 必须提示：

```text
当前登录账号与原绑定不一致
  ├── 返回并登录原账号
  └── 明确选择"更换绑定登录账号" → 转入 F9
```

### F9：远端绑定缺少可用本地 Credential，或明确更换登录账号

**Intent**：`REPLACE_BINDING_CREDENTIAL { rmsOtaAccountId: R1, credentialSource }`

触发条件：

- `R1.clientCredentialId = null`；
- 本机找不到该 Credential；
- 对应 partition 已不可恢复；
- F8 发现用户明确登录了另一个身份并选择更换。

**路径 A：选择已有本地 Credential C2**：

1. UI 列出同渠道 Credential 摘要；
2. 用户选择 C2；
3. main 复用 C2.partition；
4. Session Health Probe 验证身份；
5. 必要时运行 Full Discovery，确认 C2 可以访问 R1.otaHotelId；
6. 若酒店匹配，用户确认更换；
7. 导出 C2 Cookie；
8. 更新同一个 R1 的 `clientCredentialId`、Cookie、状态；
9. 不创建第二条 RmsOtaAccount。

**路径 B：登录新账号**：

1. 创建 pending partition P2；
2. 用户登录；
3. Full Discovery Probe 取得身份和酒店候选；
4. 身份已存在时复用本地 Credential；否则允许创建 C2；
5. 必须从候选中确认 R1 已绑定的 OTA 酒店；
6. 酒店匹配后可补建缺失的本地 OtaAccount；
7. 用户确认更换 Credential；
8. 导出 Cookie并更新原 R1。

**酒店不匹配**：如果新 Credential 不能访问 `R1.otaHotelId`，本流程停止。更换 OTA 酒店属于
"替换绑定酒店"，不能伪装成登录修复，需要单独显式操作和确认。

### F10：删除远端绑定

**输入**：`rmsOtaAccountId = R1` 和版本/`updatedAt`。

**步骤**：

1. 用户在 R1 操作菜单点击"删除绑定"；
2. UI 明确展示物理酒店、渠道和 OTA 酒店；
3. 用户二次确认；
4. server 校验权限和并发版本；
5. RMS 对 R1 软删除或按 RMS 既有生命周期解绑；
6. renderer 刷新酒店列表。

**模型变化**：

```text
remote
  R1.deletedAt = now 或进入远端定义的解绑状态

local
  C1 保留
  C1.partition 保留
  A1 保留
```

解绑不等于删除本机登录态。删除 Credential/partition 是另一类高风险生命周期操作，不在酒店
绑定删除流程内联执行。

## 6. 候选酒店选择组件

Full Discovery 统一返回 0..N 个 `OtaHotelObservation`：

```ts
type OtaHotelObservation = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
}>;
```

统一组件行为：

| 候选数 | UI 行为 |
|---:|---|
| 0 | 显示未探测到酒店，不允许绑定 |
| 1 | 展示该酒店并要求用户确认，不自动绑定 |
| N | 列表选择一个候选，再进入同一确认动作 |

美团当前已经能返回多酒店；携程代码存在 multiple 分支但没有完成确认 UI；抖音当前只返回
当前 `groupId` 对应的一家酒店。未来抖音返回多酒店时只更换 Probe 实现，不改变 Handler 和
选择组件 contract。

候选组件可以复用交互和视觉，但不能直接复用当前暴露 `partitionName` 的旧账号组件类型。

## 7. Handler 的强制不变量

1. Probe 不写本地 repository，不调用远端 mutation；
2. `BIND_WITH_EXISTING_CREDENTIAL` 不创建 Credential；
3. `DISCOVER_ADDITIONAL_HOTEL` 不创建 Credential；
4. `REPAIR_EXISTING_RMS_ACCOUNT` 不创建远端账号；
5. `REPLACE_BINDING_CREDENTIAL` 仍更新原远端账号，不创建第二条绑定；
6. Full Discovery 发现身份冲突时暂停，不自动覆盖选中的 Credential；
7. 只有新增绑定 Handler 可以调用远端 create；
8. 只有用户确认后才能把候选 OTA 酒店写成正式远端绑定；
9. 普通浏览不触发 Probe；
10. Probe 或远端失败不删除已有本地 Credential/OtaAccount，不自动解绑远端记录。

## 8. Contract 与安全边界

### 8.1 调用方向

```text
renderer
  → preload 受控 IPC
  → desktop main Feature / Handler
  → packages/api 共享 tRPC contract
  → apps/server
  → RMS 授权业务 API
```

`apps/server` 对 RMS MySQL 保持只读，绑定创建、Cookie 更新和解绑必须走 RMS 领域 API，不得由
本项目 server 直接写 RMS 表。

### 8.2 远端接口必须分开

不能使用一个模糊的 upsert 同时处理新增和修复。至少需要语义独立的能力：

```text
hotelManagement.list
hotelBinding.create
hotelBinding.refreshCredential
hotelBinding.replaceCredential
hotelBinding.delete
```

- `create` 允许创建远端绑定；
- `refreshCredential` 必须要求已有 `rmsOtaAccountId`，找不到即失败；
- `replaceCredential` 更新原记录的 Credential 关联和 Cookie；
- `delete` 使用远端软删除/解绑语义；
- 所有 mutation 由 server 从认证身份推导 org 和权限，不信任 renderer 提交的 `orgId`。

### 8.3 Cookie 快照

"同步当前全部 Cookie"的准确含义是：指定 Credential partition 中，属于当前渠道域名白名单
的全部当前 Cookie；不是全应用、全浏览器或其他渠道 Cookie。

快照至少保留 RMS worker 复用所需的：

```text
name, value, domain, path, expirationDate, httpOnly, secure, sameSite
```

实现前需要验证 RMS worker 当前接受的序列化格式。格式适配放在 server/RMS gateway，不让
renderer 或酒店选择组件理解 Cookie。

## 9. 并发、取消与失败

- 每次新增绑定或修复生成 operationId；同一 operation 重试使用同一幂等键；
- BrowserManager 的"一个 tab 登录后回调一次"只负责 tab 级防重；
- Handler 负责 operation 级防重，不能继续使用现状代码里进程生命周期的防重复触发机制
  （见现状文档第 3 节）；
- 用户关闭标签页时 operation 进入 cancelled，不能在后台继续创建远端绑定；
- 候选弹窗等待期间不持有数据库事务；
- 远端 mutation 使用版本或 `updatedAt` 做并发校验；
- 本地成功、远端失败时保留本地发现事实，但远端仍是未绑定/原状态；
- 日志只记录 operationId、渠道、结果种类和候选数量，不记录 Cookie、手机号、账号原始资料。

## 10. 对当前代码的目标调整

### 10.1 拆分 `DiscoverAndCreate`

当前：

```text
DiscoverAndCreate.trigger
  = 渠道选择 + Probe + Credential 归并 + OtaAccount upsert
```

目标：

```text
OtaDiscoveryProbe
  = 按渠道取得 credential/hotel observation，不落库

handleOtaLandingReady
  = 按 Intent 选择 Probe 和 Handler

CreateLocalCredentialHandler
DiscoverAdditionalHotelHandler
PrepareHotelBindingHandler
RepairRmsOtaAccountHandler
ReplaceBindingCredentialHandler
```

不需要建立全局 `ChannelAdapter` 或统一大接口。`handleOtaLandingReady` 可以用普通、穷尽的
`switch` 分流；各渠道继续使用显式函数和本渠道结果解析。

### 10.2 调整触发参数

当前：

```ts
triggerDiscovery(partitionName, channel, landingUrl, webContents)
```

目标至少携带：

```ts
handleOtaLandingReady({
  operationId,
  intent,
  channel,
  partitionName,
  landingUrl,
  webContents,
});
```

`partitionName` 和 `webContents` 仍只在 main 内部，不进入 renderer event。

### 10.3 组件边界

```text
src/main/features/
├── ota-credential/
│   ├── create-local-credential.ts
│   └── discover-additional-hotel.ts
├── hotel-binding/
│   ├── prepare-binding.ts
│   ├── repair-rms-account.ts
│   ├── replace-binding-credential.ts
│   └── cookie-snapshot-exporter.ts
└── ota-operation/
    └── handle-landing-ready.ts

src/main/ota/<channel>/
├── session-health.ts
├── discover-identity.ts
├── discover-hotels.ts
└── login-url-matcher.ts
```

这是职责方向，不要求一次性机械搬目录。现有携程、美团、抖音 discovery 可以先整体作为
Full Discovery Probe 复用，再按实际重复和单独调用需求拆分身份、健康检查与酒店发现函数。

## 11. 实施顺序建议

本文只梳理流程。进入实现时应建立新的 OpenSpec 三件套，并按以下顺序降低跨模块风险：

1. 把当前本地建号链路拆成 Probe + 当前行为 Handler，保持 F2/F3 行为不变；
2. 引入 Intent 和 `handleOtaLandingReady`，完成 F1/F4 的明确分流；
3. 建立酒店列表只读 contract，替换酒店管理页 mock；
4. 实现 F5/F6 新增绑定、候选确认和 Cookie 同步；
5. 实现 F7/F8 远端失效恢复；
6. 实现 F9 Credential 映射缺失与明确更换；
7. 实现 F10 删除绑定；
8. 抖音出现多酒店账号后，只扩展 Probe，复用既有候选组件和 Handler。

## 12. 仍需确认但不阻塞整体流程的事实

- 携程稳定的渠道登录身份如何取得，何时不再用酒店 ID 代替；
- RMS 用于关联本地 Credential 的字段名和物理存储方式；
- RMS worker Cookie jar 的精确序列化格式；
- `(RmsHotel, channel)` 是否严格只允许一个活跃绑定，还是允许同渠道多 OTA 酒店；
- 本地 `(channel, otaHotelId)` 唯一键是否需要升级为包含 `credentialId` 或渠道 stable key；
- 抖音首页未来能否一次枚举多个 `groupId`/酒店。

这些问题会影响字段或渠道实现，但不改变本文的核心分层：浏览器到达登录后页面后，先按
Intent 选择 Probe，再由对应 Handler 决定是否创建、更新、确认或同步。
