## Context

动机见 `proposal.md`。这里只记录约束现状。

**当前依赖方向**（`services/` 与 `ota-tab/` 之间存在一条反向边）：

```
ota-tab/login-detector.ts ──import──> services/tab-event-bus.ts    ← 唯一发射方在 ota-tab
                                            ▲
                          services/ota-hotel-prob-service.ts ──┘   ← 订阅方在 services
```

`services/` 下没有任何 service 发射这条总线。`grep tab-event-bus` 的全部结果：

| 文件 | 角色 |
|---|---|
| `ota-tab/login-detector.ts` | **发射**（唯一） |
| `services/ota-hotel-prob-service.ts` | 订阅 |
| `composition/window-scope.ts` | 装配 |
| 3 个测试文件 | 测试 |

**`channels/` 现有对外依赖**（`grep` 全量结果）：`shared/logging`、`shared/types/json`、`shared/types/ota-credential`、`main/ids`、`electron`（仅 `WebContents` 类型）、`zod`。已经零 `services/` 依赖——本次是把这个既成事实写进 lint，而非新增约束。

**关键约束：**

| 约束 | 来源 |
|---|---|
| 广播必须晚于 credential 写库完成 | `login-detector.ts` 时序注释（携程只导航一次，错过即永久错过） |
| 实现类只能在 composition root 装配 | `.eslintrc.json` `no-restricted-imports` |
| 边界必须由 lint 强制，不能只写在散文或注释里 | `desktop-main-layering` spec 首条要求 |
| `channels/` 可依赖 `electron` 类型 | 探测要操作页面，`WebContents` 绕不开；仅类型，无运行时调用 |

## Goals / Non-Goals

**Goals:**

- 总线与其唯一发射方同居，消除 `ota-tab/ → services/` 这条反向边
- 探测调度器落到它调度的实现旁边（`channels/`）
- `channels/` 的依赖约束由 lint 强制，而非仅靠注释与自觉

**Non-Goals:**

- 不改任何运行时行为：事件契约、广播时机、探测触发条件、日志内容全部不变
- 不接通绑定流程（intent、notifier、弹窗）——Change 3
- 不动 `channels/<渠道>/` 内部实现
- 不引入 `channels/prob/` 这类按能力切分的目录（见决策 3）

## Decisions

### 决策 1：总线归位到 `ota-tab/`

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. 留在 `services/` | 零改动 | 唯一发射方在 `ota-tab/`，位置与归属不符；`channels/` 想订阅就必须依赖 `services/`，与约束冲突 | ✗ |
| B. 移入 `ota-tab/` | 与唯一发射方同居；`ota-tab/` 成为自洽模块（开 tab → 观察 → 判定 → 广播）；解开 `channels/` 的订阅死结 | 需改 6 处 import | **✓** |
| C. 提到独立的 `events/` 目录 | 中立 | 为一条总线新建一层；且它本就属于 tab 生命周期，不是通用事件设施 | ✗ |

移动后依赖方向变为单向：

```
ota-tab/  ──(发射 + 导出)──> tab-event-bus
   ▲                              │
   │                        (订阅)│
channels/hotel-probe-dispatcher ──┘
```

`ota-tab/index.ts` 增加导出，`channels/` 只依赖这个公开面，不 import 具体文件路径。

### 决策 2：`OtaHotelProbService` → `channels/hotel-probe-dispatcher.ts`

改名理由：它不拥有探测逻辑（那在 `channels/<渠道>/hotel-prob.ts`），只做分发。叫 `Service` 会让人以为业务在里面。

职责逐条核对（Change 1 剥离 repository 后的残留）：

| 职责 | 去留 | 为什么不能下沉到 `channels/<渠道>/` |
|---|---|---|
| 订阅 `tab:credential-checked` | 留 | 单个渠道适配器不该认识总线 |
| `probes.get(channel)` 选渠道 | 留 | 跨渠道分发，注册表投影 |
| `isProbeableUrl` 判断 | 留 | 薄，与选渠道同处 |
| try/catch + 日志 | 留 | 渠道适配器不决定错误怎么记 |
| 调 `probe()` | 留 | — |

