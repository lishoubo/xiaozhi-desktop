# Electron IPC 背景知识：给熟悉服务端的人看

> 目的：解释 `apps/desktop/src/preload/api.ts`、`shared/ipc-channels.ts`、
> `main/ipc/*-handlers.ts` 这一组文件是什么、怎么写、以及当前命名上的一处真实混乱。
> 不是通用 Electron 教程，只讲这个仓库里实际用到的部分。

---

## 1. `renderer` 不是"一个"东西，是"一类"东西

第一个要打破的误解：**"renderer" 不是指某一个固定的前端页面，是 Electron 对"跑
Chromium 内核、渲染网页"这一类进程的统称**。main 进程可以按需创建任意多个 renderer。

这个应用里，实际存在的 renderer 分两种，性质完全不同：

```
main 进程（唯一，Node.js，能碰文件系统 / SQLite / 系统 API）
  │
  │  掌管：创建/销毁窗口和视图的权力、Cookie 存储、数据库
  │
  ├── ① 应用主窗口（renderer，只有一个）
  │      文件：main/windows/main-window.ts，new BrowserWindow(...)
  │      渲染的是你们自己写的 Svelte 代码（apps/desktop/src/renderer/）
  │      这是"你的应用界面"本体，用户打开 app 看到的整个窗口
  │
  └── ② 标签页（renderer，可以有很多个，一个标签一个）
         文件：main/browser/browser-manager.ts，new WebContentsView(...)
         渲染的是携程/美团/抖音这些第三方网站自己的代码
         由 main 响应①发来的 IPC 请求而创建，显示在①窗口内的某个区域里
         每个标签页绑定一个独立的 partition（登录环境隔离，互不影响）
```

**①和②是两个完全独立的 Chromium 渲染进程，互相看不到对方的内容。** ①不能直接创建/操控
②——不是技术上做不到，是 Electron 出于安全隔离故意不允许 renderer 里的 JS 随便去 new
一个新的浏览器视图、注入 Cookie、读别的网站的 DOM。所以①要开一个携程标签页，必须通过
IPC 求 main：main 收到请求后，自己去创建②。

这也是为什么 `browser.*` 这组 IPC 方法名里的"browser"，**指的不是"Electron 这个软件
本身"，也不是"应用主窗口"，而是第②层**——main 帮①管理的那些第三方网站标签页。
`browser.create`/`activate`/`close` 操作的就是②；`otaCredential.openExisting` 表面上
是在查一条登录身份记录，但最终效果也是让 main 去操作②（打开或激活一个携程/美团/抖音
标签页）——这也是为什么"otaCredential 也要操作浏览器"是对的：业务身份类的方法，最终
落地经常还是要落到"开一个标签页"这个机制层动作上。

本文后面说的"renderer"，如果不特别说明，指的都是①（应用主窗口），因为 IPC 接口
（`preload/api.ts`）是①和 main 之间的接口——②不需要这套 IPC，②本身就是 main 直接
`new` 出来、直接持有引用去操作的，不需要跨进程通信。

---

## 2. 两个进程，一条"内部 API"

Electron 应用运行时是两个进程角色：

| 进程 | 类比 | 能力 |
|---|---|---|
| **main** | 后端 | 能碰文件系统、SQLite、系统 API、创建窗口/标签页 |
| **renderer**（这里指①应用主窗口） | 前端 | 就是一个网页，跑在 Chromium 里，天然不该直接碰文件系统等危险能力 |

`preload/api.ts` 是这两者之间的**接口层**：

```
renderer 调用          ≈  调用本地 SDK / API client
     │
     ▼ （进程间通信，不是 HTTP）
preload/api.ts          ≈  client 的实现（发请求 + 校验返回值）
     │
     ▼
main/ipc/*-handlers.ts  ≈  服务端的 controller / handler
```

renderer 侧代码写起来是 `await window.hotelButler.calendar.load()`，长得像调本地方法，
但背后真实发生的是**进程间通信**（IPC，Inter-Process Communication），不是函数调用，也
不是网络请求。

