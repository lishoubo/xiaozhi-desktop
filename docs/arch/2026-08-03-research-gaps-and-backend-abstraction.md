# 调研文档复查：遗漏的核心设计 + 自建后端的抽象边界

日期：2026-08-03
输入：`docs/research/` 13 篇 + `docs/ORDERLAILE_ARCHITECTURE_REVIEW.md` + `docs/arch/2026-08-03-harness-and-architecture-review.md`
目的：① 找出调研覆盖到但没被提炼成设计决策的东西 ② 为自建后端划出前期抽象边界

> 术语以 `2026-08-03-glossary-and-orderlaile-mapping.md` 为准。

---

## 第一部分：调研文档已覆盖但没进设计的核心点

调研本身相当扎实，13 篇里没有明显的"没查到"。真正的问题是**有些查到的东西停在"观察记录"层面，没有变成架构决策**。以下 8 条是我认为漏掉的。

### 遗漏 1：订单盒子 —— 异常订单的库存语义（最重要的一条）

`orderlaile-competitor-order-flow.md` 记录了订单来了的"订单盒子"：

> 订单移入订单盒子后**不占库存**，订单金额**不统计**，可用于冲突订单、刷单、保留单等。移入后房量、房态变化会**同步到已直连渠道**。

调研文档把它列为"可借鉴点 4"，建议做个 `review_queue`。但**这个建议低估了它**。订单盒子不是一个待办列表，它是一个**库存状态机的合法态**：

```text
订单状态 × 库存占用 × 营收统计  是三个正交维度

正常单    → 占库存 → 计营收
订单盒子  → 不占库存 → 不计营收 → 但要同步房态给渠道
已取消    → 不占库存 → 不计营收 → 释放房量
```

关键在最后那句"移入后房量变化会同步到渠道"。也就是说，**把一个订单挪进盒子，是一个会对外产生副作用的操作**——它会让房间在 OTA 上重新可售。这不是"标记一下待人工看"，这是一次真实的库存写操作。

对我们的影响：如果我们的 `review_queue` 只是个列表，那么一个抓取失败/冲突的订单进了队列之后，**房态到底算占还是不占？** 这个问题不回答，后面所有库存计算都是错的。

**建议**：第一版就把"订单的库存占用状态"建成显式字段，而不是从订单状态推导：

```ts
type InventoryImpact =
  | 'holds'        // 占用房量
  | 'released'     // 已释放
  | 'suspended';   // 挂起（订单盒子）——不占用，但订单仍存在
```

即使第一版不做同步回渠道，这个字段也必须存在，否则将来补不回来。

### 遗漏 2：`channelSync` —— 登录态的定时上报机制

`orderlaile-competitor-order-flow.md` 记录了：

```text
channelSync.syncPath = /v2/ntw/web/client/public/channel/session/report
channelSync.syncIntervalMs = 1800000   // 30 分钟
```

这条被夹在渠道 entryUrl 列表中间，**没有任何一篇文档展开分析它**。但它很关键：

- `session/report` 说明**桌面端会把渠道登录态定时上报给云端**。
- 30 分钟一次，说明云端需要知道"这个商家的携程账号现在还活着吗"。
- 这意味着**云端能在桌面端离线时知道哪些账号需要重新登录**，可以做提醒、可以做任务调度决策。

对我们的影响：这是"桌面端 ↔ 自建后端"之间**第一条必须存在的数据通路**。没有它，后端完全不知道客户端状态，任何云端调度都无从谈起。

**建议**：见第二部分抽象 A。

### 遗漏 3：`browser_evaluate` 存在，但所有文档都在讲"不要用它"

工具清单里有 `browser_evaluate`（在页面主 world 执行 JS），同时提示词里三令五申"不要用 `browser_evaluate` 改 location/history/router 来跳转"。

这个组合值得注意：**能力保留了，但用 prompt 约束**。这是个脆弱的设计——prompt 约束对 prompt injection 无效。

