# 当前架构调整方案

日期：2026-08-03
输入：当前 `src/` 全量代码 + 前三份评审文档
重点：升级（桌面 app 特有）、Codex 抽象、存储

前置文档：
- `docs/arch/2026-08-03-glossary-and-orderlaile-mapping.md`（**术语定稿，以此为准**）
- `docs/ORDERLAILE_ARCHITECTURE_REVIEW.md`（P0/P1/P2 问题清单）
- `docs/arch/2026-08-03-harness-and-architecture-review.md`（harness 选型 + 账号体系）
- `docs/arch/2026-08-03-research-gaps-and-backend-abstraction.md`（5 个 Gateway）

本文不重复上述内容，只讲**当前代码要怎么改**。

---

## 0. 当前代码的真实状态

先说结论：**代码质量比我预期的好，问题不在写得烂，在于它是按"浏览器书签工具"建模的，而我们要做的是"多账号执行平台"。**

39 个提交，`src/` 约 100 个文件。做得对的地方（这些不要动）：

- Electron 安全基线完整：fuses 全开（`RunAsNode: false`、`OnlyLoadAppFromAsar`、ASAR 完整性校验）、`sandbox: true`、`contextIsolation: true`、主窗口禁止导航和开窗
- **IPC 双向校验**：main 侧 `assertTrusted` 比对 sender + zod 校验入参；preload 侧还对**返回值**再校验一次（`invokeValidated`）。这个双向校验做得比大多数 Electron 项目好
- **数据库已有迁移框架**：`schema_migrations` 表 + 版本化 `migrations` 数组 + 事务包裹，这是个正确的地基
- 三层测试（unit/component/e2e）已存在

真正的问题只有一句话：**所有抽象都缺一个维度——账号。**

```ts
// src/main/browser/browser-manager.ts:24
session.fromPartition('persist:hotel-butler-browser')   // 全局唯一

// src/shared/browser.ts
BrowserTab = { id, channelId, title, url, ... }         // 没有 otaAccountId

// src/main/ipc/browser-handlers.ts:91
manager.browserSession.cookies.set(cookie)              // 全部写进同一个 session
```

这不是 bug，是当初就没这个概念。所有 P0/P1 问题都是这一件事的不同表现。

---

## 1. 升级：桌面 app 最容易做错的地方

你特别点了升级，这块确实是当前**完全空白**且**最难补救**的——`forge.config.ts` 里没有任何 updater，`package.json` 里也没有。

### 1.1 为什么这块必须现在想清楚

桌面 app 和 web 的根本区别：**你无法保证所有用户在同一个版本上。**

Web 改个 schema，发布完所有人就是新版。桌面 app 改个 schema，会同时存在：

```text
v1.0 用户（从没更新过）
v1.3 用户（更新了但没重启）
v1.5 用户（最新）
```

而这三个版本的**用户数据在同一台机器上、同一个 SQLite 文件里**。更糟的是，用户可能降级（从 dmg 装回老版本）。

我们的场景还叠加了三个桌面 app 里最难升级的东西：

| 东西 | 为什么难 |
|---|---|
| **Chromium partition** | 里面是 OTA 登录态。升级弄丢 = 用户全渠道重新登录 = 灾难 |
| **Codex runtime** | 独立于 app 的版本，有自己的 thread schema |
| **native module（better-sqlite3）** | Electron 版本变了要重编译，ABI 不匹配直接崩 |

### 1.2 五类需要独立版本号的东西

**现在就要定，因为它们的升级节奏完全不同：**

```ts
// src/shared/versioning.ts
export const SCHEMA_VERSIONS = {
  appDatabase:    2,   // SQLite schema（已有，当前 = 2）
  browserState:   1,   // 页签/账号状态（还不存在，要建）
  channelManifest:1,   // 渠道配置（还不存在）
  partitionLayout:1,   // partition 命名规则
  agentSession:   1,   // 会话归一化存储
} as const;
```

关键在 `partitionLayout`：**partition 命名一旦发出去就固化在用户磁盘上了**。将来要改名（比如加 mapping 层），必须知道当前用户是哪个布局版本，才能决定要不要迁移。

