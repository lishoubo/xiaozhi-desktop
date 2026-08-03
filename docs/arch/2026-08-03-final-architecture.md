# 最终架构方案（整合版）

日期：2026-08-03
状态：**定稿**。已整合并取代 `top-level-layout` / `target-directory-structure` / `STATUS` 三份过程稿（已删除）
术语以 `2026-08-03-glossary-and-orderlaile-mapping.md` 为准

本文回答三件事：

1. **顶层与 `src/` 的最终目录**（合并两文，`src/` 保持在根目录）
2. **核心业务代码如何剥离框架影响** —— Electron、Codex、SQLite 都换得掉
3. **核心领域模型** —— 需要固化的类型

---

## 第一部分：一条主线

前面 7 份文档在目录形态上反复，是因为一直在问"文件放哪"。真正该先问的是**"什么东西不能被框架污染"**。答案定了，目录是它的自然投影。

我们要建的不是一个 Electron 应用，是一个**多 OTA 账号的可审计执行平台**，它今天恰好跑在 Electron 里、恰好用 Codex 当 harness、恰好用 SQLite 落盘。这三个"恰好"都会变：

| 会变的东西 | 变的原因 | 现在的耦合点 |
|---|---|---|
| Electron | 体积、Electrobun/Tauri、将来可能有 web 端 | `browser-manager.ts` 直接 `import { session } from 'electron'` |
| Codex | harness 换代（Claude Agent SDK 是 Plan B） | 尚未接入，**现在是零成本立规矩的唯一窗口** |
| SQLite | 前期不会变，但 rms 接管后大量数据不落本地 | `application-database.ts` |
| RPA 采集 | 官方 API 一旦开放就换 | `ctrip-check-in-automation.ts` |

**不会变的是中间那层**：一个渠道账号处于什么登录态、一次采集观察到了什么、一次改价要走哪三段、库存被谁占用。这层是产品本身，值得用最强的约束保护起来。

所以最终架构只有一条主线：

```text
domain/     纯 TypeScript，零框架依赖 —— 业务是什么
   ↑
main/       Electron 侧实现 —— 业务在这台机器上怎么跑
   ↑
renderer/   Svelte —— 业务怎么被看见
```

`gateways/` 是 domain 向外的出口（会换成 rms 实现），`ai/runtime/` 是 domain 向 harness 的出口（会换成别的 harness）。**这两个出口 + domain 本身，构成"框架无关的核心"。**

---

## 第二部分：目录结构（定稿）

### 2.1 顶层：方案 A，`src/` 留在根目录

按你的决定，`src/` 不动。理由在原文档 §2 已论证充分，此处只记结论与增量。

```text
xiaozhi-desktop/
│
├── src/                     应用源码（见 2.2）
├── tests/                   unit/ component/ e2e/ fixtures/
│
├── resources/               ★ 新建：打包进产物但不进 asar 的内容
│   ├── skills/              #   产品 skill（分发给用户，可热更）
│   ├── channels/            #   渠道 manifest JSON（高频变更）
│   ├── runtime/             #   LATEST.json + 下载脚本
│   │   └── vendor/          #   runtime 二进制（gitignore）
│   └── icons/
│
├── scripts/                 ★ 新建：开发运维脚本
├── dist/                    ★ 新建：打包、签名、公证
├── output/                  ★ 新建：构建产物（gitignore）
│
├── docs/  openspec/         文档与规范
├── .claude/  .agents/       研发 skill（不打包，与 resources/skills 区分）
│
└── （根配置文件：package.json / forge / vite / tsconfig / vitest / eslint …）
```

**唯一的硬约束是「进不进 asar」**。asar 是只读归档且已开完整性校验（`EnableEmbeddedAsarIntegrityValidation`），进了 asar 的东西无法独立更新、无法运行时写入、改动会导致启动失败。

| 目录 | git | asar | 变更频率 | 打包后位置 |
|---|---|---|---|---|
| `src/` | ✅ | ✅ | 高 | `Resources/app.asar` |
| `resources/skills/` | ✅ | ❌ | 中 | `Resources/skills/` |
| `resources/channels/` | ✅ | ❌ | **高** | `Resources/channels/` |
| `resources/runtime/` | ✅ | ❌ | 低 | `Resources/runtime/` |
| `resources/runtime/vendor/` | ❌ | ❌ | 跟随 LATEST.json | 同上 |
| `tests/` `scripts/` `dist/` `docs/` `.claude/` | ✅ | ❌ | — | 不打包 |
| `output/` | ❌ | — | — | 不打包 |

判断规则一句话：**需要独立更新、或需要运行时写入的，都不能进 asar。** skills / channels / runtime 三者全中。

