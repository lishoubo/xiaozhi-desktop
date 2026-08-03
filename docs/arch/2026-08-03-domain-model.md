# 核心领域模型（定稿）

日期：2026-08-03
状态：**定稿**。原为《最终架构方案》第四部分，因主文档过长（774 行）拆出独立维护
术语以 `2026-08-03-glossary-and-orderlaile-mapping.md` 为准
配套：`2026-08-03-final-architecture.md`（目录结构、框架剥离、执行顺序）

以下是需要**第一天就固化**的类型。判断标准：**将来补不回来的**。

---

## 1. 标识：branded type

```ts
// domain/identity.ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type ChannelId     = Brand<string, 'ChannelId'>;
export type OtaAccountId  = Brand<string, 'OtaAccountId'>;
export type OtaHotelId    = Brand<string, 'OtaHotelId'>;
export type AppUserId     = Brand<string, 'AppUserId'>;
export type TabId         = Brand<string, 'TabId'>;
```

用 `unique symbol` 而非字符串字面量做 brand —— 别处写不出 `{ __brand: 'ChannelId' }` 来伪造。

**`AppUserId` 和 `OtaAccountId` 必须是两个类型**：这是「两套账号体系不绑定」在类型层面的落实。命名分开给人看，branded type 给编译器看，两者都要有。

### 1.0 `OtaHotelId`：渠道侧的门店 ID（`HotelId` 暂不引入）

一家酒店在不同渠道各有一个门店 ID，它们互不相同：

```text
银际酒店
  ├─ 携程侧门店 ID  ctrip-88123     ← OtaHotelId
  ├─ 美团侧门店 ID  mt-45678        ← OtaHotelId
  └─ 抖音侧门店 ID  dy-99001        ← OtaHotelId
```

**`HotelId`（我们/rms 侧统一的门店实体）现在不引入。** rms 接口未接、本地无门店数据源，现在建这个字段是凭空造概念 —— 等 rms 通了、真有门店权威了再加，那时它的作用是"把三个 `OtaHotelId` 归并成同一家酒店"。

在那之前，`OtaHotelId` 就是我们能拿到的最细门店粒度，**它足以支撑单店的改价/改库存操作**（因为渠道接口要的本来就是渠道自己的 ID）。

> 术语纪律：凡是渠道侧的东西一律 `Ota*` 前缀。`OtaHotelId` 与 `OtaAccountId` 成对，一眼看出是渠道侧标识，不会和将来的 `HotelId` 混。

### 1.1 `ChannelId` 到底是什么

**它是渠道标识，不是账号标识，也不是站点域名。** 取值就是 `ctrip` / `meituan` / `fliggy` / `douyin` 这一类：

```ts
toChannelId('ctrip')     // ✅ 渠道
toChannelId('ctrip-1')   // ❌ 那是 OtaAccountId
toChannelId('ctrip.com') // ❌ 那是 cookieDomains 里的条目
```

三条约束：

1. **一律小写**。它要拼进 partition 字符串和磁盘路径，大小写混用会在 macOS（大小写不敏感）通过、在 Linux 失败。
2. **字符集限制为 `[a-z0-9-]`**，理由同上 —— 见 §1.3 的校验要求。
3. **权威在 channel manifest**（`resources/channels/*.json` 的文件名即 id），不在代码里硬编码枚举。渠道是高频新增的，写成 TS 枚举意味着加一个渠道要发一次版。

> 现状：`shared/browser.ts` 的 `browserCreateInputSchema.channelId` 目前是无约束的 `nonEmptyStringSchema`，任意字符串都能传进来。收敛成 `ChannelId` 是第 2 步的内容。

### 1.2 定位一个浏览器上下文：查 `OtaAccount.partitionName`，不再有组合键

**已废弃 `BrowserContextKey`**（曾定义为 `{ environment, channel, otaAccountId }`，用于拼出 partition 名字）。废弃原因见 cookie 导入登录建号方案（`openspec/changes/cookie-login-account-discovery/design.md` 决策 3）：

