# Electron 主进程通用分层方案

> 目的：回答"main 进程内部应该怎么分层、每层通用在哪、定制在哪"，基于 Electron 官方
> 文档、VS Code 架构实践、六边形架构（端口与适配器）经典资料的通用调研结论。**不针对
> 本仓库具体代码**，是可以套用到任何 Electron 项目的架构知识。落地到本仓库的判断，
> 见 `2026-08-06-ota-local-login-and-account-discovery.md` 里指出的具体问题。

---

## 0. 为什么不能直接照搬后端的 controller/service/repository

后端分层成立的前提：一条单向数据流——请求进来 → 业务处理 → 落库 → 响应返回。

Electron 主进程要同时处理三类性质完全不同的关注点，通用性差异很大：

| 关注点 | 例子 | 和业务的关系 |
|---|---|---|
| 进程/操作系统 | 窗口生命周期、多视图管理、菜单托盘、崩溃恢复 | 与具体业务无关，换个产品也不用改 |
| 通信协议 | IPC 通道注册、序列化、错误传播 | "传输层"，但双端代码都是自己写的，不像后端要兼容任意 HTTP 客户端 |
| 业务 | 具体功能做什么、数据怎么组织、规则怎么校验 | 和后端的 service/domain 完全对应，可以照搬 DDD |

**第一原则**：先按关注点性质分组，再在"业务关注点"内部套用后端分层经验——不要把
Electron 整体硬塞进 controller/service/repository 这套模子。

---

## 1. 五层结构

```
L1  Composition Root / Bootstrap        启动编排、依赖装配
L2  IPC / Protocol Layer                通道注册、输入校验、调用 Service、异常序列化
L3  Application Service                 用例编排：一次用户操作对应的完整业务流程
L4  Domain                              业务规则、领域模型，零外部技术依赖
L5  Infrastructure / Gateway            窗口/视图管理、数据库、文件系统、外部 API
```

对照后端概念：

| 后端概念 | Electron 对应 | 关键差异 |
|---|---|---|
| Controller | IPC handler（L2） | 后端要防御任意外部客户端；这里双端代码都自己写，威胁模型是"renderer 可能被 XSS 或加载了不可信第三方页面"，不是"任意公网请求" |
| Service | Application Service（L3） | 基本一致，区别是这里的"用例"经常要跨多个窗口/视图协调，不是单次请求内闭环 |
| Domain/Entity | Domain（L4） | 完全一致，照搬 DDD 战术设计 |
| Repository | 接口在 L3/L4 定义，实现在 L5 | 一致，见第 4 节 |
| Infra | Infrastructure（L5） | Electron 特有：多了一整类"管理渲染实例"的基础设施，后端没有对应物 |

**没有单独的 controller 层**：后端 controller 要解析 HTTP 语义（method/path/header）+
鉴权 + 调用 service；IPC 通道本身就是强类型方法调用（`ipcMain.handle('order:create', handler)`），
没有 URL 路由匹配的复杂度，所以 IPC 层直接融合了"最薄的 controller"职责，不需要再单独
抽一层。

---

## 2. 判断"通用"还是"业务定制"的三条可执行标准

不满足于"看情况"，给出可以直接判断的规则：

### 标准一：换一个产品，这段代码还需要吗？

- **完全不用改** → 通用/框架层。例：窗口创建销毁的生命周期管理、IPC 通道注册机制
  本身（不是通道内容）、多视图坐标/层级管理、崩溃监听、单实例锁。
- **要改，但只改参数/配置，不改逻辑结构** → 通用层，但暴露业务配置点。例：窗口默认
  尺寸、是否常驻托盘——通过配置注入，不是写 if/else 分支。
- **要改逻辑分支本身** → 业务定制层。例：什么时候该新建一个视图（用户点了按钮？收到
  推送？）、这个视图加载哪个 URL、加载失败后该重试还是提示用户、数据按什么规则聚合
  再落库。

### 标准二：代码里出现具体业务名词了吗？

如果代码里出现"订单""账号""频道""会话"这类业务词汇，就不是通用层——哪怕看起来
通用，说明职责已经泄漏。反例：一个叫 `WindowManager` 的类如果内部有
`if (windowType === 'order-detail')`，说明业务判断泄漏进了本该通用的层；正确做法是
"决定创建什么样的窗口"这个决策留在业务层，`WindowManager` 只接收已经决策完的"创建
参数"。

