# 决策变更日志

记录讨论过程中**推翻了 design.md 原文**的决策。design.md 待本轮待定项确认后统一改写；
在那之前，本文件优先级高于 design.md。

## 2026-08-08 第二轮讨论

### 变更 1：domain/ 从「保留」改为「删除」

design.md §5 决策 8 原文为「保留 domain」。**已作废。**

推翻理由（用户提出，已验证）：domain 是从服务端研发实践引入的，桌面端不适用。
Electron 主进程的复杂度在**集成**（窗口/文件/cookie/session/抓取/进程边界），
不在业务规则本身，不存在需要充血模型的 core domain。

实测证据 —— 四个 `createXxx` 构造器的校验是死代码：

```ts
// domain/ota-hotel.ts，49 行，唯一的"规则"：
export function createOtaHotel(input: OtaHotelCreateInput): OtaHotel {
  if (input.credentialId.length === 0) throw new InvalidOtaHotelError('credentialId 不能为空');
  return { ...逐字段拷贝... };
}
```

`credentialId` 的类型是 `OtaCredentialId`（branded），只能由 `toOtaCredentialId()`
产生，而那个函数已校验非空 → **该分支永远不可达**。
`ota-credential.ts` / `rms-hotel.ts` / `rms-ota-account.ts` 同一个模子。
四个文件约 165 行，净产出为零。

处置：删除 4 个 `createXxx` + 4 个 `InvalidXxxError`；纯类型挪去 `shared/`。

### 变更 2：ports/ 从「保留」改为「删除（保留 2 个例外）」

design.md §1 结构图与 §3 准入标准里的 `domain/ports/` **已作废**。

| 原 port | 实现数 | 处置 |
|---|---|---|
| `CalendarRepository` / `OtaCredentialRepository` / `OtaHotelRepository` | 各 1（SQLite） | **删接口**，service 直接依赖具体类 |
| `RmsHotelGateway` / `RmsOtaAccountGateway` | 2（mock + 待写的真实实现） | **保留**，挪至 `main/gateway/rms/types.ts` |
| `LoginUrlMatcher` / `HotelProbe` / `Discovery` | 各 3（携程/抖音/美团） | **保留**，挪至 `main/channels/types.ts` 就近定义 |

判据：接口的价值来自**当下就存在多个实现**，不是「将来可能换」。

✅ 已确认（2026-08-08，用户答复）：**rms 不会接管本地数据。**
三个 Repository 接口确定删除。同时 `domain/ports/repositories.ts` 文件头那段注释
（「抽这层不是为了将来换数据库，而是为了换存储位置 —— rms 接管后部分数据的权威会
挪到云端」）所述前提不成立，随文件一并删除。

### 变更 3：adapters/ 更名 gateway/，server/ 更名 server-client/

design.md §1 的 `main/adapters/rms/` **已作废**，改为：

```
main/
  gateway/rms/          RMS gateway：接口 + mock + 真实实现（待写）
  server-client/        tRPC 传输层（原 main/server/）
    trpc-client.ts  config.ts
```

- `gateway/`：项目里 `RmsHotelGateway` 等类名已在用这个词，目录与类名对齐
- `remote/` 未选用：它描述"位置在远端"，但 mock 不在远端，放进去别扭
- `server-client/`：原 `main/server/` 与 `apps/server/` 太易混淆；它是"访问 server 的客户端"
- 传输层不并入 `gateway/rms/`：`auth-handlers` 也在用它，有两个消费者

### 变更 4：domain 与 shared 的关系 —— 从「以后再合并」改为「不该合并」

design.md §4 决策 7 原文「本次不合并，留作独立变更」措辞不准。**改为：不该合并。**

实测 6 个 shared 文件与 domain 的重复情况：

| shared 文件 | 重复？ |
|---|---|
| `browser.ts`（138 行） | 否 —— `BrowserTab` 等只在 shared 定义 |
| `automation.ts` / `ipc-channels.ts` / `logging.ts` | 否 |
| `hotel-management.ts` | 部分（DTO vs 领域类型，角色不同） |
| `calendar.ts` | **是** —— schema 抄了一遍类型 |