对我们的影响：如果 OTA 页面被注入恶意内容诱导 agent 调 `browser_evaluate`，靠 SKILL.md 里那句话是拦不住的。

**建议**：`browser_evaluate` 这类"万能逃生舱"工具，要么不提供，要么用**代码**限制（白名单表达式 / 只读求值 / 禁止访问 location 和 history），不能只用 prompt 限制。这条属于我在上一份文档 F 项（ToolPolicy 按 RiskLevel 分级）的具体落点。

### 遗漏 4：`pms_http_request` 的"负向约束"设计

包内提示明确写：

> 不要用 `pms_http_request` 处理库存、房价、渠道、房型等经营数据查询。

调研文档记了这句，但没提炼出背后的模式：**它给了一个通用 HTTP 工具，然后明确禁止用它做高价值业务查询**。为什么？因为通用 HTTP 工具无法做业务级校验——agent 拼一个 URL 改了库存，系统无从知道它改的是哪家店的哪个房型。

这其实是一条通用设计原则：**能力越通用，越要限制它进入高风险领域**。高风险领域要用专用的、参数结构化的、能做语义校验的工具。

对我们的影响：我们如果提供 `http_request` 类工具，必须同样划出禁区，而且要用代码而非 prompt 划。

### 遗漏 5：跨店 fan-out 被显式禁用了

`orderlaile-tool-inventory.md`：

> 跨店 fan-out 曾有设计，但当前提示 2 家及以上门店"跨店操作暂不可用"。

以及 `DDLL_PMS_FANOUT_TOOL_TIMEOUT_MS = 3600000`（1 小时）—— 说明代码写了，超时都配好了，但**产品上关掉了**。

这是一个很有价值的负面信号：**一个比我们成熟得多的团队，做了跨店批量能力，然后决定不上线**。原因大概率是幂等、部分成功、权限、审计这几件事在跨店场景下复杂度爆炸。

对我们的影响：`ORDERLAILE_ARCHITECTURE_REVIEW.md` 已经说"第一阶段禁止跨店 fan-out"，这条判断被订单来了自己的行为验证了。建议**在架构上让它一开始就做不到**（ExecutionContext 只能持有单个 HotelId），而不是靠约定。

### 遗漏 6：`execute_skill` 有串行锁

`orderlaile-tool-inventory.md` 一句带过：

> `execute_skill` 有串行锁，避免并发调用互相覆盖。

这印证了我上一份文档里"缺账号级并发锁"的推测——**订单来了其实有锁，只是锁在 skill 执行层，不在账号层**。

区别很重要：skill 级串行锁意味着"同一时刻只能跑一个 skill"，这是个粗粒度全局锁，会限制吞吐；账号级锁允许不同账号并行、同账号串行，粒度更合理。

**建议**：我们做账号级（`channel + otaAccountId`）读写锁，读并发、写互斥。

### 遗漏 7：snapshot 的工程细节被记录了但没进设计

`orderlaile-browser-tool-deep-dive.md` 记录了 snapshot 的能力：

- 大页面**落盘**而非返回
- **diff 模式**，只返回相对上次的变化
- 分页、限制深度、指定 target 子树
- **跨 iframe 拼接**，frame-aware 的 ref 表
- 截图返回**文件路径而非 base64**

这些不是锦上添花，是**能不能用**的问题。OTA 后台页面动辄几千个节点，一次全量 snapshot 就能吃掉几万 token。diff 模式和落盘是让这套东西在真实页面上跑得起来的前提。

**建议**：browser capability 的接口设计第一天就要带 `mode: 'full' | 'diff'`、`target`、`maxDepth`、`spillToFile` 这些参数，不要先做个返回全量字符串的版本再改——接口形状会变。

### 遗漏 8：产品定位的结论散落在各处，没有收敛成一句话

多篇文档反复得出同一个结论但表述不同：