> partition 名字改为 `environment:channel:<短id>`，短id 在**创建登录标签页那一刻**随机生成——此时账号还不存在（探测尚未发生），无法用 `(environment, channel, otaAccountId)` 三元组反推出 partition 名字。这条路径从"拼公式"变成了"查记录"。

新规则：

- **已有账号，要用它的登录态** → 查 `OtaAccountRepository`，读出这条记录的 `partitionName`（§2.0），直接 `session.fromPartition(partitionName)`
- **还没有账号，要开一个新的登录标签页** → `environment` + `channel` + 本地随机生成的短id 现拼现用，不经过任何"业务身份 → partition"的转换函数，因为业务身份还不存在

**partition 是业务隔离单位**这条原则不变，只是"隔离单位怎么命名"和"怎么找到它"分成了两条路：命名只在创建时刻发生一次、永不改变（决策 3）；查找永远经过 `OtaAccount.partitionName` 这个指针，不再有可以从三元组算出来的公式。

与订单来了实测的差异也随之出现：它的 15 个 partition 是 `ddlldesk:prod:<渠道>:<账号>` 这种"可反推"结构；我们改成不可反推的短id，是因为订单来了创建 partition 时账号已知，我们不是。

### 1.3 转换函数必须校验

```ts
// 唯一允许 as 的地方
export function toChannelId(raw: string): ChannelId;
export function toOtaAccountId(raw: string): OtaAccountId;
```

**函数体不能只是 `return raw as ChannelId`。** 那样 branded type 只防住了「手滑传错类型」，防不住「传了空串」。

这条在别处会是洁癖，在这里是硬需求：`BrowserContextKey` 会被拼进 partition 字符串，而 **partition 一旦生成就永远不删**（§4 升级规则第 3 条）。一个未校验的 `toOtaAccountId('')` 会在用户磁盘上产生一个永久的坏目录。

要求：非空、限定字符集 `[a-z0-9-]`、长度上限；失败抛 `DomainError`。另配一个 `parseChannelId(raw): Result<ChannelId>` 处理不可信输入（读 manifest JSON、IPC 入参）。

---

## 2. 八个核心模型

### 2.0 `OtaAccount` —— partition 名字本身就是权威指针

这是理解整个模型的入口，其余模型都挂在它上面。

```ts
/** 一个可操作的渠道门店账号。 */
export type OtaAccount = Readonly<{
  id:            OtaAccountId;
  channel:       ChannelId;
  otaHotelId:    OtaHotelId;      // ★ 单个。渠道侧门店 ID
  displayName:   string | null;   // 渠道侧门店名，探测到再填
  partitionName: string;          // 用哪份登录态去操作——直接指向 partition
}>;
```

**一个账号只对应一家渠道门店。** 这不是简化，是刻意的建模选择：

```text
抖音一份登录态（后台管三家店，一个 partition）
  ├→ OtaAccount#1  otaHotelId = dy-111
  ├→ OtaAccount#2  otaHotelId = dy-222
  └→ OtaAccount#3  otaHotelId = dy-333       ← 三个账号，共享一个 partitionName

携程一份登录态（只管一家店）
  └→ OtaAccount#4  otaHotelId = ctrip-88123  ← 一个账号
```

**多对多被拆成了多个一对一**，因此不需要 `AccountHotelBinding` 这类关联实体。收益有三个：

1. `HotelExecutionScope` 天然是单店的 —— 不需要"从账号的门店列表里选一个"这个额外动作，跨店 fan-out 由模型结构直接堵死，而非靠约定
2. 每个账号的登录态、操作记录、审计都有独立主体
3. 携程（一店）与抖音（多店）用同一套模型表达，无需分支