这就是你上一轮说的"实在不行后面可以加一层 mapping"——那层 mapping 需要一个版本号来触发。

### 1.3 数据迁移的三条硬规则

现有 `application-database.ts` 的迁移框架是对的，但缺三条约束：

**规则 1：迁移必须可前滚，不可回滚 —— 所以要挡住降级**

```ts
// 启动时
const dbVersion = readSchemaVersion(database);
if (dbVersion > SCHEMA_VERSIONS.appDatabase) {
  // 用户装了新版又装回老版
  throw new AppDowngradeError(dbVersion, SCHEMA_VERSIONS.appDatabase);
}
```

现在的代码不检查这个——老版本打开新版本的库，会因为不认识的表/列产生**静默的错误行为**，比崩溃更糟。

**规则 2：迁移前自动备份，失败自动回滚**

```ts
// 有待应用的迁移时
await fs.copyFile(dbPath, `${dbPath}.backup-v${currentVersion}`);
try {
  migrate(database);
} catch (e) {
  database.close();
  await fs.copyFile(`${dbPath}.backup-v${currentVersion}`, dbPath);
  throw new MigrationFailedError(e);  // 让用户看到，而不是数据损坏
}
```

现有代码的 `migrate()` 是事务包裹的，单条迁移是原子的。但**多条迁移之间不是**——迁移 3 成功、迁移 4 失败，库就停在中间态。备份是唯一的兜底。

**规则 3：partition 永远不删，只标记**

```text
升级要改 partition 命名时：
  ❌ 删旧的、建新的         → 用户全渠道掉线
  ✅ 建新的、旧的标记 legacy → 用户无感知，旧数据留作回退
```

磁盘空间是最便宜的东西，OTA 登录态是最贵的。

### 1.4 更新机制的选型

不用 `update-electron-app`（它绑定 GitHub Releases，国内下载慢）。建议：

```text
electron-updater + 自建更新服务（走 rms 后端或独立 CDN）
```

三条约束：

1. **强制签名验证。** 桌面 app 的更新通道是最高价值的攻击目标——攻破它等于在所有客户机器上执行任意代码。macOS 要 codesign + notarize，Windows 要代码签名证书。**这笔钱不能省。**
2. **灰度能力。** `release-runtime-config.json`（订单来了的做法）下发 `releaseEnv` / 灰度比例，先推 5% 用户。桌面 app 的坏更新召回成本极高。
3. **更新不能强制打断正在执行的任务。** 正在跑改价任务时弹窗重启 = 状态不明的写操作。要等任务队列排空。

### 1.5 native module 的坑

`forge.config.ts` 里已经有 `packageAfterCopy` hook 手工拷贝 `better-sqlite3` + `node-addon-api`，并配了 `AutoUnpackNativesPlugin`。这说明已经踩过一次坑了。

要补的：**升级 Electron 大版本时，native module 必须重编译**。建议在 CI 加一条冒烟测试——打包产物启动后能成功打开数据库。否则用户升级后直接白屏。

---

## 2. Codex 抽象：怎么落到当前代码

### 2.1 目录结构

```text
src/main/agent/
  agent-runtime.ts          ← 接口，不 import 任何 codex 相关模块
  agent-event.ts            ← 归一化事件类型
  session-store.ts          ← 我们自己的会话存储（双写）
  codex/
    codex-agent-runtime.ts  ← AgentRuntime 的 codex 实现
    codex-config-writer.ts  ← 生成 config.toml（从 ModelGateway 取端点）
    codex-process.ts        ← 进程生命周期
  tools/
    tool-registry.ts        ← 工具真身在这里
    tool-policy.ts          ← RiskLevel 分级、审批、超时
    browser-capability.ts
    context-capability.ts
  mcp/
    mcp-adapter.ts          ← 把 ToolRegistry 暴露给 harness
    bridge-server.ts        ← unix socket，照抄订单来了的 bridge.sock
```

依赖方向（用 eslint `no-restricted-imports` 强制）：