方案 B（`app/` 分层）**正式搁置**。目录是所有架构决策里最容易反悔的一个，`git mv` 加改路径即可；真正改不动的是下面第三、四部分。

### 2.2 `src/` 内部：四层

```text
src/
│
├── domain/                          ★★ 核心业务：零框架依赖
│   ├── identity.ts                  #  branded ID + 转换函数
│   ├── execution-scope.ts           #  ★HotelExecutionScope（跨店 fan-out 防线）
│   ├── channel.ts                   #  ChannelManifest、导航策略（纯函数）
│   ├── ota-account.ts               #  OtaAccount、LoginState 三元组
│   ├── hotel.ts                     #  Hotel、AccountBinding
│   ├── observation.ts               #  ChannelObservation、DataQuality
│   ├── action.ts                    #  ProposedAction、三段式状态机
│   ├── inventory.ts                 #  InventoryImpact
│   ├── agent-event.ts               #  归一化 agent 事件
│   ├── versioning.ts                #  SCHEMA_VERSIONS
│   ├── errors.ts                    #  领域错误类型
│   ├── policy/                      #  ★ 纯决策逻辑（可单测，无需 Electron）
│   │   ├── navigation-policy.ts     #    某 URL 在某 manifest 下允不允许
│   │   ├── tool-policy.ts           #    RiskLevel 分级、是否需审批
│   │   ├── login-health.ts          #    三元组 → 登录态判定
│   │   └── action-state-machine.ts  #    propose → confirm → verify 合法迁移
│   └── ports/                       #  ★ domain 需要外界提供什么（接口，无实现）
│       ├── app-account-gateway.ts
│       ├── ota-account-sync-gateway.ts
│       ├── ota-biz-data-gateway.ts
│       ├── ota-action-gateway.ts
│       ├── model-gateway.ts
│       ├── agent-runtime.ts         #    harness 接口
│       ├── browser-port.ts          #    ★「打开页面/取快照/点击」的抽象
│       └── repositories.ts          #    持久化接口
│
├── main/                            Electron 侧实现（adapters）
│   ├── core/                        #  技术底座，零业务语义
│   │   ├── composition.ts           #    ⚠原 application.ts —— 唯一 new 实现的地方
│   │   ├── lifecycle.ts
│   │   ├── window/  security/  logging/
│   │   ├── paths.ts
│   │   └── concurrency/             #    ★账号级读写锁
│   │
│   ├── data/                        #  持久化实现（实现 ports/repositories）
│   │   ├── app-database.ts          #    ①配置 + ②状态
│   │   ├── facts-database.ts        #    ③事实 + 审计
│   │   ├── artifact-store.ts        #    截图/HTML/trace（文件系统）
│   │   ├── migration-runner.ts      #    ★降级检测 + 备份 + 回滚
│   │   ├── migrations/{app,facts}/
│   │   └── repositories/            #    calendar / observation / action / session
│   │
│   ├── browser/                     #  Electron 浏览器实现（实现 browser-port）
│   │   ├── session-factory.ts       #    ★唯一拼 partition 字符串的地方
│   │   ├── browser-manager.ts       #    ⚠大改
│   │   ├── tab-registry.ts          #    ★从 manager 拆出
│   │   ├── browser-state-store.ts   #    ★browserState 权威 + revision
│   │   └── cookie-importer.ts       #    ⚠导入目标改为指定账号
│   │
│   ├── ai/                          #  harness 实现（前期只建骨架）
│   │   ├── codex/                   #    实现 ports/agent-runtime
│   │   │   ├── codex-agent-runtime.ts
│   │   │   ├── codex-config-writer.ts
│   │   │   └── codex-process.ts
│   │   ├── tools/                   #    ToolRegistry（工具真身）
│   │   ├── skills/                  #    装载 resources/skills/
│   │   ├── mcp/                     #    adapter + bridge
│   │   └── observability/
│   │
│   ├── gateways/                    #  ports 的实现
│   │   ├── local/                   #    前期实现（SQLite / noop / 本地配置）
│   │   └── rms/                     #    rms 接入后（前期不存在）
│   │
│   ├── features/                    #  编排：把 domain 的决策落到具体设施上
│   │   ├── channel/                 #    manifest-registry（读 resources/channels）
│   │   ├── ota-account/             #    account-registry
│   │   ├── observation/             #    采集编排
│   │   ├── action/                  #    三段式编排
│   │   └── calendar/
│   │
│   ├── services/                    #  系统集成（自启动等）
│   └── ipc/
│       ├── register.ts  ipc-guard.ts
│       └── browser- / cookie- / system- / calendar-handlers.ts
│
├── preload/
│   ├── index.ts
│   └── api/{browser,cookies,calendar,system,agent}.ts
│
├── renderer/                        Svelte（基本不动）
│   ├── pages/  components/  calendar/  generative-ui/
│   └── data/ota-icons.ts            #  保留（纯资源）；删 ota-channels.ts
│
└── shared/                          双端共享的传输层契约
    ├── ipc/channels.ts  ipc/contracts.ts
    └── view-models/                 #  ★renderer 消费的展示模型
```