- `orderlaile-competitor-order-flow.md`：「订单来了 = 云 PMS/Channel Manager，我们 = 酒店 OTA 经营副驾」
- `orderlaile-solution-analysis.md`：「API 主链路 + 浏览器补洞」
- `ORDERLAILE_ARCHITECTURE_REVIEW.md`：「不应承诺 RPA 能实现实时防超售」
- `browser-guide/SKILL.md`（订单来了自己的）：劝阻 agent 用页面操作

这四条说的是同一件事，但**没有一处把它固化成产品约束**。这很危险，因为它直接决定我们能对客户承诺什么。

**建议**：把它写成一条明确的产品约束并放进 `openspec/specs/`：

> 在没有官方渠道 API 的情况下，本产品对渠道数据的承诺是「巡检发现 + 异常提示 + 可验证的半自动执行」，不是「实时同步 + 防超售」。任何 UI 文案、销售材料和 Agent 回答都不得越过这条线。

---

## 第二部分：自建后端的抽象边界

你说要自建后端、前期先抽象出来。下面给出**前期只定接口不做实现**的边界。

核心原则：**桌面端不直接依赖任何后端具体形态，所有跨端交互收敛到 5 个抽象**。前期这 5 个抽象全部可以用本地实现（SQLite / 内存 / 空实现）跑通，后端就位后换实现即可。

### 为什么是这 5 个

从订单来了的实际数据通路倒推，桌面端和云端之间只有五类交互：

```text
① 我是谁            → AppAccountGateway      (app 账号、token、门店权限)
② OTA 账号什么状态   → OtaAccountSyncGateway  (渠道登录态 → rms)
③ OTA 数据           → OtaBizDataGateway      (抓到的事实 → rms，推事实)
④ 改 OTA 的东西      → OtaActionGateway       (改价/改库存 → rms，推指令)
⑤ AI 怎么跑          → ModelGateway           (模型端点、计费、审计、脱敏)
```

这五个之外的东西（浏览器控制、页签管理、partition）**永远不出本机**，不需要抽象。

#### 关于 Gateway 的定义（重要，避免误读）

**Gateway 不是"分组"，是"可替换的实现点"。**

分组是给读代码的人用的，标准是名字取得好不好。Gateway 是给依赖图用的，标准只有一条：**会不会在不同时刻被替换掉**。今天注入 `LocalXxx`，明天注入 `RemoteXxx`，调用方一行不改——这才是它存在的理由。

所以判断一个 Gateway 该不该独立，问题永远是"它和隔壁那个会不会同进同退"，不是"它们在概念上是不是一类东西"。

按这条标准，②③④ 之所以分成三个而不是合成一个 `OtaGateway`：

- **② 今天就能接。** rms 后端（`/Users/lishoubo/p/projects/xiaozhi-rms-workspace`）已经存在，登录态上报是最简单、最先能落地的一条通路。
- **③ 需要 rms 侧有数据接收和归一能力**，时间点晚于 ②。
- **④ 需要 rms 侧有改价能力 + 我们这边有三段式审批**，时间点最晚。

三者落地节奏不同 → 会在不同时刻被替换 → 分开有收益。

#### 为什么 ③ 和 ④ 必须分开（不是概念洁癖）

③ 推的是**事实**，④ 推的是**指令**。它们的失败语义完全相反：

| | ③ 推事实 | ④ 推指令 |
|---|---|---|
| 目标 | 最终送达 | **恰好一次** |
| 失败了 | 重试即可 | 重试可能**改价两遍** |
| 需要 | 幂等去重 | 幂等键 + 三段式 + 执行后校验 |
| 自动重试 | 应该有 | **绝对不能有** |

塞进一个 Gateway，后来的人很容易顺手给改价也加上"失败自动重试"——这是个能造成真实经济损失的错误。**分成两个接口，让这个错误在类型层面就写不出来。**