### 标准三（来自 VS Code 实践）：能否写出一条 lint 规则拦截跨层 import？

VS Code 用 ESLint 规则禁止跨层 import（比如 `common` 层不能 import `browser` 层的
代码），CI 直接拦截违规。可操作的验收标准：**分层是否成立，不看文档写没写清楚，看
能不能写一条"禁止 import"规则把违规行为拦下来**。如果两层之间连这样一条规则都写不
出来，说明这两层本质是同一层，硬拆是徒增复杂度。

---

## 3. 多视图管理：通用"容器管理器" + 业务决策分离

这是最容易出现"到底该放哪层"争议的地方。

**结论**：应该有一个通用的、不感知业务的视图管理器，但它只管"容器"，不管"内容"。

### 视图管理器（L5，通用）该做的事

- 创建/销毁 `WebContentsView` 实例，管理挂载容器、几何位置、层级顺序、显示/隐藏
- 维护"视图 ID → 视图实例"注册表，支持按 ID 查找、批量枚举、批量销毁
- **统一监听** `webContents` 上的原始生命周期事件（`did-finish-load`、
  `did-fail-load`、`did-navigate`、`destroyed`、`render-process-gone`）——这些是
  Electron API 层面的原始事件，和业务无关，每个视图都需要同样的方式获知"加载完成
  了""进程崩溃了"，不应该让每个业务模块各自重复注册一遍监听器（否则内存泄漏和重复
  处理的风险随视图数量线性增长）

### 视图管理器不该做的事

- 不决定"什么时候该创建一个新视图"——这是业务时机判断，必须由业务层调用
  `viewManager.create(config)`
- 不决定"加载哪个 URL、带什么 UA/session/权限策略"——业务层传入配置参数，视图管理
  器只按配置执行，不判断"为什么是这个 URL"
- 不解读事件的业务含义——"加载完成"这个原始事件，视图管理器往上抛的是通用的
  `viewEvent('did-finish-load', viewId)`，不是解读成"登录成功了"或"订单页加载好了"

### 边界怎么落地：事件总线 + 订阅，不是回调硬编码

视图管理器把原始事件转成不带业务语义的事件流，业务层（L3）订阅自己关心的 `viewId`
上的事件，自己解读语义、决定下一步动作。好处：

- 视图管理器完全可测试（不依赖任何具体业务，可以用假的 `webContents` mock 单测
  生命周期管理逻辑本身）
- 新增业务场景不需要改视图管理器一行代码，只需要新业务模块订阅事件、调用创建接口
- 这正是端口适配器思路：视图管理器是"驱动端口的适配器"（把 Electron 原生事件适配
  成应用内部能理解的事件），业务层是消费方，两者只通过稳定的事件/接口契约耦合

**反模式信号**：如果视图管理器里出现
`onDidFinishLoad(viewId, () => { if (isLoginPage(url)) { markAccountLoggedIn(...) } })`，
`isLoginPage`、`markAccountLoggedIn` 都是业务判断，说明业务逻辑泄漏进了通用层，应该
挪到订阅事件的业务层。

---

## 4. 数据持久化：Repository 接口必须由业务侧定义，实现留在 Infra

这一点业内（DDD、六边形架构社区）共识非常明确：

- **领域/应用层定义**接口（`interface AccountRepository { findById(id): Account; save(account): void }`），
  用领域语言描述，不出现 SQL、不出现具体驱动的类型
- **Infra 层实现**这个接口，内部才出现具体的 SQLite 语句、字段映射、连接管理
- 业务代码只依赖接口，通过依赖注入拿到实现实例，不需要知道底层是 SQLite、LevelDB
  还是文件

**为什么不能"业务逻辑直接依赖具体存储实现"**（即便现在只有一种存储、以后大概率也
不会换）：

1. **可测试性是硬约束**。业务规则单测如果要拉起真实 SQLite、做 schema 迁移，测试
   会变慢变脆弱。有接口就能注入内存 Map 实现的假 Repository，业务规则测试跑毫秒级。
   这跟"以后会不会换数据库"无关，纯粹是为了让业务规则脱离基础设施独立验证。
2. **本地客户端存储形态比后端更容易演进**：桌面应用常经历"文件 JSON → SQLite →
   云同步混合存储"的演进（离线、多设备同步、数据迁移），接口边界让演进不需要动
   业务代码。