**图例**：★新建；⚠现有文件要动；无标记 = 不动或纯搬迁

### 2.3 与前两版的三处差异（这是本文的实质改动）

| | 原过程稿方案 | 本文 | 为什么改 |
|---|---|---|---|
| 领域类型位置 | `shared/domain/`（双端共享区） | **`src/domain/`（独立顶层）** | 见下 |
| Gateway 接口 | `main/gateways/*.ts` | **`domain/ports/`**，实现留在 `main/gateways/` | 接口属于 domain，实现属于 Electron 侧 |
| 决策逻辑 | 散在 `features/*` | **`domain/policy/`** | 导航策略、RiskLevel、三段式是纯函数，不该被 Electron 绑架 |

**为什么把 domain 从 `shared/` 里提出来** —— 原方案把领域类型放 `shared/domain/`，理由是"main 和 renderer 都要认"。但这混了两件事：

```text
shared/  = 两个进程之间的传输契约   —— 存在的理由是「跨进程」
domain/  = 业务是什么               —— 存在的理由是「跨框架」
```

放在 `shared/` 会导致两个坏结果：一是 renderer 需要的展示字段会往 domain 里挤（订单来了的 `channelHotelName` 就是这种回显字段），把领域模型污染成 UI 模型；二是"零框架依赖"这条约束无处安放 —— `shared/` 天然要为 renderer 服务，早晚有人往里塞 UI 相关的东西。

分开之后规则极其清楚：

```text
domain/     不 import electron、不 import svelte、不 import better-sqlite3、不 import codex
shared/     只放 IPC 契约和 view-model，可以为 UI 便利而设计
```

renderer 需要 `LoginState` 时，不是直接 import domain，而是 IPC contract 里声明这个字段 —— 类型可以从 domain re-export，但**依赖方向是 shared 引 domain，不是 domain 迁就 shared**。

---

## 第三部分：核心业务代码如何剥离框架（本文重点）

### 3.1 三条判定规则

一个文件该进 `domain/` 还是 `main/`，只问三个问题：

| 问题 | 是 → | 否 → |
|---|---|---|
| 它 import 了 `electron` / `better-sqlite3` / codex SDK / svelte 吗 | `main/` 或 `renderer/` | 继续问 |
| 它做 I/O 吗（读文件、发网络、写数据库、起进程） | `main/` | 继续问 |
| 换个前端框架 / 换个 harness / 换个数据库，它要改吗 | `main/` | **`domain/`** |

一句话：**`domain/` 里的代码，用 `vitest` 裸跑不需要 mock 任何东西。** 这既是判定标准，也是验收标准 —— 如果一个 domain 测试需要 mock Electron，说明放错了。

### 3.2 Electron 的剥离：browser-port

现在的耦合是这样的：

```ts
// src/main/browser/browser-manager.ts:24 —— 现状
session.fromPartition('persist:hotel-butler-browser')
```

业务逻辑（"打开携程后台的订单页"）和 Electron API（`WebContentsView`、`session`、`partition`）搅在一起。剥离方式是**在 domain 定义端口，main 提供实现**：

```ts
// domain/ports/browser-port.ts —— 零 Electron
export interface BrowserPort {
  open(key: BrowserContextKey, entryPoint: EntryPointId): Promise<TabId>;
  snapshot(tab: TabId, opts: SnapshotOptions): Promise<PageSnapshot>;
  act(tab: TabId, action: PageAction): Promise<ActResult>;
  close(tab: TabId): Promise<void>;
}

// SnapshotOptions 的形状第一天就要带这四个参数（见"遗漏 7"）
export type SnapshotOptions = {
  mode: 'full' | 'diff';
  target?: NodeRef;
  maxDepth?: number;
  spillToFile?: boolean;   // 大页面落盘而非返回
};
```

注意 `open()` 的签名 —— 它收 `BrowserContextKey + EntryPointId`，**不收 URL**。URL 由 main 侧从 channel manifest 解析。这样 P0-2（renderer 说打开哪就打开哪）在类型层面就写不出来了。

`WebContentsView`、`Session`、`partition` 这些词一个都不出现在 domain 里。