**`OtaAccount` 不承载凭证内容**，只持 `partitionName` 这个指针。要使用这个账号的登录态，永远是 `session.fromPartition(partitionName)`；cookie 的值、刷新、过期完全交给 Electron 的 session 机制，数据库不存储、不同步任何 cookie 内容。所以「重新导入 cookie」或「重新登录」实质是把 `partitionName` 指向一个新 partition，旧 partition 目录随之清理，账号本身（`id`/`otaHotelId`/`displayName`）不受影响。

> **不设 `OtaCredential` 间接层**：曾考虑让 `OtaAccount` 持有 `credentialId`、经一层 `OtaCredential` 记录再指向 partition，这样理论上能容纳"登录来源""登录健康状态"等元数据。但当前登录状态本身就是"partition 是否能正常发请求"这一个事实，没有需要独立持久化的登录态历史；多一层间接只会让"改哪个字段才是真的换了登录态"变得不直观。等真的出现"同一账号需要追踪多份历史登录记录"这类需求时再引入，属于"确定会有第二种需要"才值得抽象的场景，现在不满足。

### 2.1 `ChannelManifest` —— 渠道的能力与策略声明

```ts
export type ChannelManifest = {
  id: ChannelId;
  displayName: string;
  entryPoints: readonly { id: EntryPointId; url: string; label: string }[];
  allowedOrigins: readonly string[];        // 导航白名单
  cookieDomains: readonly string[];         // cookie 导入的作用域
  loginDetection: LoginDetectionStrategy;
  schemaVersion: number;
};
```

**权威在 main，不在 renderer。** renderer 只拿到 `{ id, displayName, entryPoints: [{id, label}] }` —— **拿不到 URL**。这是 P0-2 的根治：renderer 没有能力指定任意 URL。

存 `resources/channels/*.json`（不进 asar），因为渠道后台改版是高频事件，将来要能从 rms 下发。

> ⚠ **安全前置**：`allowedOrigins` 是导航白名单，放在 asar 外意味着它是一个用户可编辑的 JSON 文件 —— 类型层面根治了 P0-2，文件层面又开了口。manifest 必须签名校验，或把 `allowedOrigins` 这类安全字段留在 asar 内、只让展示字段热更。**这条在 manifest 落地前必须解决。**

`cookieDomains` 同时是 cookie 导入的作用域 —— 见 §5 的现存缺陷。

### 2.2 `LoginState` —— 三元组，不用裸 bool

```ts
export type LoginState = Readonly<{
  state: 'logged_in' | 'logged_out' | 'unknown' | 'expired';
  source: 'cookie-probe' | 'page-marker' | 'api-probe' | 'user-declared';
  updatedAt: string;
}>;
```

照抄订单来了（它这里做对了）。**没有 `source` 和 `updatedAt` 的登录态是无法运营的** —— 你不知道这个 `false` 是"刚探测过确实掉线"还是"三天前探测的，现在不知道"。

（可后补，不属于「补不回来」：`expired` / `unknown` 状态下运营需要知道下次何时重探，届时加 `nextProbeAt`。）

### 2.3 `ChannelObservation` —— 采集与权威的分界线

```ts
export type ChannelObservation = {
  id: ObservationId;
  observedAt: string;
  channel: ChannelId;
  otaAccountId: OtaAccountId;
  otaHotelId: OtaHotelId | null;        // 可能抓不到，允许 null
  kind: 'order' | 'inventory' | 'rate' | 'review' | 'message';
  payload: unknown;                     // 渠道原始形状，不强行归一
  extractorVersion: string;             // ★ 哪一版抓取逻辑抓的
  evidence: readonly EvidenceRef[];     // 截图/HTML/网络日志
  quality: DataQuality;
};

export type DataQuality = 'complete' | 'partial' | 'suspect';
```

**桌面端抓到的东西叫 `Observation`（观察），不叫 `Order`（订单）。** 归一和去重是 rms 的职责。

`quality` 是这个模型里最重要的字段：**允许上报"我抓得不完整"，比强行编造一个完整结果安全得多。** 抓取天然会失败、会抓一半，没有这个字段的话，`partial` 的数据会被当成 `complete` 用在库存计算里。