3. **依赖方向必须指向领域**（六边形架构核心约束）：领域定义"需要什么能力"（端口），
   基础设施"提供这个能力"（适配器），依赖箭头永远从外围指向核心。如果业务代码
   `import` 了具体数据库驱动类型，依赖方向就反了。

**可执行标准**：领域/应用层代码里如果出现任何 `import` 指向数据库驱动、ORM，或者
`node:fs`/`node:path` 这类 I/O 原语，就是违规——足够具体，可以直接写成 lint 规则。

---

## 5. Main-Renderer 交互：三种模式 + IPC 层该多薄

### 三种常见模式

| 模式 | API | 适用场景 |
|---|---|---|
| 请求-响应 | `ipcRenderer.invoke` + `ipcMain.handle` | renderer 主动发起、需要明确返回值（查询数据、执行一次性命令），最主流 |
| 单向通知 | `ipcRenderer.send` + `ipcMain.on` | renderer 通知主进程"发生了什么"但不需要返回值，注意没有天然的失败反馈路径 |
| 服务端推送 | `webContents.send` + `ipcRenderer.on` | main 主动推送更新（后台任务完成、多个视图间状态需要同步），是"多个渲染实例感知同一份主进程状态变化"的标准解法 |

三者不互斥，成熟应用通常混用：查询用 invoke/handle，状态变化用 push，纯通知用
send/on。"双向绑定"式的响应式状态同步不是 Electron 官方推荐的默认模式，社区实践
通常是在服务端推送基础上加一层"状态版本号 + 全量/增量下发"的约定，本质仍是
请求-响应和推送的组合。

### IPC 层该不该有业务逻辑：共识是"应该薄"，但要精确定义"薄"

不是"一行业务代码都不能有"，而是 IPC handler 只做三件事：

1. **反序列化/校验输入**——renderer 传来的 payload 按"不可信输入"处理，就像对待
   外部 HTTP 请求一样做类型校验
2. **调用一个 Application Service 方法**——一个 handler 通常对应一次 use case
   调用，不应该在 handler 里出现 if/else 分支决定走哪条业务路径，那是 service 该做的
3. **把结果/异常转换成可以安全跨进程序列化的格式**——Error 对象跨 IPC 传输默认会
   丢失自定义字段和 stack，需要显式转换成 plain object 或已知错误码

**可执行标准**：如果一个 IPC handler 函数体超过 10-15 行，或出现两层以上条件分支，
基本可以确定业务逻辑泄漏进了通信层——正确做法是把分支挪进 Application Service，
handler 退化成一行 `return orderService.createOrder(input)`。

---

## 6. 综合分层图

```
┌───────────────────────────────────────────────────────────────────┐
│                         Renderer 进程（多实例）                       │
│         主窗口 UI          │   动态创建的第三方页面视图（WebContentsView）│
└──────────────────────┬────────────────────────────┬─────────────────┘
                        │ IPC (invoke/send/push)      │ 加载原生 URL，无 IPC
                        ▼                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ L1  Bootstrap / Composition Root                                    │
│     职责：app.whenReady 后装配所有依赖、决定谁实现哪个接口              │
│     通用性：100%通用（框架级）    可测试性：不需要单测，集成/冒烟验证     │
│     参照：依赖注入容器思路（VS Code 的 InstantiationService）           │
├───────────────────────────────────────────────────────────────────┤
│ L2  IPC / Protocol Layer                                            │
│     职责：通道注册、输入校验、调用 Service、异常序列化                   │
│     通用性：注册机制通用；具体通道是业务定制（薄转发）                    │
│     可测试性：可单测（mock Service，验证校验和转发逻辑）                 │
├───────────────────────────────────────────────────────────────────┤
│ L3  Application Service（业务用例编排）                                │
│     职责：一次用户操作/一个 use case 的完整流程编排，                    │
│           调用 Domain + 调用 Repository 接口 + 调用视图管理器接口         │
│     通用性：0%通用，纯业务定制    可测试性：高（依赖全是接口，mock后单测） │
├───────────────────────────────────────────────────────────────────┤
│ L4  Domain（领域模型与规则）                                          │
│     职责：业务实体、值对象、领域规则校验，零 I/O、零框架依赖               │
│     通用性：0%通用（技术上最独立，可脱离 Electron 单独编译测试）           │
│     可测试性：最高，裸单测框架跑，不需要 mock 任何东西                    │
├───────────────────────────────────────────────────────────────────┤
│ L5  Infrastructure / Gateway（技术实现）                              │
│  ┌─────────────────┐ ┌──────────────────┐ ┌─────────────────────┐  │
│  │ View Manager     │ │ Repository 实现    │ │ 其他 Gateway          │  │
│  │（通用）           │ │（通用接口+具体实现） │ │（通知/托盘/文件系统等） │  │
│  └─────────────────┘ └──────────────────┘ └─────────────────────┘  │
│     通用性：View Manager 和 Repository 接口高度通用；                   │
│             Repository 具体实现和数据 schema 是业务定制                 │
└───────────────────────────────────────────────────────────────────┘
```

