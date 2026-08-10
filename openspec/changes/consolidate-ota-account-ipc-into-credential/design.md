## Context

当前 `IPC_CHANNELS.otaAccount.*` 下有 6 个方法，逐一核实过 renderer 调用情况：

| 方法 | 调用点 | 返回值/参数类型 |
|---|---|---|
| `startLogin` | `BrowserWorkspace.svelte:82` | 参数 `StartLoginInput`，返回 `BrowserTab` |
| `createFromCookie` | `BrowserWorkspace.svelte:228`、`CookieLoginListDialog.svelte:71` | 同上 |
| `onAccountBound` | `BrowserWorkspace.svelte:384`，回调内只调用 `loadCredentials()` 刷新 `OtaCredential` 列表 | 事件参数 `{ channel }` |
| `listByChannel` | 仅 `SelectOtherHotelPanel.svelte:48`，该组件无任何父组件引用 | 返回 `OtaAccountDto[]` |
| `openExisting` | 无 | 参数 `accountId`，返回 `BrowserTab` |
| `createFromExistingSession` | 无 | 参数 `accountId`，返回 `BrowserTab` |

`otaCredential.*` 现有 2 个方法（`listByChannel`、`openExisting`），均有调用点，均真实
操作 `OtaCredential` 记录，命名和行为一致，本次不改动。

`SelectOtherHotelPanel.svelte` 唯一被 `AccountsNav.svelte` 引用，而
`AccountsNav.svelte` 本身在整个 `apps/desktop/src/renderer` 内无任何引用点——两者构成
一条完整的孤儿链，不在可达渲染路径上。

## Goals / Non-Goals

**Goals:**
- 保留的 3 个方法迁移到 `otaCredential.*`，方法名按其真实行为重新命名，不做"原样平移
  只换前缀"式的表面重构。
- 删除确认无调用点的 3 个死代码方法及其唯一来源的 2 个孤儿组件，一次性清理完，不留
  deprecated 过渡期。
- 迁移过程中参数/返回值的运行时校验（zod schema）、handler 内部实现逻辑保持不变，只动
  IPC 频道名、方法名、方法归属的命名空间。

**Non-Goals:**
- 不改变 `startLogin`/`createFromCookie` 触发登录后的探测、归并、落库行为
  （`DiscoverAndCreate` 内部逻辑不动）。
- 不实现"发现其他酒店"这类依赖 `OtaAccount` 读取的新 UI——`otaAccount.listByChannel`
  被删除后，若未来需要恢复类似功能，应作为独立需求重新设计入口和交互，不在本次范围内
  用兼容手段保留旧接口。
- 不涉及第 7 节文档讨论的 `TabEventBus`/`OtaTabOpener`/Feature 拆分（那是更大范围的
  重构，属于后续独立改动）。

## Decisions

**决策 1：按真实行为重命名，不是同名迁移命名空间**

| 旧名 | 新名 | 理由 |
|---|---|---|
| `otaAccount.startLogin` | `otaCredential.openForNewLogin` | 该方法新建一个干净登录环境、打开渠道登录页，语义是"为一次新登录打开标签页"，不是"创建账号" |
| `otaAccount.createFromCookie` | `otaCredential.openWithImportedCookie` | 新建环境并注入已导入 Cookie 后打开页面，语义是"用已导入的 Cookie 打开登录页"，同样不创建账号记录 |
| `otaAccount.onAccountBound` | `otaCredential.onDiscoveryCompleted` | 触发点是 `DiscoverAndCreate` 完成一次探测（Credential 归并 + Account upsert）之后，事件唯一消费者只用它刷新 `OtaCredential` 列表；`accountBound` 这个名字暗示"账号绑定"，但实际语义是"一次探测流程结束"，改名更准确 |

考虑过的替代方案：保持方法名不变，只把它们移到 `otaCredential.*` 命名空间下（例如
`otaCredential.startLogin`）。放弃原因：`startLogin` 挂在 `otaCredential` 下仍然让人
误以为在操作登录凭据记录本身，而它实际是"打开一个标签页"这个机制层动作；单纯换前缀
没有解决命名和行为脱节的根本问题，等于把同一个混淆搬到了另一个命名空间下。

**决策 2：死代码直接删除，不标记 deprecated 过渡**

`listByChannel`/`openExisting`/`createFromExistingSession` 已核实在当前 renderer
代码中无任何调用点（`openExisting`/`createFromExistingSession` 从未被调用；
`listByChannel` 唯一调用方是孤儿组件）。这是纯内部 IPC 契约，不对外发布、没有第三方
消费者，没有必要保留过渡期或兼容层——按 CLAUDE.md"删除废弃代码，不留注释掉的实现"
的既定原则直接删除。

**决策 3：`domain`/`repository`/SQLite 实现层完全不动**

`OtaAccount` 模型、`OtaAccountRepository` 接口、`SqliteOtaAccountRepository` 实现
继续保留——`DiscoverAndCreate.upsertAccount()` 仍然依赖它们持续写入。本次改动的边界
严格限定在"对外 IPC 暴露面"，不触碰持久化模型或探测/归并逻辑，因此不改变系统对外行为，
不需要 spec delta（已在 proposal.md 中说明，`.openspec.yaml` 设置 `skip_specs: true`）。

## Risks / Trade-offs

**[风险] 迁移遗漏某个隐藏调用点导致运行时报错** → **缓解**：改动前已用
`grep -rn "hotelButler\.otaAccount\."` 对 `apps/desktop/src/renderer` 做过全量核实，
确认调用点只有 `BrowserWorkspace.svelte`（3 处）和 `CookieLoginListDialog.svelte`
（1 处）；tasks.md 中会要求在改动完成后再跑一次同样的 grep 确认无残留引用。

**[风险] 删除孤儿组件时误删仍有价值的代码** → **缓解**：`SelectOtherHotelPanel.svelte`
和 `AccountsNav.svelte` 的"孤儿"状态已用 `grep -rln` 反向核实（搜索文件名本身在全仓库
的引用情况，不止搜索方法调用），确认两者互相引用但均无外部引用点。

**[风险] renderer 侧的 IPC 调用是异步的，改名后如果新旧方法名同时存在一段时间容易造成
认知混乱** → **缓解**：一次性提交完成新增+删除+调用点更新，不做分阶段的双写/双读，
避免中间状态。

## Migration Plan

单次提交完成，不需要分阶段发布或数据迁移（不涉及数据库 schema 变更，只涉及内部 IPC
契约和渲染层调用代码）。回滚策略：这是一次纯代码改动，出现问题直接 `git revert` 整个
提交即可，没有需要额外处理的运行时状态。