```text
renderer   →  只认 AgentEvent，不知道 codex 存在
tools/     →  不 import agent/codex/**
codex/     →  可以 import agent-runtime.ts、tools/（通过 registry 接口）
```

### 2.2 Codex runtime 的版本管理（升级议题的一部分）

订单来了的做法是把 runtime 放在 app 外面：

```text
~/.smartorder/                          ← runtime home，独立于 app
/Applications/订单来了.app/Contents/Resources/codex-primary-runtime/latest/
  darwin-arm64/LATEST.json              ← 版本指针
```

**这个设计要抄，理由是解耦升级节奏**：app 更新和 runtime 更新可以分开。runtime 有 bug 时不用发整个 app。

对我们：

```text
~/.xiaozhi/                    ← agent runtime home
  config.toml                  ← 每次启动重新生成，不手工编辑
  sessions/                    ← codex 自己的 rollout
  state.sqlite                 ← codex 自己的 thread 存储

<userData>/xiaozhi.sqlite      ← 我们自己的库（含 agent_session 双写）
<userData>/Partitions/         ← OTA 登录态
```

**关键约束：`config.toml` 每次启动由 `codex-config-writer.ts` 重新生成，不读取用户手工修改。** 否则用户改了 `sandbox_mode` 或 `approval_mode`，我们的安全模型就被绕过了。

### 2.3 会话双写的最小形态

上一份文档提过，这里给落地版本。**只存归一化的元数据，不复制 codex 的 rollout 内容**：

```sql
CREATE TABLE agent_session (
  id              TEXT PRIMARY KEY,
  harness         TEXT NOT NULL,     -- 'codex' | 'claude-agent-sdk'
  harness_thread_id TEXT NOT NULL,   -- ← 换 harness 后老会话仍可读
  app_user_id     TEXT,              -- 照抄订单来了的 session-owners
  hotel_id        TEXT,
  channel         TEXT,
  ota_account_id  TEXT,
  model           TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  status          TEXT NOT NULL
);

CREATE TABLE agent_tool_call (
  session_id      TEXT NOT NULL REFERENCES agent_session(id),
  call_id         TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  risk_level      TEXT NOT NULL,
  args_redacted   TEXT NOT NULL,     -- ← 脱敏后
  approved_by     TEXT,              -- null = 自动执行
  result_summary  TEXT,
  at              TEXT NOT NULL,
  PRIMARY KEY (session_id, call_id)
);
```

`agent_tool_call` 比 `agent_message` 更重要——**它是审计的载体**。出了问题要能回答"谁在什么时候用什么参数改了什么"，光有对话内容答不了。

---

## 3. 存储：当前最需要重新设计的地方

### 3.1 现状与问题

`<userData>/hotel-butler.sqlite` 现在只有 `calendar_groups` / `calendar_events` 两张表 + `schema_migrations`。迁移框架是对的，但有三个问题：

**问题 1：mock 数据混在生产代码路径里**

```ts
// application-database.ts
synchronizeMockData(database, options.includeMockData === true);
// application.ts
{ includeMockData: !app.isPackaged }
```

`hotel-operations-mock.ts` 和 `china-holidays.ts` 都被 main 进程直接 import。虽然靠 `isPackaged` 挡住了，但**mock 数据的代码仍然被打进产物**。建议把 mock seed 移到 `tests/` 或独立的 dev-only 入口。

**问题 2：没有区分三类数据的存储策略**

```text
① 配置类   —— 渠道 manifest、用户偏好      → 少、稳定、可丢
② 状态类   —— browserState、登录态           → 中、频繁变、丢了要重登
③ 事实类   —— observation、订单、任务、审计 → 多、只增、绝不能丢
```

这三类的备份策略、迁移策略、清理策略完全不同。现在混在一个库里没关系（数据少），但 observation 一上来（每天几千条），③ 会淹没 ①②，备份和迁移都会变慢。

**建议：现在就分库。**