**依赖方向**（六边形架构核心约束）：箭头永远从外围指向核心——L2 依赖 L3，L3 依赖
L4 和 L5 定义的接口，L5 的具体实现依赖 L4 定义的接口（依赖倒置）。L4 不依赖任何其他
层。是否遵守，用第 2 节"能否写出 lint 规则拦截跨层 import"验收。

**主要参照**：

- **六边形架构（端口与适配器）**：本方案骨架来源，尤其体现在 Repository 接口/实现
  分离和 View Manager 的事件适配思路上
- **VS Code 服务化 + 分层依赖规则**：如何在巨型 Electron 应用里维持分层不腐化的
  工程化经验（依赖注入 + 编译期跨层 import 拦截）
- **DDD 战术设计**：L3/L4 内部的具体组织方法，和后端完全通用，可直接复用

---

## 7. 实例：TabOpener 统一入口 + TabEventBus 广播 + Feature 订阅

这一节是多轮讨论收敛后的最终方案，**替代了本文档更早版本里"把触发策略打包成参数
传给 BrowserManager"的方案**——那个方案让 `BrowserManager` 仍然要接收业务方传入
的专属回调（`onUrlPastLogin`），本质上还是"一个标签页绑一个业务方"，没有解决
"多个业务场景可能都想关心同一次打开标签页"这件事，也不支持"标签页存活期间持续
响应内部状态变化"（比如用户在标签页里自行退出重登、切换服务商）。也**替代了讨论
中途一度采用、后来被证伪的"发起方异步记录 partitionName 事后匹配"方案**——那个
方案存在真实的时序漏洞，见 7.4 节。

最终方案：**`BrowserManager` 创建标签页时，把发起方传入的业务上下文（`extra`）
和这个标签页同步绑死；原生事件触发时，连同 `extra` 一起广播到一个通用事件总线；
业务侧的 Feature 各自订阅这个总线，按 `extra` 里的内容过滤，决定要不要处理**。

### 7.1 两条约束，来自对现有代码的核实

**约束一：`BrowserManager` 当前是模块级单实例，不是 class 强制单例**

`main/application.ts` 用模块级变量持有它：

```ts
let browserManager: BrowserManager | null = null;
// openMainWindow() 内：
browserManager = new BrowserManager(mainWindow, log);
// 主窗口关闭时置 null，重新打开窗口时重新 new
```

`BrowserManager` 这个 class 本身没有做单例限制（没有私有构造函数、没有静态实例
缓存），"运行时只有一个实例"是**组装方式**决定的，不是类设计强制的。它的生命周期
跟主窗口绑定，不是应用级永久单例——主窗口重建时，事件总线和各 Feature 的订阅关系
也要跟着重建，不能假设订阅只注册一次就永久有效。

**约束二：`main/features/` 目录现在没有 `XxxFeature` 命名先例**

现有两个类是 `LoginTabOpener` 和 `OtaAccountReadService`，都不带 `Feature` 后缀。
下面统一改叫 `XxxFeature` 是一次**主动的命名规范化**，不是延续现状。

### 7.2 新增两个协作对象，放在哪、叫什么名字

`main/browser/` 目录现有两个文件：`browser-manager.ts`（容器本身）、
`session-factory.ts`（`BrowserManager` 依赖的协作类，管 session/partition 创建）。
这个目录的组织习惯是"`BrowserManager` + 它依赖的通用协作对象各自一个文件，都不带
业务前缀"（`SessionFactory` 现在也只服务 OTA 场景，但没有叫
`OtaSessionFactory`）。新增的事件总线按同样的习惯处理：

```
main/browser/
├── browser-manager.ts       容器本身，创建/管理标签页（改动：广播事件、接收 extra）
├── session-factory.ts       协作类：管 session/partition（不变）
└── tab-event-bus.ts         【新增】协作类：广播标签页事件，不带业务前缀
```