**这不是为了将来换 Electron 才做的**（换的概率不高）。真实收益是：导航策略、登录态判定、快照 diff 逻辑可以用普通 vitest 测试，不需要起 Electron 进程。当前 e2e 测试跑一次的成本，是单测的几十倍。

### 3.3 Codex 的剥离：agent-runtime + 归一化事件

这是**唯一还没写代码的部分，也是唯一能零成本立规矩的窗口**。一旦 Codex 的事件形状渗进 renderer，再撕就要动 UI。

```ts
// domain/ports/agent-runtime.ts —— 不 import 任何 codex 相关模块
export interface AgentRuntime {
  startSession(scope: HotelExecutionScope): Promise<AgentSessionHandle>;
  send(session: AgentSessionHandle, input: UserInput): AsyncIterable<AgentEvent>;
  interrupt(session: AgentSessionHandle): Promise<void>;
  dispose(session: AgentSessionHandle): Promise<void>;
}

// domain/agent-event.ts —— renderer 只认这个，永远不认 codex 的原始事件
export type AgentEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'tool-call'; callId: string; tool: string; risk: RiskLevel; args: unknown }
  | { kind: 'tool-result'; callId: string; summary: string }
  | { kind: 'approval-required'; callId: string; reason: string }
  | { kind: 'error'; error: DomainError }
  | { kind: 'done'; reason: 'completed' | 'interrupted' | 'failed' };
```

Cherry Studio 的 `ai/runtime/{aiSdk,claudeCode}/` 是这个模式已被验证的证据 —— 两个 harness 并列，上层不感知。

三条配套约束：

1. **工具真身在 `main/ai/tools/`，不在 codex 目录里。** harness 只是调用工具的一种方式，MCP 是另一种。工具不能依赖 harness。
2. **`config.toml` 每次启动重新生成**（`codex-config-writer.ts`），不读用户手改 —— 否则用户改了 `sandbox_mode` 就绕过了我们的安全模型。
3. **会话双写。** codex 存它的 rollout，我们存归一化的 `agent_session`（含 `harness` + `harness_thread_id`）。换 harness 时老会话仍可读。

### 3.4 SQLite 的剥离：repositories 接口

```ts
// domain/ports/repositories.ts
export interface ObservationRepository {
  save(obs: ChannelObservation): Promise<void>;
  listByAccount(id: OtaAccountId, range: TimeRange): Promise<readonly ChannelObservation[]>;
}
```

`current-architecture-change-plan.md §6` 说"不要抽象存储层，SQLite 是最终选择"。**这条我保留一半**：不做 ORM 抽象是对的（不为"将来换 PG"付成本），但 repository 接口仍要有，理由不是换数据库，是**换存储位置** —— rms 接管后，observation 的权威会挪到云端，本地只留缓存。那时换的是 repository 实现。

判断标准始终是"会不会有第二种实现"，而 observation 的第二种实现（rms）是**已经规划好的**。

### 3.5 用 eslint 把规则焊死

规则写在文档里会被忘记，写在 lint 里不会。

```jsonc
// .eslintrc.json
"import/no-restricted-paths": ["error", {
  "zones": [
    // ── domain 的三道墙（本架构的核心约束）──────────────
    { "target": "./src/domain", "from": "./src/main",     "message": "domain 不能依赖 main" },
    { "target": "./src/domain", "from": "./src/renderer", "message": "domain 不能依赖 renderer" },
    { "target": "./src/domain", "from": "./src/shared",   "message": "domain 不能依赖 shared（方向反了）" },

    // ── 跨端与分层 ───────────────────────────────────
    { "target": "./src/renderer", "from": "./src/main",   "message": "renderer 只能通过 preload 访问 main" },
    { "target": "./src/main/core", "from": "./src/main/features", "message": "core 是技术设施，不能依赖业务" },

    // ── 实现只能在 composition root 被 import ──────────
    { "target": "./src/main", "from": "./src/main/gateways/local",
      "except": ["./core/composition.ts"], "message": "只有 composition root 能 import Gateway 实现" },
    { "target": "./src/main", "from": "./src/main/gateways/rms",
      "except": ["./core/composition.ts"], "message": "只有 composition root 能 import Gateway 实现" },

    // ── 工具层不得依赖 harness ────────────────────────
    { "target": "./src/main/ai/tools", "from": "./src/main/ai/codex",
      "message": "工具实现不得依赖具体 harness" }
  ]
}]
```

`import/no-restricted-paths` 拦不住 `import { session } from 'electron'`（那是 npm 包不是路径），所以再加一条：