---

## 3. "频道"（channel）到底是什么

Electron 的 IPC 机制本身**没有路由概念**，比 HTTP 简陋得多：

- 没有 `POST /api/xxx` 这种"方法 + 路径"结构；
- 只有一个字符串标签，发送方和接收方各自约定同一个字符串就能对上：

```ts
// renderer 侧（preload/api.ts）
invoke('calendar:create-event', payload)

// main 侧（main/ipc/calendar-handlers.ts）
ipcMain.handle('calendar:create-event', (event, payload) => { ... })
```

这个字符串 `'calendar:create-event'` 就是"频道"。类比 **消息队列的 topic**——发布者和
订阅者靠同一个 topic 名字对齐，不靠路径匹配规则。

`shared/ipc-channels.ts` 里的 `IPC_CHANNELS` 对象，唯一作用是把这些字符串集中管理成
常量，避免两边各写一遍、改错一个字母也不会有编译期报错：

```ts
export const IPC_CHANNELS = {
  calendar: {
    load: 'calendar:load',
    createEvent: 'calendar:create-event',
    ...
  },
  ...
} as const;
```

它是一份"频道名字典"，**不是路由表**——没有强制"同一分组下的方法必须是同一维度"这种
约束（第 6 节展开）。

---

## 4. 一次调用的完整链路

```
renderer                      preload                        main
   │                             │                              │
   │ window.hotelButler          │                              │
   │   .calendar.createEvent(x)  │                              │
   │────────────────────────────▶│                              │
   │                             │ invokeValidated(schema,      │
   │                             │   'calendar:create-event', x)│
   │                             │──────────────────────────────▶│
   │                             │  ipcRenderer.invoke(...)      │ ipcMain.handle(
   │                             │                                │   'calendar:create-event',
   │                             │                                │   (event, x) => { ... }
   │                             │                                │ )
   │                             │◀───────────────────────────────│
   │                             │  用 zod schema 校验返回值       │
   │◀────────────────────────────│                                │
   │  拿到校验过的结果            │                                │
```

`invokeValidated` 这个封装做两件事：

1. **发请求**：`invoke(channel, ...args)`，本质是 `ipcRenderer.invoke`；
2. **校验响应结构**：用 zod schema 对 main 进程返回的数据做 runtime 校验。

第 2 步是后端开发里没有直接对应物的一步——TS 类型只在编译期有效，一旦跨进程边界，
main 进程返回什么，renderer 运行时是不知道的，必须真的解析校验一次，否则字段错了也会
被当成合法数据用下去。

---

## 5. 写一个新接口要改 4 个地方

对照 `calendar.createEvent` 这个例子：

| 步骤 | 文件 | 类比 |
|---|---|---|
| ① 定义返回值的 schema | `shared/calendar.ts`（或对应 shared 文件） | 定义响应体的 JSON Schema |
| ② 注册频道名常量 | `shared/ipc-channels.ts` | 定义路由 path 常量 |
| ③ 写 handler | `main/ipc/calendar-handlers.ts`，`ipcMain.handle(...)` | 写 controller |
| ④ 写 client 方法 | `preload/api.ts`，两处：`DesktopApi` 类型签名 + 具体调用 | 写 client SDK + 接口文档 |

四步是样板代码，IPC 这种"字符串对字符串"的机制没有框架帮你从一份声明生成另外三份，
所以每加一个方法都要在四个地方手动对齐名字。

---

## 6. 现有分组的真实问题：两个不同维度被放在同一层级比较

`IPC_CHANNELS` 表面上按业务模块分组（`browser`、`calendar`、`cookies`、`otaAccount`、
`otaCredential`、`system`），但这几个分组名字实际不是同一种东西：

