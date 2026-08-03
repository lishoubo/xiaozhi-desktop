# 最终架构方案（整合版）

日期：2026-08-03
状态：**定稿**。已整合并取代 `top-level-layout` / `target-directory-structure` / `STATUS` 三份过程稿（已删除）
术语以 `2026-08-03-glossary-and-orderlaile-mapping.md` 为准

本文回答三件事：

1. **顶层与 `src/` 的最终目录**（合并两文，`src/` 保持在根目录）
2. **核心业务代码如何剥离框架影响** —— Electron、Codex、SQLite 都换得掉
3. **核心领域模型** —— 已拆出：[`2026-08-03-domain-model.md`](./2026-08-03-domain-model.md)

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
  openForAccount(otaAccountId: OtaAccountId, entryPoint: EntryPointId): Promise<TabId>;
  openForLogin(environment: 'prod' | 'dev', channel: ChannelId, entryPoint: EntryPointId): Promise<TabId>;
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

`open` 拆成两个方法，而不是保留旧的单一 `open(key: BrowserContextKey, ...)`：**账号已存在**时（`openForAccount`）partition 名字要查 `OtaAccount.partitionName`；**账号还不存在、正在走登录流程**时（`openForLogin`）partition 名字是当场生成的短id，两条路径拼 partition 的方式完全不同，硬塞进一个组合键参数会掩盖这个区别（详见 `2026-08-03-domain-model.md` §1.2 "已废弃 `BrowserContextKey`"）。两个方法都不收 URL —— URL 仍由 main 侧从 channel manifest 解析，P0-2（renderer 说打开哪就打开哪）在类型层面依然写不出来。

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
  async check(otaAccountId: OtaAccountId): Promise<LoginState> {
    const tab = await this.browser.openForAccount(otaAccountId, entryPoint);
    const probe = await this.browser.snapshot(tab, { mode: 'diff', maxDepth: 3 });
    return evaluateLoginState(toProbeResult(probe), previous, this.clock.now());
  }
}
```

判定规则（"看到登录框 = 未登录"、"cookie 过期但页面正常 = unknown"）在 domain，可以穷举测试；"怎么拿到页面"在 main。

**错误的写法**是把 `evaluateLoginState` 写在 `LoginHealthChecker` 里 —— 那样测一个判定规则就要起 Electron。

---

## 第四部分：核心领域模型

**已拆出独立文档：[`2026-08-03-domain-model.md`](./2026-08-03-domain-model.md)**

本文原第四部分（224 行）随模型细化持续增长，与「目录结构 / 框架剥离 / 执行顺序」是两种变更节奏，故独立维护。那份文档包含：

| 节 | 内容 |
|---|---|
| §1 | branded type、`ChannelId` 的取值约定、转换函数的校验要求 |
| §2 | 八个核心模型（含 `OtaCredential`/`OtaAccount`、`HotelExecutionScope`） |
| §3 | 五个 Gateway 与 token 硬约束 |
| §4 | 版本号（domain 与 storage 分置）、四条升级规则 |
| §5 | 三类数据分库、migration 的组织 |
| §6 | 审计表 |
| §7 | **现存缺陷 D1–D3**（代码实读结论，待修） |


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
| 跨店 fan-out | **架构上让它做不到**（`HotelExecutionScope` 只持有单个 `HotelId`，见领域模型 §2.6）。订单来了做了又关掉了，是强负面信号 |
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