`extractorVersion` 是第二重要的：`payload` 是 `unknown`，而渠道后台改版是高频事件。没有这个字段，rms 拿到历史 observation 时无法知道它是哪一版逻辑抓的、该按哪个形状解析。**历史数据补不回这个字段。**

### 2.4 `InventoryImpact` —— 库存占用是显式字段，不是推导结果

```ts
export type InventoryImpact =
  | 'holds'        // 占用房量
  | 'released'     // 已释放
  | 'suspended';   // 挂起（订单盒子）—— 不占用，但订单仍存在
```

**这是最容易漏、且将来补不回来的一个。**

订单状态 × 库存占用 × 营收统计是**三个正交维度**：

```text
正常单     → holds     → 计营收
订单盒子   → suspended → 不计营收 → 但要同步房态给渠道
已取消     → released  → 不计营收 → 释放房量
```

关键在"订单盒子"：把一个订单挪进盒子，会让房间在 OTA 上重新可售 —— 这不是"标记一下待人工看"，**这是一次真实的库存写操作**。如果用"从订单状态推导库存"的写法，一个抓取冲突的订单进了 review queue 之后，房态到底算占还是不占？这个问题答不了，后面所有库存计算都是错的。

即使第一版不做同步回渠道，这个字段也必须存在。

### 2.5 `ProposedAction` —— 三段式写在类型里

```ts
export interface OtaActionGateway {
  proposeAction(action: ProposedAction): Promise<ActionProposal>;
  confirmAction(proposalId: ProposalId, idempotencyKey: string): Promise<ActionExecution>;
  verifyAction(executionId: ExecutionId): Promise<ActionVerification>;
}
```

**接口上没有"直接执行"这个方法** —— 想绕过三段式都写不出来。

三条硬约束：

1. `confirmAction` 的 `idempotencyKey` **不是可选参数**。调用方必须显式想清楚"这次执行的唯一标识是什么"，而不是让传输层偷偷重试。
2. **实现里禁止任何自动重试。** 网络失败 → 状态置 `unknown` → 走 `verifyAction` 查真实结果 → 由人决定要不要重做。**永远不要因为"没收到响应"就重发一次改价。**
3. **`OtaActionGateway` 与 `OtaBizDataGateway` 必须是两个接口。** 推事实可重试，推指令重试会改价两遍。塞进一个 Gateway，后来的人很容易顺手给改价也加上"失败自动重试" —— 这是能造成真实经济损失的错误。分成两个接口，让这个错误在类型层面就写不出来。

### 2.6 `HotelExecutionScope` —— 一次执行的作用域，也是跨店 fan-out 的防线

```ts
// domain/execution-scope.ts
export type HotelExecutionScope = Readonly<{
  appUserId:    AppUserId;      // 审计链条起点：approved_by 要能追到人
  channel:      ChannelId;      // 哪个渠道（美团 / 抖音 / 携程）
  otaAccountId: OtaAccountId;   // ⚠ 单数。一个账号 = 一家渠道门店（§2.0）
  otaHotelId:   OtaHotelId;     // 冗余自账号，让审计自包含
  environment:  'prod' | 'dev';
}>;
```

**这个类型是「不做跨店 fan-out」这条产品决策的载体。** 防线现在由**模型结构**保证，而非单靠字段注释：`OtaAccount` 与渠道门店是一对一（§2.0），所以 scope 持有单个 `otaAccountId` 就等于锁定了单家门店 —— 想 fan-out 到三家店，必须显式开三个 scope、三个 session，每个都留痕。

> 这比早期版本（scope 里放 `hotelId: HotelId`，靠注释提醒"别改成数组"）更牢固：那时账号可能管多店，"单店"是约定；现在账号本身就是单店的，"单店"是结构。