```ts
// tab-event-bus.ts
import { EventEmitter } from 'node:events';

export type TabNavigatedEvent = Readonly<{
  tabId: string;
  partitionName: string;
  channel: string;
  url: string;
  extra: unknown;   // 【通用总线不认识 extra 具体形状，原样透传】
}>;

export class TabEventBus extends EventEmitter {
  emitNavigated(event: TabNavigatedEvent): void {
    this.emit('tab:navigated', event);
  }
}
```

**为什么不叫 `OtaTabEventBus`**：讨论过"是否要有多个总线、按场景分开广播"，
结论是不需要——`BrowserManager` 创建标签页时只能同步 `emit` 到一个固定的总线（它
不该、也不能"看情况选一个总线广播"，那样等于让通用容器承担业务路由判断）。既然
只有唯一一个总线实例，且这个总线的定位是"跟着 `BrowserManager` 走、广播所有标签
页事件"，不因为当前唯一的使用者是 OTA 场景就把总线本身命名成业务专属——这和
`SessionFactory` 不叫 `OtaSessionFactory` 是同一个原则，机制层不因当前唯一调用方
而改名。

`extra` 的具体形状（`OtaTabExtra`）**不放在 `main/browser/`**，放在业务侧能看到、
机制层不需要依赖的地方：

```ts
// 建议放在 main/features/ota-tab/ota-tab-extra.ts 或类似业务侧目录
export type OtaTabExtra = Readonly<{
  intent: 'hotel-binding' | undefined;  // undefined 表示默认登录场景，见 7.5 节兜底规则
  context?: Readonly<{ rmsHotelId?: string }>;
}>;
```

`TabEventBus`/`BrowserManager` 的类型签名里 `extra` 一律标 `unknown`，不 import
`OtaTabExtra`——这保持了"机制层不认识业务类型"的边界（对应第 2 节标准三：
`main/browser/` 目录理论上可以写一条 lint 规则禁止它 import 任何业务侧类型）。
调用方（`OtaTabOpener`、各 Feature）自己负责把 `unknown` 断言/校验成
`OtaTabExtra`。

### 7.3 命名对照表（本节确定下来的全部命名）

| 概念 | 命名 | 放在哪 | 是否带业务前缀 |
|---|---|---|---|
| 打开标签页的统一入口 | `OtaTabOpener` | `main/features/` 下（原 `LoginTabOpener` 改名） | 是（本仓库只服务 OTA，明确阶段性选择） |
| 标签页创建时携带的业务上下文类型 | `OtaTabExtra` | 业务侧目录 | 是 |
| 标签页原生事件的广播总线 | `TabEventBus` | `main/browser/tab-event-bus.ts` | 否（机制层，唯一实例，见 7.2 说明） |
| 探测完归并/落库的业务逻辑（原 `DiscoverAndCreate`） | `AccountDiscoveryFeature` | `main/features/` | 是 |
| 新增的绑定酒店业务逻辑 | `HotelBindingFeature` | `main/features/` | 是 |
| IPC 频道 | `tab.open` | `shared/ipc-channels.ts` | 否（不叫 `otaAccount.startLogin`） |

### 7.4 完整分层与订阅机制的具体代码

```
① renderer：任意入口点击（普通登录 / 绑定酒店 / Cookie 导入……）
    │ IPC: tab.open({ channelId, environment, url, extra })
    │      extra: OtaTabExtra，由发起这次操作的 Feature 决定内容
    ▼
② IPC handler（L2，薄转发）→ OtaTabOpener.open(channelId, url, extra, ...)
    ▼
③ OtaTabOpener（L3，唯一负责"打开标签页"的通用入口）
    决定 session 怎么来（新建/复用/注入cookie），extra 原样往下传
    → BrowserManager.createAndNewPartition(channelId, url, extra, ...)
    ▼
④ BrowserManager（L5，通用容器，模块级单实例）
    创建标签页的同一次同步调用里，把 extra 和 ManagedTab 绑死：
      tab.extra = extra   ← 这一步在 loadURL 之前完成，无时序漏洞（见下）
    原生事件监听命中时，广播（连同 extra 一起）：
      this.tabEventBus.emitNavigated({ tabId, partitionName, channel, url, extra: tab.extra })
    ▼
⑤ Feature 各自订阅同一个 TabEventBus 实例，按 extra 过滤
```

**订阅具体怎么写**（Node.js 内置 `EventEmitter`，不是新机制）：