```jsonc
// overrides: files: ["src/domain/**"]
"no-restricted-imports": ["error", {
  "paths": [
    { "name": "electron", "message": "domain 必须零框架依赖" },
    { "name": "better-sqlite3", "message": "domain 不做 I/O" },
    { "name": "svelte", "message": "domain 不认 UI" },
    { "name": "node:fs", "message": "domain 不做 I/O" },
    { "name": "node:child_process", "message": "domain 不起进程" }
  ]
}]
```

> ✅ **已实测（2026-08-03，Node 24.18.1）**。domain 三道墙 + 五个 npm 包禁令全部生效，已落进 `.eslintrc.json`。
>
> 三条实测结论：
>
> 1. **`import type` 同样被拦截。** `import type { Session } from 'electron'` 会报错。type-only import 不产生运行时依赖，但仍是类型层面的框架污染，同类配置常在此漏网。
> 2. **eslint 对不存在的路径完全静默** —— 不报错、不警告，规则只是悄悄失效。所以每条 zone 都必须用探针文件实测，"配置写了"不等于"规则生效"。
> 3. **composition root 那条规则暂时立不了**，原因见下。

#### composition root 规则：为什么现在还不能立

文档原本给了这条：

```jsonc
{ "target": "./src/main", "from": "./src/main/gateways/local",
  "except": ["./core/composition.ts"] }
```

障碍不是路径没对齐（`main/core/`、`main/gateways/` 目前都不存在，composition root 实际是 `main/application.ts`），而是**接口与实现同处一个文件**：

```ts
// src/main/calendar/calendar-repository.ts
export interface CalendarRepository { … }        // :40  ← 接口
export class SqliteCalendarRepository … { … }    // :47  ← 实现
```

`import/no-restricted-paths` 按**文件路径**拦截，区分不了"引的是接口还是实现类"。对这个文件设墙，会误伤 `calendar-handlers.ts` 里那行合法的 `import type { CalendarRepository }`。

而现有代码其实**已经自发遵守了这条规则**：

| 实现 | 被谁 import | 状态 |
|---|---|---|
| `BrowserManager` | 仅 `application.ts` | 合规 |
| `SqliteCalendarRepository`（值） | 仅 `application.ts` | 合规 |
| `openApplicationDatabase`（值） | 仅 `application.ts` | 合规 |
| `CalendarRepository`（类型） | `calendar-handlers.ts` | 合规 —— 引的是接口 |
| `ApplicationDatabase`（类型） | `calendar-repository.ts` | 合规 —— 引的是类型 |

**所以这条规则的真正前置条件是接口先拆出去**（`domain/ports/repositories.ts` + `main/data/repositories/`），拆完规则自然可立，且立的是"锁住既有的好状态"，不是纠正错误。在那之前照抄配置只会得到一条静默失效的规则 —— 比没有规则更糟，因为它给人虚假的安全感。

### 3.6 一个反例，说明边界在哪

"判断一个渠道账号是否还登录着"这件事，正确的拆法：

```ts
// ✅ domain/policy/login-health.ts —— 纯函数，可单测
export function evaluateLoginState(
  probe: LoginProbeResult,
  previous: LoginState,
  now: string,
): LoginState {
  // 三元组：state + source + updatedAt，缺一不可
}

// ✅ main/features/ota-account/login-health-checker.ts —— 编排
class LoginHealthChecker {
  async check(key: BrowserContextKey): Promise<LoginState> {
    const probe = await this.browser.snapshot(tab, { mode: 'diff', maxDepth: 3 });
    return evaluateLoginState(toProbeResult(probe), previous, this.clock.now());
  }
}
```

判定规则（"看到登录框 = 未登录"、"cookie 过期但页面正常 = unknown"）在 domain，可以穷举测试；"怎么拿到页面"在 main。

**错误的写法**是把 `evaluateLoginState` 写在 `LoginHealthChecker` 里 —— 那样测一个判定规则就要起 Electron。

---

## 第四部分：核心领域模型

以下是需要**第一天就固化**的类型。判断标准：**将来补不回来的**。

### 4.1 标识：branded type

```ts
// domain/identity.ts
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type ChannelId    = Brand<string, 'ChannelId'>;
export type OtaAccountId = Brand<string, 'OtaAccountId'>;
export type HotelId      = Brand<string, 'HotelId'>;
export type AppUserId    = Brand<string, 'AppUserId'>;
export type TabId        = Brand<string, 'TabId'>;

// 唯一允许 as 的地方
export function toChannelId(raw: string): ChannelId;
export function toOtaAccountId(raw: string): OtaAccountId;
// …

export type BrowserContextKey = Readonly<{
  environment: 'prod' | 'dev';
  channel: ChannelId;
  otaAccountId: OtaAccountId;
}>;
```

用 `unique symbol` 而非字符串字面量做 brand —— 别处写不出 `{ __brand: 'ChannelId' }` 来伪造。