**`otaHotelId` 为何冗余**：它可由 `otaAccountId` 查出，但审计要求自包含 —— 出事故时不该为了回答"改的哪家店"去访问数据库。同理 `channel` 也显式存在，不靠 `otaAccountId` 反查。

要拿到这次执行该用哪个浏览器 session，从 `scope.otaAccountId` 查 `OtaAccountRepository` 取出 `partitionName`（§1.2 已废弃从 scope 字段直接拼出 partition 名字的投影函数）。

命名上刻意不叫 `ExecutionContext`：该词在 TS 生态里被 AsyncLocalStorage、各类中间件用滥，搜代码噪音大；且 `Context` 可以装任意东西，而 `Scope` 天然读作"边界"，往里塞数组会别扭。也不叫 `OtaContext` —— 它有字段（`appUserId`、`environment`）与渠道无关，且 `Ota*` 前缀在本项目已固定表示"属于渠道侧"。

两条配套约束：

1. **scope 在 session 级固定，不可变。** `startSession(scope)` 之后不允许中途换店换账号。要换 = 开新 session。这样审计时"这次会话动的是哪个店"有唯一答案。
2. **`agent_session` 表必须存下完整 scope**（`app_user_id` / `channel` / `ota_account_id` / `ota_hotel_id` / `environment`），由 `session_id` 关联。§6 的 `agent_tool_call` 表里没有这些字段，否则出了事故只知道"改了价"，不知道"改的谁家的价"。

### 2.7 `AgentEvent` —— renderer 只认归一化事件

```ts
// domain/agent-event.ts —— 永远不认 codex 的原始事件
export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-call'; callId: string; tool: string; risk: RiskLevel; args: unknown }
  | { kind: 'tool-result'; callId: string; summary: string }
  | { kind: 'approval-required'; callId: string; reason: string }
  | { kind: 'tool-call-settled'; callId: string; outcome: 'executed' | 'denied' | 'failed' }
  | { kind: 'error'; error: DomainError }
  | { kind: 'done'; reason: 'completed' | 'interrupted' | 'failed' };
```

`tool-call-settled` 是必需的：有了 `approval-required` 却没有对应的终结事件，用户拒绝审批后 renderer 无从知道这个 `callId` 已经结束，只能靠 `done` 或超时推断。这个事件一旦渗进 renderer 再补就要动 UI —— 现在 harness 尚未接入，是零成本窗口。

---

## 3. 五个 Gateway（ports）

```text
AppAccountGateway       app 账号、token、门店权限
OtaAccountSyncGateway   渠道登录态 → rms  ★最先能接（无副作用，验证通路成本最低）
OtaBizDataGateway       抓到的事实 → rms（推事实，可重试）
OtaActionGateway        改价/改库存 → rms（推指令，恰好一次，禁自动重试）
ModelGateway            模型端点、计费、审计、脱敏
```

**Gateway 不是"分组"，是"可替换的实现点"。** 判断一个 Gateway 该不该独立，问题永远是"它和隔壁那个会不会同进同退"，不是"它们概念上是不是一类"。②③④ 分家的理由是落地节奏不同（② 今天就能接，④ 最晚），以及 ③④ 的失败语义相反。

三条 token 硬约束（现在就要立）：

- `SecretToken` 是 opaque 类型，`toString()` 返回 `'[REDACTED]'`
- token **只在 main 持有**，preload 不暴露，renderer 拿不到
- 给 AI 用时通过**环境变量注入 MCP 进程**，不进 prompt、不落 rollout

`ModelGateway` 配一条发布门禁：**`LocalModelGateway` 在 `app.isPackaged === true` 时直接抛错**，让它不可能被打包进正式版。否则用户 OTA 订单数据直接出境到模型厂商，无审计无脱敏。

---

## 4. 五个独立版本号

```ts
// domain/versioning.ts —— 只放跨框架仍有意义的
export const DOMAIN_SCHEMA_VERSIONS = {
  channelManifest: 1,
  agentSession:    1,
} as const;

// main/core/storage-versions.ts —— adapter 实现细节
export const STORAGE_VERSIONS = {
  appDatabase:     2,   // 已有
  browserState:    1,   // 要建
  partitionLayout: 1,   // ★ 一旦发出去就固化在用户磁盘上
} as const;
```