```text
<userData>/
  app.sqlite        ← ①② 配置和状态，小、迁移频繁、每次迁移前备份
  facts.sqlite      ← ③ 事实和审计，大、只增、按时间分区清理
  artifacts/        ← 截图/HTML/trace，文件系统而非数据库
```

分库的成本现在几乎为零（一个 `openDatabase` 变两个），以后再分要动所有 repository。

**问题 3：artifact 存储完全没有设计**

采集证据（截图、HTML 快照、网络日志）不能进数据库——一张截图几百 KB，几千条就是几个 GB 的 SQLite。而这些证据是 `ChannelObservation.evidence` 的必需品。

```text
artifacts/<yyyy-mm>/<observationId>/
  screenshot.png
  snapshot.html
  network.jsonl
```

配套要有：**保留期策略**（默认 30 天）、**脱敏后才能导出**、**总容量上限**（超了删最旧的）。桌面 app 把用户磁盘塞满是真实会发生的事故。

### 3.2 workspace state 存哪

订单来了用 JSON 文件（`workspace-state.prod.json`）。我建议**用 SQLite 而不是 JSON**，理由：

- JSON 文件全量重写，进程崩溃时容易写坏（订单来了有 `global-store.json.bak` 就是在防这个）
- 我们已经有 SQLite 和迁移框架了，不用再建一套版本管理
- 页签状态变化频繁，SQLite 的增量写更合适

放在 `app.sqlite` 里，schema 版本走 `browserState` 那个号。

---

## 4. 改造顺序

原则：**每一步都能独立验证、独立回滚，不做大爆炸重构。**

### 第 0 步：立刻做的一件事（1 行）

```ts
// application.ts:37
const automationDisabled = process.env.HOTEL_BUTLER_DISABLE_STARTUP_AUTOMATION === '1';
```

改成 opt-in：

```ts
const automationEnabled = process.env.HOTEL_BUTLER_ENABLE_STARTUP_AUTOMATION === '1';
```

理由（上一份文档已提，这里重申）：`CtripCheckInAutomation` 现在**开机自动执行、跑在全局共享 session 上、无上下文、无审批**，还用了 `debugger.attach` + `Runtime.evaluate`。它同时踩了 P0-1、P1-1 和 RiskLevel 缺失三个问题。

### 第 1 步：类型层加账号维度（不改行为）

纯类型 + schema 改动，先让编译器把所有需要改的地方指出来：

```ts
// src/shared/identity.ts —— 新建
export type ChannelId  = string & { readonly __brand: 'ChannelId' };
export type OtaAccountId = string & { readonly __brand: 'OtaAccountId' };
export type HotelId      = string & { readonly __brand: 'HotelId' };

export type BrowserContextKey = {
  environment: 'prod' | 'dev';
  channel: ChannelId;
  otaAccountId: OtaAccountId;
};
```

用 branded type 而不是裸 `string`，编译器才能拦住"把 channelId 传给 otaAccountId 参数"这类错误。

然后 `BrowserTab` 加 `otaAccountId`，`browserCreateInputSchema` 改成接收 `BrowserContextKey` 而非裸 `url`。

**这一步 `tsc` 会报一堆错，那正是我们要的地图。**

### 第 2 步：ChannelManifest + 导航策略

新建 `src/main/browser/channel-manifest.ts`。现有 `src/renderer/data/ota-channels.ts` 里的渠道定义**从 renderer 移到 main**——renderer 不应该是渠道配置的权威。

`create()` 不再接收 renderer 给的 URL，改为接收 `(contextKey, entryPointId)`，URL 由 main 从 manifest 解析。这样 P0-2 从根上解决：**renderer 没有能力指定任意 URL。**

### 第 3 步：per-account 浏览器上下文隔离

```ts
class SessionFactory {
  // partition 字符串的拼接只在这一处，且是私有方法
  private toPartition(key: BrowserContextKey): string {
    return `persist:xiaozhi:${key.environment}:${key.channel}:${key.otaAccountId}`;
  }

  // 业务层只调这个，永远不接触 partition 字符串
  sessionFor(key: BrowserContextKey): Session { /* ... */ }
}
```