```ts
// HotelBindingFeature 构造时
constructor(private readonly tabEventBus: TabEventBus, ...) {
  this.tabEventBus.on('tab:navigated', (event: TabNavigatedEvent) => {
    const extra = event.extra as OtaTabExtra | undefined;
    if (extra?.intent !== 'hotel-binding') return;   // 不是我关心的，跳过
    this.handleNavigated(event, extra);
  });
}
```

`tabEventBus.emit(...)` 一次，所有 `.on(...)` 注册过的监听者依次被调用，Node 内置
行为，不需要 `BrowserManager` 知道有几个订阅者、也不需要它做任何"分发给谁"的
判断——它只管广播，分发逻辑是 `EventEmitter` 自带的。`TabEventBus` 实例由
`main/application.ts`（组装根）创建一次，同时传给 `BrowserManager` 和每个
Feature 的构造函数。

### 7.5 为什么不能靠"发起方异步记录 partitionName 事后匹配"（已证伪的方案）

讨论中途一度设想：不改 `BrowserManager` 的参数形状，让 `HotelBindingFeature` 在
拿到 `OtaTabOpener.open(...)` 的返回值（里面有 `partitionName`）之后，自己记一个
`Map<partitionName, rmsHotelId>`，收到广播时按 `partitionName` 查表匹配。

**这个方案有真实的时序漏洞**：`partitionName` 是在 `BrowserManager.createAndNewPartition()`
内部生成的，`OtaTabOpener.open(...)` 只是转发这个返回值；而 `BrowserManager`
创建完标签页后会立刻调用 `webContents.loadURL(url)` 开始加载页面。如果页面加载
够快、URL 判定命中够早，存在广播事件先发出、`HotelBindingFeature` 的 `await` 还
没走完、Map 还没来得及记录的竞争窗口——这次事件会被漏判为"不是我发起的"。

**现在的方案（extra 随创建请求同步传入）消除了这个漏洞**：`extra` 不是标签页
创建之后才补记的，是随着 `tab.open` 这次请求从一开始就同步传入、在
`BrowserManager` 创建 `ManagedTab` 的同一行代码里就和标签页绑死，早于
`loadURL(url)` 执行，不存在"标签页已经在加载、但认领信息还没写入"的时间窗口。

### 7.6 用"绑定酒店"这个真实 case 走一遍，验证链路闭环

```
用户在绑定酒店弹窗点"登录抖音账号"
  │ IPC: tab.open({ channelId:'douyin', environment:'prod', url:'...',
  │        extra: { intent:'hotel-binding', context:{ rmsHotelId:'H1' } } })
  ▼
OtaTabOpener.open(...) → BrowserManager.createAndNewPartition(...)
  创建标签页，同步把 extra 绑到 ManagedTab 上（早于 loadURL）
  用户手动登录，URL 跳到 /p/home?groupid=xxx
  ▼
BrowserManager 挂的 did-navigate 监听命中，广播：
  tabEventBus.emitNavigated({ tabId, partitionName, channel:'douyin', url,
    extra: { intent:'hotel-binding', context:{ rmsHotelId:'H1' } } })
  ▼
HotelBindingFeature 收到广播：
  extra.intent === 'hotel-binding' → 命中，是我关心的事件
  判断 url 是否命中登录后页面（复用现有 loginUrlMatcher 判据）
  是 → 调用 discoverDouyin(...)（现有探测函数，不用改）
     → 点菜单、抓包、解析酒店列表
     → 不落库，推事件给 renderer：hotelBinding.candidatesReady { hotels }
  ▼
renderer 弹窗展示候选，用户选一个，确认
  │ IPC: hotelBinding.confirmCandidate({ rmsHotelId:'H1', chosenHotelId })
  ▼
HotelBindingFeature.confirmCandidate(...)
  按 rmsHotelId 取回之前暂存的 credential+hotels
  归并 Credential（复用 AccountDiscoveryFeature 里可复用的归并逻辑）
  upsert 选中的 OtaAccount
  （未来）调远端接口创建 RmsOtaAccount 绑定
  ▼
写 Repository，弹窗关闭，绑定成功
```

**同一次广播，`AccountDiscoveryFeature` 会不会也处理，导致重复触发**：会收到同一
次 `tab:navigated` 广播，需要一条明确的默认规则：`AccountDiscoveryFeature` 只处理
`extra.intent === undefined`（即普通登录入口，没有被任何其他 Feature 显式认领）的
事件；`extra.intent` 有值时，说明这次打开已经被某个具体 Feature（如
`HotelBindingFeature`）认领，`AccountDiscoveryFeature` 直接跳过。这条"默认兜底"
规则本身是业务决定，写在 `AccountDiscoveryFeature` 内部，`BrowserManager`/
`TabEventBus` 不参与仲裁"这次事件该归谁"。