**为什么分成两处**：`appDatabase` 是 SQLite 的 schema 版本，`partitionLayout` 是 Electron partition 的目录布局 —— 换掉 SQLite 或 Electron，这两个版本号直接消失。按「换个数据库要改吗 → 是 → `main/`」的判定规则，它们不属于 domain。留在 domain 里会让「零框架依赖」这条约束在语义上先破口。

`partitionLayout` 最特殊：partition 命名发布后就固化在用户磁盘上了。将来要改名（比如加 mapping 层），必须知道当前用户是哪个布局版本才能决定要不要迁移。**这就是"实在不行后面可以加 mapping"所需要的触发器。**

配套四条升级规则：

1. **挡住降级** —— `dbVersion > STORAGE_VERSIONS.appDatabase` 直接抛错。老版本打开新版本的库会产生**静默的错误行为**，比崩溃更糟。
2. **迁移前备份，失败回滚** —— 现有 `migrate()` 是事务包裹的，单条迁移原子；但**多条迁移之间不是**，迁移 3 成功、4 失败就停在中间态。
3. **partition 永远不删，只标记 legacy** —— 磁盘空间最便宜，OTA 登录态最贵。
4. **已发布的 migration 文件视为不可变** —— version 1、2 一旦跑在任何用户机器上，改动它会造成「新老用户 schema 不一致，但 `schema_migrations` 表都记为 applied」的静默分裂。要改只能追加新 migration。

---

## 5. 存储：三类数据分开

```text
<userData>/
  app.sqlite      ← ①配置 ②状态：小、迁移频繁、每次迁移前备份
  facts.sqlite    ← ③事实与审计：大、只增、按时间清理
  artifacts/      ← 截图/HTML/trace：文件系统，不进数据库
    <yyyy-mm>/<observationId>/{screenshot.png, snapshot.html, network.jsonl}
```

现在混一个库没关系（数据少），但 observation 一上来（每天几千条），③ 会淹没 ①②，备份和迁移都会变慢。**分库的成本现在几乎为零**（一个 `openDatabase` 变两个），以后再分要动所有 repository。

artifacts 配套：保留期默认 30 天、脱敏后才能导出、总容量上限（超了删最旧）。桌面 app 把用户磁盘塞满是真实会发生的事故。

### migration 的组织

```text
src/main/data/
├── app-database.ts
├── facts-database.ts
├── migration/
│   ├── runner.ts          # 降级检测 + 备份 + 回滚（两个库共用）
│   ├── types.ts           # Migration 接口
│   ├── app/               # 001-create-calendar.ts, 002-add-notes.ts …
│   └── facts/
├── artifact-store.ts
└── repositories/
```

**migration 放在 `src/` 内而非仓库根目录**，因为这是桌面应用不是服务端：migration 要在用户机器上运行，就必须进 Vite 的 main bundle。放外面意味着要么手配 `extraResource`，要么写 raw SQL 文件 + `?raw` import —— 为了「看起来像后端项目」付出打包复杂度，不值得。

`runner.ts` 收进 `migration/` 子目录而非与 `app-database.ts` 平级：它是**两个库共用的机制**，与具体某个库的迁移脚本不在一个抽象层级。

---

## 6. 审计表

```sql
CREATE TABLE agent_tool_call (
  session_id     TEXT NOT NULL REFERENCES agent_session(id),
  call_id        TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  risk_level     TEXT NOT NULL,
  args_redacted  TEXT NOT NULL,   -- 脱敏后
  approved_by    TEXT,            -- null = 自动执行
  result_summary TEXT,
  at             TEXT NOT NULL,
  PRIMARY KEY (session_id, call_id)
);
```