只有 1/6 真重复。且 `BrowserTab` 是纯视图模型（没有 IPC 就没有它），合并会把它塞进
domain，反而弄脏。

### 变更 5：identity.ts 与 policy/ 的处置（基于业内惯例调研）

调研范围：TypeScript 编译器、Signal Desktop、VS Code、Element Desktop、Standard Notes、
Bruno、Joplin、Effect-TS、Next.js、Astro、Prisma。

**A. branded type 的归置**

| 项目 | 做法 |
|---|---|
| TypeScript 编译器 | `Path` 类型在 `types.ts`，构造器 `toPath()` 在 `path.ts` —— 跟着概念走 |
| Signal Desktop（Electron，最贴近本项目） | `ts/types/ServiceId.std.ts`：`PniString`/`AciString` + `isPniString()`/`toTaggedPni()` 同文件。目录 `types/`，文件名 = 概念名 |
| Effect-TS | 有 `Brand.ts`，但那是**库提供 branding 机制本身**，非应用归置自己的 ID |

在 TypeScript / Next.js / Astro / Prisma 四个仓库搜 `brand.ts` / `branded.ts` /
`nominal.ts` / `ids.ts` / `identity.ts` → **零命中**。
`identity.ts` 这一命名**无业内先例**。

结论：`domain/identity.ts` → **`main/ids.ts`**（单文件保留）。
- 不拆成 5 个概念文件：五个 ID 共用同一套 `assertValidIdentifier`，拆开要么重复要么再抽共享文件；规模到了再拆
- 不放 `shared/`：`toChannelId()` 会抛异常，放 shared 会让 renderer 能 import 到主进程边界构造器；
  且现有调用方（browser-manager / session-factory / cookie-import / database / channels / ipc）
  **全在主进程，renderer 零引用**

**B. `policy/` 目录 → 解散**

- 该词源自 Java/.NET/DDD（Evans 的 DDD 中 Strategy 又名 Policy，指**可插拔策略对象**，非纯函数集合）
- VS Code 确有 `src/vs/platform/policy/`，但指**企业 MDM 设备管理**
  （`/etc/vscode/policy.json`、`PolicyValueSource.NativeMdm`），与本项目用法无关，留着会误导
- Signal / Joplin / Element / Standard Notes / Bruno / Logseq 中 `rules/`、`policies/` 目录 **零命中**
- 真实惯例：Signal 用 `ts/util/` 下动词命名单函数文件（`isValidUuid.std.ts`，与
  `isCookieHostInScope` 形状一致）；VS Code 用 `base/common/` 下主题命名模块（`resources.ts`、`glob.ts`）

按调用方就近放置，去掉 `-policy` 后缀：

| 原文件 | 新位置 | 依据 |
|---|---|---|
| `policy/partition-policy.ts` | `main/browser/partition.ts` | 三个调用方（browser-manager / session-factory / ota-tab）中两个在 `browser/` |
| `policy/cookie-scope-policy.ts` | `main/cookie-import/cookie-scope.ts` | 本应被该模块调用（当前是死代码，见 D 批） |
| `policy/ota-channel-landing-url-policy.ts` | `main/channels/landing-url.ts` | 本就是渠道知识 |
| `policy/startup-automation-policy.ts` | `main/config.ts` 或调用点内联 | 18 行、读一次 env、单一调用方 |

**C. Electron 主进程分层的业内实况**（供后续参考）

六个受调研的 Electron 应用中**无一**有 identity/policy 分层。实际两个组织轴：
- 按运行环境：VS Code 的 `common/` `browser/` `node/` `electron-main/`；Signal 用文件名后缀 `.main.ts` `.std.ts`
- 按功能：Element Desktop 完全扁平（`auto-launch.ts` `protocol.ts` `updater.ts`）；Standard Notes 用 `Main/File/` `Main/Keychain/`

