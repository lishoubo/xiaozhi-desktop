# OtaTabOpener 重构 — 讨论状态记录

Part B（酒店绑定探测流程）设计过程中，发现现有 OTA 标签页打开路径不统一，用户要求**先做这次底层重构，Part B 暂停**。本文档记录截至目前的已确认事实、已拍板决策、未决问题，供中断后接续。

事实基础见同目录 `ota-tab-opening-audit.md`（现状梳理，已完成）；本次重构的影响面评估见下方"影响面评估结论"一节。

## 触发原因

设计 Part B 时发现：`otaCredential.openExisting`（复用已登录 partition 打开标签页）没有挂 `loginUrlMatcher`/`onUrlPastLogin`，无法触发登录判定和后续探测事件；而 `openForNewLogin`/`openWithImportedCookie` 走 `LoginTabOpener`，挂了判定。三个入口职责不对称、分散在两条代码路径（`LoginTabOpener` vs 裸调用 `BrowserManager`），且 `intent`（Part B 需要的绑定意图标识）在任何一层都不存在。用户要求先把这条路统一，再回头做 Part B。

## 已拍板的决策

1. **新建统一类 `OtaTabOpener`**，放在新目录 `apps/desktop/src/main/features/ota-tab-opener/`（已建空目录），取代/整合 `LoginTabOpener` 和 `openExisting` 现在的裸调用。
2. **`login-url-matcher.ts`（`LOGIN_URL_MATCHERS` registry）从 `ota-credential/` 搬到 `ota-tab-opener/` 目录**——它现在唯一的消费者就是打开标签页这件事，搬过去更符合新职责边界。
3. **`openExisting` 新增可选 `intent` 参数，一次到位**——不留到 Part B 再补；传了 intent 就挂判定+广播，不传维持现状行为。
4. **IPC 层拆分**：新建 `apps/desktop/src/main/ipc/ota-tab-handlers.ts`，只暴露约 3 个 OTA 标签页相关 IPC；`browser-handlers.ts` 瘦身，只留 `IPC_CHANNELS.browser.*`（纯浏览器容器控制）和 `cookies.*`。
5. **IPC channel 命名同步改成 `ota-tab:*` 前缀**（现状是 `ota-credential:*`），与新目录/新类命名对齐；renderer/preload 调用点需要同步改（`BrowserWorkspace.svelte`、`CookieLoginListDialog.svelte` 等，见 audit 文档第 7 节）。
6. **方向性决策（未落地到具体方案）**：用户希望 `BrowserManager` 更彻底地"只负责基本动作"（开/关/显示/导航等纯容器操作），完全不知道"登录判定"这个概念；`checkUrlPastLogin`/`loginUrlMatcher`/`onUrlPastLogin`/`urlPastLoginTriggered`/`TabEventBus` 这整套判定+广播机制，整体移到 `OtaTabOpener` 一侧维护。这一条用户已确认方向，但**具体怎么落地还未决定**（见下方"未决问题"）。

## 已核实的关键事实（供设计参考，勿重新调查）

摘自两次只读 Agent 调查（完整报告见对话记录，此处只列结论）：

- `BrowserManager.createWithAlreadyPartition`/`createAndNewPartition`（`browser-manager.ts:113-167`）已经是"不解释、只透传"的干净设计——接受可选 `onUrlPastLogin`/`loginUrlMatcher`，只在恰当时机调用，不理解内容。这一层本身不需要因为要传 `intent` 而变脏，只要 `intent` 类型上不 import 具体 union（用 `unknown` 或类似方式），原样透传即可。
- `BrowserManager` 现在唯一硬编码某个具体渠道的地方是 `installRequestInterceptor`（50-51、332-352 行，携程 API 请求拦截），这是独立的历史遗留问题，与本次重构无关，不在范围内。
- **`browser.stateChanged` 事件不能被 `OtaTabOpener` 复用为"纯导航事件"**：它是 `window.webContents.send(...)`，即发往渲染进程的 IPC，不是 Node.js 进程内 `EventEmitter`。主进程内的类（`OtaTabOpener`）无法订阅自己进程发出的 IPC send。若要让 `BrowserManager` 广播"导航发生了"这种原始事实供 `OtaTabOpener` 订阅，必须新增一个真正的进程内事件通道——这是净新增的基础设施，不是简单复用。
- `checkUrlPastLogin`（434-474 行）有一条**历史踩过坑、写在注释里的强时序约束**：判定结果事件必须等 `onUrlPastLogin`（即 `DiscoverAndCreate.trigger`）跑完、credential 真正写入数据库后才能广播，不能在导航发生的那一刻就广播——否则下游 `OtaHotelProbFeature` 可能查到 `null` 而永久错过探测机会（携程场景下标签页只导航一次、没有第二次机会）。相关修复记录见 `openspec/changes/split-ota-hotel-prob-feature`。任何重构方案都必须保持这条时序约束。
- `urlPastLoginTriggered` 去重状态现在跟 `ManagedTab` 对象生命周期绑定，标签页关闭时随对象一起被回收（`close()` 里 `this.tabs.delete(tabId)`）。如果这个状态挪到 `OtaTabOpener` 自己维护（比如用 tabId 做 key 的 Map），`OtaTabOpener` 需要自己处理标签页关闭时的清理——但 `BrowserManager` 现在**不对外广播"标签页已关闭"事件**，只有内部日志，这是另一个需要新增的信号缺口。
- `LoginTabOpener`（`login-tab-opener.ts`，108 行）现有代码的核心工作（组装 `loginUrlMatcher` + `onUrlPastLogin` 闭包 + 调用 `BrowserManager`）跟"OtaTabOpener"这个名字暗示的职责**高度重叠**。重构前必须先明确二者关系：`OtaTabOpener` 是替代 `LoginTabOpener`、包含它、还是并列？不理清会导致两个类各自持有一份 `loginUrlMatchers`/`triggerDiscovery` 依赖、装配混乱。
- `TabEventBus` 现在是"平行注入"给 `BrowserManager` 和 `OtaHotelProbFeature` 两方（`application.ts:75-94`），彼此不知道对方存在，只共享同一实例。`BrowserManager` 构造函数第 4 参 `tabEventBus` 有默认值（`= new TabEventBus()`），若判定逻辑整体搬走，这个参数会失去存在意义，是破坏性签名变更。
- 全仓测试影响面（若做彻底分层重构）：`browser-manager-partitions.test.ts`（至少 6 个用例，165-322 行区间，用 `view.handlers.get('did-navigate')` mock 直接驱动判定逻辑）、`login-tab-opener.test.ts`（多个用例专测判定回调组装）、`tab-event-bus.test.ts`（整个文件位置要随搬迁而变）、`ota-hotel-prob-feature.test.ts`（import 路径要变）都需要同步改动，且驱动测试的 mock 手法（直接操纵 `did-navigate` handler）在分层后也要换一种方式。