### 7.7 广播只管"分发事件"，不管"Feature 拿到后做什么"——CDP debugger 类操作的边界

一个容易混淆的追加场景：如果某个 Feature 要做的不是"看一眼 URL 变了没有"，而是
"持续监听这个标签页发出的网络请求"（比如监控用户在携程页面上发起的改价请求），
这类需求**不该也不能**塞进 `TabEventBus` 广播模型，原因和处理方式如下。

**为什么不能塞进广播模型**：`webContents.debugger.attach(...)`（Chrome DevTools
Protocol，读取网络请求内容用的机制）是**独占资源**——同一个 `webContents` 同时
只能被一个 debugger 客户端 attach。如果广播机制替 Feature 自动 attach，两个
Feature 同时想监听同一个标签页的网络请求就会冲突（比如账号发现探测本身也用
debugger 抓包，见 `main/ota/douyin/discover-douyin.ts`）。广播模型的前提是"多个
订阅者互不干扰、各自只读一份数据"，这个前提在独占资源上不成立。

**分界线在哪**：`TabEventBus` 只负责把"标签页发生了什么原生事件"广播出去，事件
参数里带上这次事件的 `webContents` 引用本身：

```ts
export type TabNavigatedEvent = Readonly<{
  tabId: string;
  partitionName: string;
  channel: string;
  url: string;
  webContents: WebContents;   // 随事件一起带出来，不用 Feature 另外去查
  extra: unknown;
}>;
```

Feature 拿到这个 `webContents` 引用之后，**要不要 attach debugger、监听多久、
状态存哪里、什么时候 detach——完全是这个 Feature 自己的实现细节，架构层面不管，
也不该管**。`TabEventBus`/`BrowserManager` 到"把 `webContents` 交给 Feature"这一
步为止，之后 Feature 内部怎么用这个引用做持续性的、有状态的操作（attach 之后要
一直挂着，直到用户实际做出改价操作才能 detach，这个过程通常跨越好几次事件回调，
不是一次回调内能"当场"完成的），是每个 Feature 自己的业务逻辑，不是通用层需要
统一设计的东西。**这是一条明确的止步线：广播到"分发事件+带上必要引用"为止，
不延伸到"教 Feature 怎么管理自己的监听生命周期"。**

### 7.8 尚未覆盖、留待后续单独设计的场景

这一节的方案解决的是"一次性触发"（到达登录后页面触发一次）。你提出的另一类场景
——"用户在标签页内部持续切换服务商（URL 里 groupid 变化），需要针对每次变化重新
判断要不要扫描"——现在的 `checkUrlPastLogin` 命中一次即永久锁定
（`urlPastLoginTriggered` 标志位），不支持标签页存活期间反复触发。这个场景理论上
可以用同一套 `TabEventBus` 广播机制承接（Feature 订阅时不做"只处理一次"的限制，
自己维护"这个 groupid 是否已扫描过"的状态），但涉及 `checkUrlPastLogin` 内部
"一次性锁定"这条现有规则要不要放开、放开后如何避免同一 groupid 被反复重复扫描，
需要单独设计，不在本节方案范围内。

---

## 8. 当前状态与下一步落地计划

本文档第 7 节是架构讨论阶段的产出（多轮推翻重来后的收敛结论），**尚未开始实施**。
下面记录讨论截至目前确认的事实，以及下一步要做的具体改动，供后续继续实施时对齐。

### 8.1 已确认的事实（供实施时复用，不需要重新调研）

- `BrowserManager` 是模块级单实例，跟主窗口生命周期绑定，不是 class 强制单例（见
  7.1）。
- `main/features/` 目录现在没有 `XxxFeature` 命名先例，改名是主动规范化。
- 三个渠道的探测函数（`discover-ctrip.ts`/`discover-douyin.ts`/`discover-meituan.ts`）
  **一次调用**同时返回 `credential`（渠道身份）和 `hotels`（酒店列表）两部分，是
  不可拆分的单元——探测层本身不区分"这次是为了 Credential 还是为了 Account"，
  `OtaCredential` 归并和 `OtaAccount` upsert 是同一次 probe 结果的两个消费方，不是
  两次独立探测。