### 抽象 A：`AppAccountGateway` —— 我们自己的身份与权限

```ts
export interface AppAccountGateway {
  // App 账号登录（前期：本地 mock；后期：自建后端）
  login(credential: LoginCredential): Promise<AppSession>;
  logout(): Promise<void>;
  currentSession(): AppSession | null;
  onSessionChanged(cb: (s: AppSession | null) => void): Unsubscribe;

  // 该 app 账号能访问哪些门店 —— 权威在后端
  listHotels(): Promise<readonly Hotel[]>;
}

export type AppSession = {
  userId: AppUserId;
  token: SecretToken;        // 不可序列化进日志，见下方约束
  expiresAt: string | null;
  hotels: readonly HotelRef[];
};
```

**前期实现**：`LocalAppAccountGateway`，读本地 SQLite，`listHotels` 返回用户手工添加的门店。产品上表现为"单机版"。

**后端就位后**：`RmsAppAccountGateway`，走 HTTPS。**桌面端代码一行不用改。**

注意这里管的是**我们自己的 app 账号**，和 OTA 账号完全无关（两套账号体系不绑定，见 `2026-08-03-harness-and-architecture-review.md` 0.1b）。命名里的 `App` 前缀就是为了和 ②③④ 的 `Ota` 前缀成对，让人一眼看出这是两侧的东西。

硬约束（现在就要立）：
- `SecretToken` 是个 opaque 类型，`toString()` 返回 `'[REDACTED]'`，禁止直接拼进 URL/日志/prompt。
- token **只在 main 进程持有**，preload 不暴露，renderer 拿不到。
- 给 AI 用时通过环境变量注入 MCP 进程（照抄订单来了的 `bearer_token_env_var`），不进 prompt、不进 rollout。

### 抽象 B：`OtaAccountSyncGateway` —— OTA 登录态同步

对应遗漏 2 的 `channelSync`。目标是把本机的渠道登录态**单向推给 rms**。

```ts
export interface OtaAccountSyncGateway {
  reportChannelSessions(report: ChannelSessionReport): Promise<void>;
}

export type ChannelSessionReport = {
  reportedAt: string;
  deviceId: string;
  sessions: readonly {
    channel: ChannelId;
    otaAccountId: OtaAccountId;
    loginState: LoginState;
    loginStateSource: string;    // 照抄订单来了的三元组
    loginStateUpdatedAt: string;
  }[];
};
```

**硬边界：只有状态元数据，没有 Cookie、没有 token、没有页面内容。** Cookie 永远不出本机。这条要守住——命名里刻意不用 `Cookie` 字样，就是为了不诱导后来的人往里塞。

**前期实现**：`NoopOtaAccountSyncGateway`，空实现。但**调用点现在就要埋**——登录态变化时该调就调，只是暂时不发出去。后端接上时换个实现，历史所有埋点立刻生效。

**这是五个 Gateway 里最先能接真实现的一个**，因为 rms 后端已存在，且上报数据结构简单、无副作用、失败了重传即可。建议作为打通"桌面端 ↔ rms"通路的第一个验证点。

### 抽象 C：`OtaBizDataGateway` —— OTA 业务数据同步（推事实）

```ts
export interface OtaBizDataGateway {
  // 采集结果回流：本机抓到的事实 → rms
  ingestObservation(obs: ChannelObservation): Promise<IngestReceipt>;

  // 读回：rms 归一后的权威数据
  listOrders(q: OrderQuery): Promise<Paged<Order>>;
  getRoomCalendar(q: CalendarQuery): Promise<RoomCalendar>;
}
```

**`ingestObservation` 是采集与权威的分界线。** 桌面端抓到的东西叫 `Observation`（观察），不叫 `Order`（订单）。它带 `observedAt` / `source` / `evidence`，交给 rms 去做去重、归一、升级成权威事实。