## 未决问题（下次接续从这里开始）

1. **`BrowserManager` 判定逻辑彻底剥离的具体落地方式，还没定案。** 讨论过两个方向：
   - **方向A（新增进程内事件通道）**：`BrowserManager` 新增一个真正的 `EventEmitter`（不是 IPC），广播"导航发生了"（tabId + url）这种原始事实，`OtaTabOpener` 订阅它、自己维护判定状态、自己触发 `DiscoverAndCreate.trigger`、自己广播结果事件。用户对此表达了"要不要接受新增这块基础设施的成本"的疑虑。
   - **方向B（合并成单一回调，非事件总线）**：把 `loginUrlMatcher` + `onUrlPastLogin` + 去重状态 + 结果广播，合并成一个**单一回调**（例如 `onNavigate(url, webContents)`），`BrowserManager` 每次导航无条件调用这个回调，自己不做任何判断/去重/广播，全部逻辑封装在 `OtaTabOpener` 提供的这个回调内部。这个方案不需要新增事件总线，本质是现有 `onUrlPastLogin` 回调注入机制的延伸（现状本来就是"调用方传回调、`BrowserManager` 在合适时机调用"，只是现在被拆成了两层`loginUrlMatcher`判断+`onUrlPastLogin`副作用，方向B是把这两层合并成一层，判断逻辑也下放给调用方）。
   - **这两个方向都还没有被验证/拍板**——讨论到方向B时，用户对回答的扎实度提出了合理质疑（模型在多轮讨论后开始不够严谨地现场编方案，未充分交叉核对之前的影响面报告），因此中断，转为先沉淀文档。
   - 下次接续时，**不要直接从方向B继续往下设计**，应先重新扎实核对方向B是否能满足"BrowserManager 完全不知道登录判定概念"这一目标（尤其是：`urlPastLoginTriggered` 去重状态、多次导航场景下的行为、`webContents`/`tab.view` 引用是否需要暴露给上游、标签页关闭时的清理时机），必要时用只读 Agent 再核实一遍再拍板，不要在对话里继续臆测。

2. **`OtaTabOpener` 与 `LoginTabOpener` 的关系尚未确定**（替代/包含/并列），这是上面事实清单里提到的重叠问题，方向A/B 无论选哪个都要先定这一条。

3. **`intent` 类型定义放在哪、具体 union 有哪些 variant**——本轮重构讨论几乎没涉及这个，Part B 暂停前只在更早的讨论中有过（`PROBE_OTA_HOTELS` 等），需要重新核对是否还适用于新架构。

4. **本次重构的 tasks.md 尚未编写**——目前只有本文档记录的方向性讨论，没有形成可执行的任务清单；`add-hotel-management-page` 现有 `tasks.md` 第4-7节是 Part B 的任务，本次重构如果范围独立，可能需要新开一个 change 或在本目录下新增任务节，待方案确定后再定。

## 暂停前的完整决策链（背景参考，如需要追溯"为什么会讨论到这里"）

1. Part A（RMS Gateway + CRUD）已完成合并到 dev，Part B 待开始。
2. 讨论 Part B 的 intent/状态机方案时，确认 `OtaHotelProb` 写入时机改为 `confirmBinding` 成功后（而非 design.md 原方案的 Probe 阶段）——**这条修改尚未写回 design.md**。
3. 讨论 `ActiveHotelBinding` 取消/排空状态机是否可以简化（不用 CANCELLING 中间态，改用 operationId/tabId 兜底丢弃迟到结果）——**讨论过方向但未最终拍板**，中途转向发现 `openExisting` 缺口问题。
4. 发现 `openExisting` 没有登录判定机制，任何 intent 传递方案都建立不起来。
5. 梳理现状（`ota-tab-opening-audit.md`），确认三个入口不对称。
6. 用户提出统一入口的设想 → 拍板本文档第二节的 5 条决策 → 讨论深入到"BrowserManager 该不该完全不知道登录判定"这一更彻底的问题 → 中断，沉淀本文档。

**注意**：第2、3点的 Part B 设计修改（`OtaHotelProb` 写入时机、取消状态机简化）在恢复 Part B 工作时需要重新捡起，design.md 尚未更新。