**约束：除 `SessionFactory` 外，任何文件不得出现 `partition` 字样，也不得手工拼接该字符串。** 见 `2026-08-03-glossary-and-orderlaile-mapping.md` §1.3。`partition` 是 Electron 的 API 术语，保留但不外泄——业务层一律用 `BrowserContextKey` 定位。

迁移：旧的 `persist:hotel-butler-browser` **保留不动**，标记为 legacy。新账号用新命名。给用户一个"从旧配置导入"的入口，让他们逐个渠道确认归属。

**不要自动把旧 session 复制到多个账号**——你不知道那里面是谁的登录态。

### 第 4 步：状态权威归 main + 持久化

现在 `BrowserWorkspace.svelte` 自己维护 `tabsByChannel` / `activeTabIds`，靠逐条 `stateChanged` 事件合并（P1-2）。改成：

- main 持有完整 `browserState`，写入 `app.sqlite`
- renderer 只消费**完整快照**（带 revision），不再自己合并增量
- 启动时 main 读库重建视图

### 第 5 步：分库 + artifact store

按 3.1 拆 `app.sqlite` / `facts.sqlite` / `artifacts/`，加降级检测和迁移备份。

### 第 6 步及以后

Gateway 接口 → ToolRegistry → AgentRuntime → Codex 接入。这些在前面的文档里已有设计，此处不重复。

---

## 5. 每步的验证方式

| 步骤 | 怎么证明它没坏 |
|---|---|
| 0 | 启动不再自动打开携程；显式设环境变量后仍能跑 |
| 1 | `npm run check` 通过；无运行时行为变化 |
| 2 | 新增测试：manifest 外的 origin 被拒；popup 到非白名单被拒 |
| 3 | 新增测试：两个同渠道账号 partition 目录不同、cookie 不互通 |
| 4 | 新增测试：杀进程重启后页签和活动账号恢复 |
| 5 | 新增测试：降级检测抛错；迁移失败后库回到备份状态 |

按项目 CLAUDE.md 的测试粒度规则：迭代期只跑定向测试，完成态跑一次对应范围。

---

## 6. 我认为不该做的事

| 不做 | 理由 |
|---|---|
| 推倒重来换框架 | Electron/Svelte + 安全基线 + 测试都是资产，问题只在缺账号维度 |
| 一次性大重构 | 6 步每步可独立验证，大爆炸重构没法回滚 |
| 现在就接 Codex | 工具层和上下文模型没建好，接了 agent 只能猜 DOM（P1-3） |
| 为多租户预留字段 | 已确认不做，需要时加 mapping 层 |
| 抽象存储层（Repository 接口） | SQLite 是最终选择，不会有第二种实现 |
| 现在写 Gateway 的 rms 实现 | 先定接口 + 本地实现，rms 接入按 ②→③→④ 顺序 |

---

## 7. 验证说明

本文为静态代码审查 + 设计建议。**未修改任何代码，未运行构建或测试。**

实际读取：`package.json`、`forge.config.ts`、`src/main/application.ts`、`src/main/browser/browser-manager.ts`(前 80 行)、`src/main/database/application-database.ts`(全)、`src/main/calendar/calendar-repository.ts`(前 60 行)、`src/main/ipc/browser-handlers.ts`(全)、`src/main/automation/ctrip-check-in-automation.ts`(前 100 行)、`src/main/windows/*.ts`、`src/preload/api.ts`(全)、`src/shared/browser.ts`、`src/shared/ipc-channels.ts`、`src/shared/automation.ts`、`src/renderer/components/browser/BrowserWorkspace.svelte`(前 60 行)、`tests/` 目录清单。

grep 确认：仓库内**无** `autoUpdater` / `electron-updater` / `update-electron-app` 任何引用。

未验证：
- 本文所有代码片段为设计示意，**未编译、未运行**
- 改造顺序的工作量估算未做
- `electron-updater` 与当前 Forge 配置的兼容性未验证
- 环境为 Node v26.3.0，仓库要求 `>=24 <25`，本次未运行任何 npm 脚本