```ts
export type ChannelObservation = {
  observedAt: string;
  channel: ChannelId;
  otaAccountId: OtaAccountId;
  hotelId: HotelId | null;         // 可能抓不到，允许为 null
  kind: 'order' | 'inventory' | 'rate' | 'review' | 'message';
  payload: unknown;                // 渠道原始形状，不强行归一
  evidence: readonly EvidenceRef[];// 截图/HTML/网络日志
  quality: DataQuality;            // complete | partial | suspect
};
```

`quality` 字段很关键——抓取天然会失败、会抓一半。**允许上报"我抓得不完整"，比强行编造一个完整结果安全得多。**

这个 Gateway 里的操作**都是可重试的**：推事实失败了重传，读数据失败了重查。幂等由 rms 侧按 `(channel, otaAccountId, kind, 业务主键)` 去重保证。

**前期实现**：`LocalOtaBizDataGateway`，写本地 SQLite，读也从本地读。

### 抽象 D：`OtaActionGateway` —— OTA 写操作（推指令）

**这个 Gateway 的每一个方法都可能造成真实的经济后果**，所以它和 C 分家。

```ts
export interface OtaActionGateway {
  proposeAction(action: ProposedAction): Promise<ActionProposal>;
  confirmAction(proposalId: string, idempotencyKey: string): Promise<ActionExecution>;
  verifyAction(executionId: string): Promise<ActionVerification>;
}
```

三条设计约束：

**1. 接口上没有"直接执行"这个方法。** 只能走 `propose → confirm → verify` 三段式。这是 `ORDERLAILE_ARCHITECTURE_REVIEW.md` 提出的状态机，这里把它固化进类型——**想绕过都写不出来**。

**2. `confirmAction` 强制要求 `idempotencyKey`。** 不是可选参数。调用方必须显式想清楚"这次执行的唯一标识是什么"，而不是让传输层偷偷重试。

**3. 这个 Gateway 的实现里禁止任何自动重试。** 网络失败 → 状态置为 `unknown` → 走 `verifyAction` 查真实结果 → 由人或策略决定要不要重做。**永远不要因为"没收到响应"就重发一次改价。**

**前期实现**：`LocalOtaActionGateway`，三段式流程完整实现（人工确认走本地 UI），执行落到本地 RPA。这样状态机第一天就被验证过，rms 接管时是换执行器，不是补流程。

### 抽象 E：`ModelGateway` —— 模型调用

对应上一份文档 D 项（模型网关前置）。

```ts
export interface ModelGateway {
  resolveEndpoint(): Promise<ModelEndpoint>;
}

export type ModelEndpoint = {
  baseUrl: string;
  wireApi: 'responses' | 'chat-completions' | 'anthropic-messages';
  model: string;
  authTokenEnvVar: string;   // token 通过 env 注入，不落配置文件
};
```

看起来很薄，但它是**桌面端唯一知道模型在哪的地方**。Codex 的 `config.toml` 由这个接口的返回值生成——完全照抄订单来了的做法：

```toml
model_provider = "app_profile"
[model_providers.app_profile]
base_url  = <resolveEndpoint().baseUrl>
wire_api  = <resolveEndpoint().wireApi>
env_key   = <resolveEndpoint().authTokenEnvVar>
```

**前期实现**：`LocalModelGateway`，从本地配置读一个开发用的 endpoint（可以直连某个模型厂商做开发）。**但产品发布前必须切成后端下发**——否则脱敏、审计、计费全都没有着落。

这条我建议写成一条发布门禁：**`LocalModelGateway` 在 `app.isPackaged === true` 时直接抛错**，让它不可能被打包进正式版。

### 五个抽象的位置

```text
src/main/gateways/
  app-account-gateway.ts        接口
  ota-account-sync-gateway.ts   接口
  ota-biz-data-gateway.ts       接口
  ota-action-gateway.ts         接口
  model-gateway.ts              接口
  local/                        前期实现（SQLite / noop / 本地配置）
  rms/                          rms 后端实现（按 ②→③→④ 顺序逐个补）
```