⚠ 调研的一条保留意见（已知悉并明确不采纳）：调研认为本项目 `domain/` 的零框架依赖约束
比受调研代码库强，建议保留 `domain/` 边界本身，仅调整其内部子结构。
**不采纳的理由**：删 `domain/` 的依据不是业内惯例，而是变更 1 的实测证据 —— 四个
`createXxx` 校验是死代码，这层在本项目未提供实际约束。零框架依赖这条约束改由 eslint
对 `main/ids.ts` 等具体文件强制，不需要一个目录来承载。

### 变更 6：IPC 层直连基础设施 —— 范围核实与批次顺序修正

实测违规 4 处（2 个文件）：

| # | 位置 | 依赖 | 性质 |
|---|---|---|---|
| 1 | `calendar-handlers.ts:51-63` | `CalendarRepository`，4 个 channel 全直接转发 | 纯 CRUD 转发 |
| 2 | `browser-handlers.ts:140` | `OtaCredentialRepository.listByChannel` | 单查询转发 |
| 3 | `browser-handlers.ts:142-179` | `BrowserCookieImporter` + `store` + `cookie-import` | **30 行业务编排长在 handler 里** |
| 4 | `auth-handlers.ts:64-90` | `TRPCClient` 直连远端 + `safeCall` 错误映射 + 登出时清 session cookie | **远端调用与事务长在 handler 里** |

第 4 条尤其需要抽出：登出是「先调远端、再清本地 cookie」的有序事务（`finally` 里的
`cookies.remove`），漏掉就是「远端已登出但本地 cookie 仍在」。写在 handler 里无法单独测试。

**批次顺序修正（原 tasks 的排序疏漏）**：删 ports 与补 service 有强顺序依赖，必须同批完成。

原本 `calendar-handlers.ts:3` import 的是**接口**（`CalendarRepository`），虽违反分层但未绑死实现。
若先删 ports 而不补 service，它会退化成 `import type { SqliteCalendarRepository } from '../database/...'`
—— **IPC 层直接 import SQLite 实现类**，比现状更糟。

修正后顺序（原 G 批提前，且内部严格有序）：

```
G1  CalendarService                    ← calendar-handlers 改为依赖它
G2  CookieImportService                ← 接管 browser-handlers 那 30 行编排
G3  SystemService                      ← 接管 systemPreferences / setLoginItemSettings
G4  AuthService（新增，原 tasks 漏列）  ← 接管 tRPC 调用 + 登出事务
G5  OtaCredentialService.listByChannel ← browser-handlers:140 改为走它
G6  拆 browser-handlers 为 4 个文件
G7  确认 ipc/ 已无任何 repository / 基础设施 import
G8  ← 此时才删 ports 接口，service 改为依赖具体 repository 类
G9  eslint no-restricted-paths 锁死
```

✅ 已确认（2026-08-08，用户答复）：**不允许 handler 直连，calendar 也包 `CalendarService`。**
即便那 4 个方法是纯转发。判据：只要允许一个例外，lint 规则就无法强制，规则不能强制等于没有。

### 变更 7：startup 归拢、config.ts 撤回、ids.ts 瘦身

**A. 新建 `main/startup/`，撤销原 `main/config.ts` 方案**

`ctrip-check-in-automation.ts`（开机用 CDP 抓携程首页 `#checkIn` 入住时间）与
`startup-automation-policy.ts`（是否启用的 opt-in 开关）是**一件事的两半**，现被拆在
`main/automation/` 与 `domain/policy/` 两处，中间隔着 `application.ts` 一行三元表达式。

归拢理由不是「都跟启动有关」，而是**这个开关是安全开关**：

> 历史上用的是 `HOTEL_BUTLER_DISABLE_STARTUP_AUTOMATION`（默认开、显式关），意味着任何
> 用户装上应用后开机即在**全局共享 session** 上、**无业务上下文**、**无人工审批**地对
> 携程执行一次自动化操作。反转成 opt-in 后，「什么都不配置」= 「什么都不做」。
> —— `startup-automation-policy.ts` 文件头注释