**`AppUserId` 和 `OtaAccountId` 必须是两个类型**：这是「两套账号体系不绑定」在类型层面的落实。命名分开给人看，branded type 给编译器看，两者都要有。

### 4.2 六个核心模型

#### ① `ChannelManifest` —— 渠道的能力与策略声明

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

#### ② `LoginState` —— 三元组，不用裸 bool

```ts
export type LoginState = Readonly<{
  state: 'logged_in' | 'logged_out' | 'unknown' | 'expired';
  source: 'cookie-probe' | 'page-marker' | 'api-probe' | 'user-declared';
  updatedAt: string;
}>;
```

照抄订单来了（它这里做对了）。**没有 `source` 和 `updatedAt` 的登录态是无法运营的** —— 你不知道这个 `false` 是"刚探测过确实掉线"还是"三天前探测的，现在不知道"。

#### ③ `ChannelObservation` —— 采集与权威的分界线

```ts
export type ChannelObservation = {
  id: ObservationId;
  observedAt: string;
  channel: ChannelId;
  otaAccountId: OtaAccountId;
  hotelId: HotelId | null;              // 可能抓不到，允许 null
  kind: 'order' | 'inventory' | 'rate' | 'review' | 'message';
  payload: unknown;                     // 渠道原始形状，不强行归一
  evidence: readonly EvidenceRef[];     // 截图/HTML/网络日志
  quality: DataQuality;
};

export type DataQuality = 'complete' | 'partial' | 'suspect';
```

**桌面端抓到的东西叫 `Observation`（观察），不叫 `Order`（订单）。** 归一和去重是 rms 的职责。

`quality` 是这个模型里最重要的字段：**允许上报"我抓得不完整"，比强行编造一个完整结果安全得多。** 抓取天然会失败、会抓一半，没有这个字段的话，`partial` 的数据会被当成 `complete` 用在库存计算里。

#### ④ `InventoryImpact` —— 库存占用是显式字段，不是推导结果

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

#### ⑤ `ProposedAction` —— 三段式写在类型里

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

#### ⑥ `HotelExecutionScope` —— 一次执行的作用域，也是跨店 fan-out 的防线

```ts
// domain/execution-scope.ts
export type HotelExecutionScope = Readonly<{
  appUserId:    AppUserId;      // 审计链条起点：approved_by 要能追到人
  hotelId:      HotelId;        // ⚠ 单数。改成数组 = 拆掉跨店 fan-out 防线，见第七部分
  otaAccountId: OtaAccountId;
  environment:  'prod' | 'dev';
}>;
```

**这个类型是"不做跨店 fan-out"这条产品决策的唯一载体。** 第七部分说的"架构上让它做不到"，具体就是指 `hotelId` 这个字段是单数。半年后有人为了做"批量巡检"把它改成 `readonly HotelId[]`，改的那一刻防线就没了——**而他很可能不知道自己在拆什么**，所以注释必须留在字段旁边，不能只写在文档里。

命名上刻意不叫 `ExecutionContext`：一是这个词在 TS 生态里被 AsyncLocalStorage、各类中间件用滥了，搜代码噪音大；二是 `Context` 可以装任意东西，而 `Scope` 天然读作"边界"，往里塞数组会别扭。也不叫 `OtaContext`——它有一半字段（`appUserId`、`environment`）跟渠道无关，且 `Ota*` 前缀在本项目已固定表示"属于渠道侧"。

两条配套约束：

1. **scope 在 session 级固定，不可变。** `startSession(scope)` 之后不允许中途换店换账号。要换 = 开新 session。这样审计时"这次会话动的是哪个店"有唯一答案。
2. **`agent_tool_call` 的审计要能回答"对哪个店做的"。** 4.6 的表结构里没有 `hotel_id`，因此 `agent_session` 表**必须**存下完整 scope（`app_user_id` / `hotel_id` / `ota_account_id` / `environment`），由 `session_id` 关联回去。否则出了事故只知道"改了价"，不知道"改的谁家的价"。

### 4.3 五个 Gateway（ports）

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

### 4.4 五个独立版本号

```ts
// domain/versioning.ts
export const SCHEMA_VERSIONS = {
  appDatabase:     2,   // 已有
  browserState:    1,   // 要建
  channelManifest: 1,
  partitionLayout: 1,   // ★ 一旦发出去就固化在用户磁盘上
  agentSession:    1,
} as const;
```

`partitionLayout` 是其中最特殊的一个：partition 命名发布后就固化在用户磁盘上了。将来要改名（比如加 mapping 层），必须知道当前用户是哪个布局版本才能决定要不要迁移。**这就是那层"实在不行后面可以加 mapping"所需要的触发器。**