- `otaAccount.openExisting`、`otaAccount.createFromExistingSession` 已确认是死
  代码（IPC/preload/handler 完整存在，renderer 无调用点）；`otaAccount.listByChannel`
  背后依赖的 UI（`SelectOtherHotelPanel.svelte`、`AccountsNav.svelte`）是孤儿组件，
  没有任何页面引用，见 `2026-08-06-ota-local-login-and-account-discovery.md` 第 6
  节。当前账号切换器（`AccountSwitcherDialog.svelte`）只展示 `OtaCredential`，不
  展示 `OtaAccount`。
- `OtaAccountRepository`/`OtaCredentialRepository` 两个接口和各自的 SQLite 实现
  完全对齐（接口方法数=实现方法数=调用点数，无死代码方法），这一层本身是干净的。

### 8.2 下一步计划：收敛 `ota-account` 对外 IPC，只保留 domain 层

在开始第 7 节的 `TabEventBus`/`OtaTabOpener`/Feature 拆分之前，先做一次更小范围的
清理，把 `OtaAccount` 相关代码收敛到只剩必要的部分：

1. **撤掉 `IPC_CHANNELS.otaAccount.*` 对外暴露的读接口**——`listByChannel`、
   `openExisting`、`createFromExistingSession` 三个方法在 renderer 侧要么已经没有
   界面消费（第 8.1 节列的死代码/孤儿组件），要么不该继续以 `OtaAccount` 的身份
   单独暴露。`startLogin`/`createFromCookie` 这两个"发起登录动作"的方法，本质是
   机制层（返回值是 `BrowserTab`，不是 `OtaAccount` 记录，第 6 节已论证过），后续
   走 7.2-7.4 节的 `tab.open` + `OtaTabOpener` 方案收敛，不再挂在 `otaAccount.*`
   这个命名空间下。
2. **`OtaAccount` 只保留 domain 层的必要部分**：`domain/ota-account.ts`（模型
   定义）、`domain/ports/repositories.ts` 里的 `OtaAccountRepository` 接口、
   `main/database/ota-account-repository.ts` 的 SQLite 实现——这三者继续保留，
   因为写入路径（`DiscoverAndCreate`/未来的 `AccountDiscoveryFeature` 内部
   `upsertAccount()`）还在正常工作，只是不再通过 IPC 把 `OtaAccount` 记录暴露给
   renderer 读取。
3. **探测层（probe）保持现状，不拆分**：因为 8.1 节确认过 `credential` 和
   `hotels` 是同一次探测的两个字段，不需要（也不应该）为了"收敛 ota-account"而
   把探测函数拆成"只探身份"和"只探酒店"两次调用。`AccountDiscoveryFeature`（第
   7.3 节命名对照表里的改名目标）内部继续像现在的 `DiscoverAndCreate` 一样，一次
   探测结果里，`credential` 部分喂给 Credential 归并逻辑，`hotels` 部分喂给
   `OtaAccount` upsert 逻辑，两者共用同一次 probe 调用，不拆分成两条独立链路。

这一步和第 7 节的 `TabEventBus`/Feature 拆分是两件独立的改动，可以先后进行，互不
阻塞——先做 IPC 收敛（改动小、风险低、不涉及事件广播机制），再视情况决定是否/
何时启动第 7 节的整体拆分。

---

## 参考来源

- [Process Model | Electron](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [webContents | Electron](https://www.electronjs.org/docs/latest/api/web-contents)
- [Advanced Electron.js architecture - LogRocket Blog](https://blog.logrocket.com/advanced-electron-js-architecture/)
- [Application Startup and Process Architecture | microsoft/vscode | DeepWiki](https://deepwiki.com/microsoft/vscode/1.1-application-startup-and-process-architecture)
- [Migrating VS Code to Process Sandboxing](https://code.visualstudio.com/blogs/2022/11/28/vscode-sandbox)
- [Hexagonal architecture (software) - Wikipedia](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software))
- [WebContentsView Implemented to Replace BrowserView in Electron | Mamezou Developer Portal](https://developer.mamezou-tech.com/en/blogs/2024/03/06/electron-webcontentsview/)
- [Electron IPC Response/Request architecture with TypeScript - LogRocket Blog](https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/)
- [Syncing State between Electron Contexts - Bruno Scheufler](https://brunoscheufler.com/blog/2023-10-29-syncing-state-between-electron-contexts)