**依赖方向**：业务代码只 import `gateways/*.ts` 的接口，永远不 import `local/` 或 `rms/`。具体实现在 `application.ts`（composition root）注入。

这条如果守住，换后端就是改一行注入。守不住的话，`local/` 的实现细节会顺着调用链渗进业务代码，后面撕不开。建议用 eslint 的 `no-restricted-imports` 强制。

---

## 第三部分：前期不要做的抽象

抽象是有成本的，以下这些**现在做反而是负担**：

| 不要抽象 | 原因 |
|---|---|
| 浏览器控制层 | 永远在本机，不会有第二种实现 |
| partition / 页签管理 | 同上 |
| 渠道 adapter 接口 | 现在只有 RPA 一种实现，等真接了第一个官方 API 再抽 |
| 存储层 ORM 抽象 | SQLite 就是最终选择，不要为"将来可能换 PG"做仓储抽象 |
| 事件总线 | 进程内直接调用即可，等真有跨进程需求再说 |
| 多租户 | 已确认不做（用户判断），需要时加 mapping 层 |

判断标准：**只有"确定会有第二种实现"的地方才值得抽象。** 上面五个 Gateway 都满足（本地实现 → rms 实现），其余的不满足。

---

## 第四部分：建议的落地顺序

不改变 `ORDERLAILE_ARCHITECTURE_REVIEW.md` 的阶段划分，只是把本文的产出插进去：

**现在（纯设计，不写实现代码）**
1. 定 5 个 Gateway 接口签名
2. 定 `InventoryImpact` / `ChannelObservation` / `DataQuality` 三个核心类型
3. 写产品约束那句话（遗漏 8）进 `openspec/specs/`

**阶段 0（跟原计划的 per-account partition 改造一起）**
4. `LocalAppAccountGateway` + `NoopOtaAccountSyncGateway`，埋好调用点
5. eslint 依赖方向约束
6. `LocalModelGateway` 的打包门禁

**阶段 1（跟原计划的只读闭环一起）**
7. `LocalOtaBizDataGateway` + `ingestObservation` 全链路
8. `LocalOtaActionGateway` 的 `propose → confirm → verify` 三段式（哪怕执行器是本地的）

**rms 接入（按依赖顺序，不必等阶段 1 全部完成）**
9. `RmsOtaAccountSyncGateway` —— 最先，无副作用，验证通路
10. `RmsOtaBizDataGateway` —— 需要 rms 侧有归一能力
11. `RmsOtaActionGateway` —— 最后，需要 rms 侧有改价能力

第 9 步建议提前做，它是验证"桌面端 ↔ rms"整条链路（鉴权、网络、错误处理、重试）成本最低的一个探针。

**后端就位后**
9. 写 `remote/` 四个实现，改 composition root 一行

---

## 验证说明

本文为文档复查 + 设计建议，未修改代码、未运行程序、未访问外部系统。

已完整阅读：`orderlaile-tool-inventory.md`、`orderlaile-browser-tool-deep-dive.md`、`orderlaile-skill-inventory.md`、`orderlaile-skills-chinese-review.md`、`orderlaile-competitor-order-flow.md`（全文）、`embedded-browser-design.md`、`cdp-and-codex-runtime-intro.md`、`codex-plugin-market-vs-orderlaile-skill-market.md`、`open-source-reference-solutions.md`（部分）、`orderlaile-solution-analysis.md`（架构章节）。

仅读标题结构、未逐行阅读：`desktop-app-tech-selection.md`（704 行，技术选型结论已被现有代码采纳，无需复查）、`browser-tool-open-source-granular-review.md`（387 行）、`electrobun-rms-desk-feasibility.md`（332 行，Electrobun 已被否决）。若这三篇里有设计细节需要复查，可另行指出。

本文第二部分的接口签名是**设计建议，未经实现验证**。