```ts
browser: {
  create, activate, close, goBack, goForward, list, reload, ...
  // 全部在操作"第 §1 节里的②标签页"这个机制——不关心业务语义，
  // 谁调用、为什么调用都不重要，纯粹是"怎么开关一个标签页"
}

calendar: {
  load, createEvent, updateEvent, deleteEvent
  // 全部操作同一个数据资源 CalendarEvent，是纯粹的业务领域 CRUD
}

otaAccount: {
  startLogin,                // 发起登录动作，返回值是 BrowserTab，本质是"开一个标签页"
  createFromCookie,          // 同上
  createFromExistingSession, // 同上
  listByChannel,             // 真的在读 OtaAccount 记录
  openExisting,               // 返回值也是 BrowserTab，业务上"按登录身份打开标签页"
  accountBound,               // 事件通知，不是请求/响应
}
```

**`browser` 是机制层**（怎么操作一个标签页，跟业务无关），**`calendar`/`otaAccount`/
`otaCredential` 是业务领域**（登录身份、账号发现、日程这些业务概念）。这是两个不同的
维度，不该被放在 `IPC_CHANNELS` 同一层级里并列比较——`otaAccount.startLogin` 返回值
和 `browser.create` 返回值都是 `BrowserTab`，本质都是"机制层：开一个标签页"，只是套了
一层业务判断（"用什么方式、给谁开"），却被塞进了业务分组里。

`otaAccount` 这一组内部还混了三类不同性质的东西：

1. 发起一个动作，最终落地是机制层操作（`startLogin`、`createFromCookie`、
   `createFromExistingSession`）
2. 真正读写一条业务数据记录（`listByChannel`、`openExisting` 之一，取决于具体语义）
3. 订阅一个事件（`accountBound`）

`calendar` 是干净的对照组：4个方法全部是同一数据资源的 CRUD，没有这个问题。

## 7. 业内怎么解决这个问题

Electron 官方不规定业务分组方法论，只规定安全边界（禁止裸转发 `ipcRenderer`）和通信
语义三分（`invoke/handle` = 请求响应，`send/on` = 单向事件）。分组原则要参考更成熟的
双进程/多进程桌面架构：

- **VS Code**：机制层命令走一个扁平的命令注册表（`ExtHostCommands`，任何人可以注册一个
  动词），业务领域各自是独立的领域服务（`ExtHostSCM`、`ExtHostWorkspace`）。命令表和
  领域服务从不在同一层级并列——领域服务内部可以调命令表，但命令表不会把某个领域服务
  整个摆进自己的分组列表里。
- **Tauri**：裸机制命令放 `commands.rs`，复杂业务功能一律下沉成独立 plugin，各自带自己
  的命令集合，机制层和业务插件是两套不同的注册体系。

**通用做法是两层根 + 领域内部再按性质三分**：

```
window.platform.tab.*        机制层：create/activate/close/goBack，不含业务语义

window.domain.otaLogin.commands.startLogin(...)   业务领域内的"动作"
window.domain.otaLogin.queries.getAccount(id)     业务领域内的"查询"
window.domain.otaLogin.events.onStatusChanged(cb) 业务领域内的"事件"

window.domain.calendar.*      纯 CRUD 领域可以不用三分，直接铺平
```

第一层根回答"这是机制能力还是业务领域"；领域内部再按 command/query/event 三分，解决
"一个业务分组里混了动作、CRUD、事件三种不同性质方法"的问题。纯 CRUD 领域（比如
`calendar`）如果强行套三分反而是过度设计，允许领域内部按自己的复杂度决定要不要三分。

对照到这个仓库现在的命名，大致方向是：`otaAccount.startLogin`/`createFromCookie`/
`createFromExistingSession` 这三个（返回值都是 `BrowserTab`）应该并入机制层
（`browser.*`），而不是留在业务分组里；`otaAccount.listByChannel`/`openExisting`、
`otaCredential.listByChannel`/`openExisting` 才是真正该留在各自业务领域分组里的方法；
`accountBound` 这类事件适合单独归类，不和请求/响应方法混在一起。**这是命名和分组问题，
不是现在就要动的重构任务**——本文只是把判断依据讲清楚。