配套三条升级规则：

1. **挡住降级** —— `dbVersion > SCHEMA_VERSIONS.appDatabase` 直接抛错。老版本打开新版本的库会产生**静默的错误行为**，比崩溃更糟。
2. **迁移前备份，失败回滚** —— 现有 `migrate()` 是事务包裹的，单条迁移原子；但**多条迁移之间不是**，迁移 3 成功、4 失败就停在中间态。
3. **partition 永远不删，只标记 legacy** —— 磁盘空间最便宜，OTA 登录态最贵。

### 4.5 存储：三类数据分开

```text
<userData>/
  app.sqlite      ← ①配置 ②状态：小、迁移频繁、每次迁移前备份
  facts.sqlite    ← ③事实与审计：大、只增、按时间清理
  artifacts/      ← 截图/HTML/trace：文件系统，不进数据库
    <yyyy-mm>/<observationId>/{screenshot.png, snapshot.html, network.jsonl}
```

现在混一个库没关系（数据少），但 observation 一上来（每天几千条），③ 会淹没 ①②，备份和迁移都会变慢。**分库的成本现在几乎为零**（一个 `openDatabase` 变两个），以后再分要动所有 repository。

artifacts 配套：保留期默认 30 天、脱敏后才能导出、总容量上限（超了删最旧）。桌面 app 把用户磁盘塞满是真实会发生的事故。

### 4.6 审计表

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

---

## 第五部分：执行顺序

### 第 0 步：立刻做（有实际风险）

```ts
// application.ts:37 —— 改 opt-in（1 行）
const automationEnabled = process.env.HOTEL_BUTLER_ENABLE_STARTUP_AUTOMATION === '1';
```

`CtripCheckInAutomation` 现在**开机自动执行、跑在全局共享 session 上、无上下文、无审批**，还用了 `debugger.attach` + `Runtime.evaluate`。它同时踩了 P0-1、P1-1 和 RiskLevel 缺失三个问题。**这是当前唯一有实际安全风险的项。**

### 零风险准备（与任何决策无关）

```text
① 建 resources/{skills,channels,runtime,icons}/  scripts/  dist/  output/
② 删 vite.preload.config.ts（空配置 defineConfig({})）
③ 移 DESIGN.md → docs/
④ .gitignore 加 output/、resources/runtime/vendor/
```

### 第 1 步：建 `domain/`（纯类型，零行为改动）

```text
建 domain/{identity,channel,ota-account,hotel,observation,action,inventory,versioning}.ts
建 domain/ports/*.ts（只有接口签名）
建 domain/policy/*.ts（先只建 login-health 和 navigation-policy）
移 shared/browser.ts 的 SystemPreferences / CookieImport* 出去（它 74 行混了 4 个不相干的东西）
BrowserTab 加 otaAccountId
配 eslint 两条规则并实测语法
跑 npm run check
```

**先别修报错，把列表看一遍** —— 那就是完整的改造地图，比任何文档都准。预计集中在 `browser-manager.ts` 的 `create/list`、`browser-handlers.ts` 的入参、`BrowserWorkspace.svelte` 的状态合并。**如果报错出现在意料之外的地方，说明那里有未被识别的耦合，值得先搞清楚再动手。**

### 第 2–6 步

```text
2. ChannelManifest + 导航策略 → 删 renderer/data/ota-channels.ts，create() 不再收 URL
3. per-account 隔离 → SessionFactory，旧 partition 保留标记 legacy（不自动复制，你不知道那里面是谁的登录态）
4. 状态权威归 main → browser-state-store + 完整快照 + revision
5. 分库 + artifact store + 降级检测
6. Gateway 本地实现 → ToolRegistry → AgentRuntime → Codex 接入
```

**目录迁移与类型改造不能混做** —— 类型改造 touch 大量文件，叠加目录变更后 diff 无法审查。

### 每步的验证方式

| 步骤 | 怎么证明它没坏 |
|---|---|
| 0 | 启动不再自动打开携程；显式设环境变量后仍能跑 |
| 1 | `npm run check` 通过；eslint 规则能拦住 `domain/` 里 import electron |
| 2 | manifest 外的 origin 被拒；popup 到非白名单被拒 |
| 3 | 两个同渠道账号 partition 目录不同、cookie 不互通 |
| 4 | 杀进程重启后页签和活动账号恢复 |
| 5 | 降级检测抛错；迁移失败后库回到备份状态 |

按项目 CLAUDE.md 的测试粒度规则：迭代期只跑定向测试，完成态跑一次对应范围。

---

## 第六部分：仍然未决的事

本文**没有解决**以下问题，它们不阻塞第 0/1 步：

### 🔴 D2：MCP server 的形态