`agent_tool_call` 比 `agent_message` 更重要 —— **它是审计的载体**。出了问题要能回答"谁在什么时候用什么参数改了什么"，光有对话内容答不了。

**"对哪个店做的"由 `agent_session` 回答**：本表刻意不冗余 `hotel_id`，而是要求 `agent_session` 存下完整的 `HotelExecutionScope`（§2.6 约束 2）。scope 在 session 级不可变，所以一次 join 就有唯一答案。

---

## 7. 现存缺陷（已在代码中，待修）

以下不是设计选择，是当前实现与本文档的偏差。按严重度排列：

### 🔴 D1：所有 OTA 账号共用一个 browser session

```ts
// src/main/browser/browser-manager.ts:65
this.browserSession = session.fromPartition('persist:hotel-butler-browser');
```

导入的 cookie 全部 `set` 到这一个 session（`browser-handlers.ts:136`）。后果：

- 同渠道两个账号的 cookie **互相覆盖**，同名 cookie 后写的赢
- 导入某浏览器的携程 cookie 时，会连带覆盖已登录的美团 cookie
- 用户没有"当前是哪个账号"的概念

**这不是未来的隐患，是现在就会丢登录态的 bug。** 修法即 `BrowserContextKey` + `SessionFactory`（每个 `(environment, channel, otaAccountId)` 一个 partition，与订单来了实测结构一致）。

迁移策略：旧 partition 保留并标记 legacy，**不自动复制** —— 你不知道那里面是谁的登录态。代价是现有登录态需要重新导入一次。

### 🟠 D2：cookie 导入无视渠道，一次读走 13 个域

`src/main/browser/cookie-import.ts` 硬编码了 13 个域名（含 booking / agoda / expedia / xiaohongshu / douyin / taobao）。用户想导入携程，实际把小红书、抖音、淘宝的 cookie 全导了进来。

这既是隐私问题（读取了无关站点的登录凭证），也是 P0-2 的一部分。正解是按 `ChannelManifest.cookieDomains` 过滤 —— 导入哪个渠道就只读哪个渠道的域。

### 🟡 D3：登录态只存在 renderer

`src/renderer/auth.ts` 是 mock（写死手机号验证码），session 存 `localStorage`。mock 本身是刻意的占位（rms 未接），不算缺陷；**但 session 只在 renderer 意味着 main 侧不知道谁登录了**，将来接审计时 `approved_by` / `appUserId` 拿不到。

### 🟡 D4：migration 基础设施未按 §5 落地

§5 规定 `main/data/migration/{app,facts}/` 拆文件、独立 `runner.ts` 做降级检测 + 备份 + 回滚、双库分离。现状（含本次 cookie 导入建号方案新增的 `ota_account` 表）仍是所有 migration 堆在 `application-database.ts` 一个数组里，只有唯一的 `app.sqlite`，没有降级检测、没有备份回滚。

本次新增 `ota_account` 表（migration version 3）时**刻意维持现状**，未顺带重构——这块是纯基础设施改动，和 cookie 导入建号这个功能分支无直接关系，混在一起会让 diff 难审查（见 CLAUDE.md"保持既有行为，不顺手重构"）。重构本身待排期，触发时机建议是 observation 类数据即将上线（届时 facts.sqlite 分库、降级检测都会成为真实需求，而不是预防性工程）。

---

## 8. 验证说明

本文为设计文档，第 1–6 节未修改代码。

§7 的三条缺陷为**代码实读结论**（2026-08-03）：
- D1：`browser-manager.ts:65`、`browser-handlers.ts:136` 实读确认
- D2：`cookie-import.ts:1-15` 实读确认域名清单
- D3：`auth.ts:3-21` 实读确认 mock 与 localStorage

以下**未验证**，落地时需实测：
- 所有代码片段为设计示意，未编译
- `partition` 字符串的字符集限制未在 Electron 实测（§1.3 的校验要求由此推导）
- manifest 签名校验方案未选型（§2.1 的安全前置）