开关与被它控制的危险操作分开放，改 automation 的人看不到这段理由。

```
main/startup/
  ctrip-check-in.ts    原 automation/ctrip-check-in-automation.ts
  enabled.ts           原 policy/startup-automation-policy.ts（含上述历史注释）
```

`main/automation/` 目录消失。

**撤回 §变更 5 中「`startup-automation-policy.ts` → `main/config.ts`」的方案**：
`server-client/config.ts` 解析的是 server origin（`HOTEL_BUTLER_SERVER_URL` + 强制 HTTPS），
与启动自动化无关。两者唯一共同点是「都读环境变量」——**这正是 `policy/` 当初犯的错：
按技术手段相同分组，而非按讲同一件事分组**。`server-client/config.ts` 留在原地，不建 `main/config.ts`。

**B. `ids.ts` 留 `main/`，不放 `shared/`，并删两个死 ID**

用户问「ids.ts 可以放 shared 吗」→ 技术可行（纯 TS，不 import zod/electron），但：

| 事实 | 证据 |
|---|---|
| renderer 对 branded ID 零引用 | renderer 里的 `activeTabId`/`activeChannelId` 全是裸 `string` 局部变量 |
| `shared/` 目前零引用 identity | grep 六个 shared 文件无命中 |
| **`AppUserId` / `TabId` 是死代码** | 除定义处与自身测试外全项目零使用；`browser-manager.ts` 的 `activeTabId` 也是裸 `string`，未走 `toTabId()` |

结论：放 shared 收益为零，代价真实 —— `toChannelId()` 会抛 `InvalidIdentifierError`，
放进 shared 后 renderer 可 import 到这个主进程边界构造器；且违反 shared 的定义
（「存在的唯一理由是要跨 preload 边界」），会让 shared 退化成公共工具箱。

处置：`main/ids.ts`，**删除 `AppUserId` 与 `TabId`**（含其测试）。剩三个都会落磁盘：

| ID | 为什么需要校验 |
|---|---|
| `ChannelId` | 拼进 partition 名 |
| `OtaCredentialId` | 拼进 partition 名 |
| `OtaHotelId` | 数据库主键 |

86 行 → 约 65 行，且每个 ID 都能说出存在理由。

### 变更 8：测试投入策略（用户 2026-08-08 指示）

> 「降低测试，实在不行，出现问题进口修复。别浪费太多时间写测试，尤其是 UI、mock 测试」

对 tasks 的影响：

| 原任务 | 调整 |
|---|---|
| B2 registry 单测 | 保留（安全边界，一份实现一份测试，成本低） |
| D4 登出事务顺序测试 | 保留（有序事务，出错静默） |
| F3 广播时序回归测试 | 保留（历史踩坑，出错表现为永久错过探测） |
| F6 重写 ota-tab 测试 | **降级**：只覆盖 4 个 open 方法各 1 个 happy path，不做 mock 组合矩阵 |
| I4 重写 preload 测试 | **降级**：只留「schema 拦截非法返回值」1 个断言，不按 namespace 各留 1 个 |
| 其余重写项 | **默认不补新测试**，删掉即可；E2E + 类型检查兜底 |

保留的三处共同点：**锁的是「出错时不会立刻暴露」的行为**（安全校验、事务顺序、异步时序）。
其余靠 E2E 和 TypeScript 兜底，出问题再定点修。

## 待定项

（无。所有待定项已于 2026-08-08 讨论中确认。）

## 不受影响的部分

design.md 以下内容仍然有效，未被推翻：
§2 依赖方向、§4 决策 1-6、§6 全部代码骨架、§7 测试策略、§8 验收标准，
以及 tasks.md 的 A/B/C/E/F/G/H/I 批次划分（D 批需按上述变更改写）。