`forge.config.ts` 现有 `[FuseV1Options.RunAsNode]: false`，**会禁用 `ELECTRON_RUN_AS_NODE`**，订单来了那套"复用 Electron 二进制跑 MCP server"跑不通。

| 选项 | 代价 |
|---|---|
| 关掉 fuse | 降低安全性（应用可被当任意 Node 解释器滥用） |
| MCP 走进程内 | 失去进程隔离；但 harness 在本地，隔离价值有限 |
| 打包独立 Node | 体积 +40MB |

**在第 6 步前必须定。** 若走进程内，它就是普通模块，目录问题自动消失。另外未确认：MCP server 将来是否要给 rms 或其他客户端连？

### 🟡 D3：rms 后端术语未对齐

尚未阅读 `/Users/lishoubo/p/projects/xiaozhi-rms-workspace` 的接口定义。若 rms 门店不叫 `hotelId`，应以 rms 为准。**这会影响 Gateway 签名**，建议在第 6 步前解决。

### 🟡 D4 / 🟢 D5

一个 OTA 账号挂多店时如何定位当前门店（取决于目标客户是单体还是连锁）；`workspace` 一词的确切含义（留白，不借用它指代渠道或浏览器状态）。

### 一条产品约束（建议写进 `openspec/specs/`）

多篇调研反复得出同一结论但没有一处固化：

> 在没有官方渠道 API 的情况下，本产品对渠道数据的承诺是「巡检发现 + 异常提示 + 可验证的半自动执行」，不是「实时同步 + 防超售」。任何 UI 文案、销售材料和 Agent 回答都不得越过这条线。

这直接决定我们能对客户承诺什么。

---

## 第七部分：明确不做的事

| 不做 | 理由 |
|---|---|
| 方案 B（`app/` 分层） | 收益是"整洁"，可随时补做；目录是最容易反悔的决策 |
| 推倒重来换框架 | Electron/Svelte + 安全基线 + 测试都是资产，问题只在缺账号维度和缺 domain 层 |
| `modules/<name>/{domain,main,ui}` 三层嵌套 | 两个参照项目都没这么做，路径变长收益不明显 |
| 现在拆 `packages/` monorepo | 7378 行不值得 |
| 一次性大重构 | 6 步每步可独立验证，大爆炸重构没法回滚 |
| 现在就接 Codex | 工具层和上下文模型没建好，接了 agent 只能猜 DOM |
| ORM / 事件总线 / 渠道 adapter 抽象 | 只有"确定会有第二种实现"的地方才值得抽象，这三个不满足 |
| 为多租户预留字段 | 已确认不做，需要时加 mapping 层 |
| 跨店 fan-out | **架构上让它做不到**（`HotelExecutionScope` 只持有单个 `HotelId`，见 4.2 ⑥）。订单来了做了又关掉了，是强负面信号 |
| `browser_evaluate` 靠 prompt 约束 | prompt 约束对 prompt injection 无效。要么不提供，要么用代码限制 |

---

## 第八部分：验证说明

本文为**设计整合**，未修改任何代码，未移动目录，未运行构建、lint 或测试。

**本轮实际读取**：`docs/arch/` 下 6 份文档全文 —— glossary、current-architecture-change-plan、research-gaps（三份保留），以及 top-level-layout、target-directory-structure、STATUS（三份过程稿，结论已并入本文后**已删除**）；另读 `src/` 全量文件清单（119 个文件，TS + Svelte 共 7378 行）。

**继承自前几轮的实测事实**（本轮未重新验证）：
- 订单来了：`app.asar` 解包 51616 条路径、`config.toml`、`workspace-state.prod.json`、`Partitions/` 15 个目录、三个 sqlite schema
- Cherry Studio：GitHub API 全量目录树（**未阅读源码**，职责对应关系为目录树推断）
- rms：根目录与两级目录树

**未验证（动手前需实测）**：
- 本文所有代码片段为设计示意，**未编译**
- ~~`import/no-restricted-paths` 的 zones 语法与 `no-restricted-imports` 的 overrides 配置未在本仓库实测~~ → **已于 2026-08-03 实测通过**，见 3.5 节。composition root 那条因接口与实现同文件而暂缓，同节已说明
- 第 5 部分对 `tsc` 报错位置的预测是推断
- `RunAsNode` fuse 与独立进程 MCP 的冲突未实测（D2）
- `domain/ports/browser-port.ts` 的接口形状**尚无实现经验支撑**，落地时可能调整
- `resources/` 打包到 `Contents/Resources/` 的 Forge 配置写法未验证
- 环境为 Node v26.3.0，仓库要求 `>=24 <25`，本次未运行任何 npm 脚本