剩下约 30 行,是**薄适配层**而非业务对象。

放 `channels/` 而非 `services/` 的理由:探测与浏览器强相关(注入脚本、拦截响应、解析 DOM——见 `douyin/dsl-get-response-capture.ts` 6.8K、`meituan/poi-infos.ts` 3K),且后续触发源不止一种(用户绑定意图、后台自动爬取)。它是渠道能力的调度器,不是业务编排。

### 决策 3：不建 `channels/prob/` 目录

`channels/` 现在按**渠道**切分（`ctrip/` `douyin/` `meituan/`），每个渠道下放它的各种能力（`hotel-prob.ts` `login-url-matcher.ts` `discovery.ts` `account-identity.ts`）。

新建 `channels/prob/` 会变成按**能力**切分，两种切法混用，之后每加一个能力都要纠结放哪。dispatcher 作为跨渠道的单文件，平铺在 `channels/` 根部即可（与 `registry.ts`、`types.ts`、`landing-url.ts` 同级）。

### 决策 4：eslint zones 的写法

现有 `import/no-restricted-paths` 只有三条 zone（shared/renderer 方向），没有针对 `channels/` 的。本次补齐：

```jsonc
{
  "target": "./src/main/channels",
  "from": "./src/main/services",
  "message": "channels/ 是被注入的渠道适配器，不得反向依赖 services/；需要什么就注入窄回调"
},
{
  "target": "./src/main/channels",
  "from": "./src/main/database",
  "message": "channels/ 不直接落库；持久化由 composition root 注入的回调完成"
},
{
  "target": "./src/main/channels",
  "from": "./src/main/gateway",
  "message": "channels/ 不直接访问远端网关；需要什么就注入窄回调"
},
{
  "target": "./src/main/channels",
  "from": "./src/main/ipc",
  "message": "channels/ 不认识 IPC 边界"
},
{
  "target": "./src/main/channels",
  "from": "./src/main/composition",
  "message": "channels/ 不得依赖装配层（依赖方向是 composition → channels）"
}
```

**不加** `ota-tab/` 的禁令——那是本次特意放行的唯一外部依赖（决策 1）。`import/no-restricted-paths` 是白名单外全禁的反义（默认允许、显式禁止），所以「允许 `ota-tab/`」体现为不写这条 zone，需在 spec 与注释中说明这是有意为之，而非遗漏。

| 方案 | 结论 |
|---|---|
| A. 五条 zone 分别写明 message | **✓** 违规时提示精确，能直接告诉开发者该怎么改 |
| B. 一条 zone 用数组 from | ✗ eslint 的 `from` 支持数组但共用一条 message，丢失「该怎么改」的信息 |

### 决策 5：移动方式

用 `git mv` 保留文件历史（`git log --follow` 可追溯），而非删除+新建。测试文件同步改名 `ota-hotel-prob-service.test.ts` → `hotel-probe-dispatcher.test.ts`。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 纯移动改名，易漏改 import 导致编译失败 | `npm run check` 全量类型检查即可暴露；本次无运行时行为变化，类型通过基本等于正确 |
| `channels/` 允许依赖 `ota-tab/` 削弱了「适配器零外部依赖」的直觉 | 依赖的是 `ota-tab/index.ts` 公开面（一个事件总线类型），不是实现；且方向单向，`ota-tab/` 不反向依赖 `channels/`。已在 spec 场景中写明 |
| 新 zone 可能命中既有代码，暴露此前未察觉的违规 | 若 lint 报出既有违规，**暂停并报告**，不擅自修改超出本次范围的代码 |
| `HotelProbeDispatcher` 未来若需被非 tab 事件触发（后台爬取），仍需再调整 | 本次只保证位置正确；触发源扩展属 Change 3 之后的范围，届时新增一个入口方法即可，不影响当前结构 |

## Migration Plan

纯代码结构调整，无数据迁移、无部署步骤。回滚 = `git revert`。

## Open Questions

无。
