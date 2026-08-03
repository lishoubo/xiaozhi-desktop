# 两种"打开登录标签页"的流程

日期：2026-08-03
状态：设计说明，配套 `openspec/changes/cookie-login-account-discovery/`

本文厘清一个容易混淆的问题：`BrowserManager` 提供了两个开标签页的方法
（`createWithAlreadyPartition` / `createAndNewPartition`，见 Task 3 实现），
对应两种完全不同阶段、不同触发方式的用户操作。写 IPC/renderer 之前必须先
分清楚这两条路径各自在流程的什么位置，不能混着设计成一个入口。

---

## 流程 A：cookie 导入 → 去登录（本次要实现的链路）

这是本次 `cookie-login-account-discovery` 分支要打通的主线。**这一步操作
的时候，`OtaAccount` 还不存在**——不是"选一个账号去登录"，而是"这个渠道
之前导过 cookie，让这份 cookie 第一次真正生效"。

```
用户点"导入 Cookie"（一次性读取所有渠道，不预选）
        ↓
按渠道存文件：<userData>/cookie-imports/<channel>/{manifest.json, cookies.json}
        ↓
renderer 按渠道分组展示："携程 / 美团 / 抖音…" 各自"已导入，待登录确认"
        ↓
用户点某个渠道卡片上的"去登录"          ← 这里，操作粒度是【渠道】，不是【账号】
        ↓
IPC → main：BrowserManager.createAndNewPartition(environment, channel, url, {
              importedCookies: 该渠道已导入的 cookie（若存在）
            })
        ↓
SessionFactory.sessionForLogin 当场生成短id，拼出全新 partitionName
（如 persist:xiaozhi:prod:douyin:a1b2c3d4）——这一刻数据库里没有任何
OtaAccount 记录知道这个字符串，这是设计上故意的：账号要等探测成功才存在
        ↓
已导入的 cookie 注入这个新 partition，标签页加载渠道后台页面
        ↓
用户在标签页里操作：cookie 有效时大概率直接免密登录、只需选公司/选门店；
cookie 失效则用户在标签页里正常重新登录
        ↓
用户关闭标签页
        ↓
【Task 4，本次不做】触发账号探测 → 按 (channel, otaHotelId) 查重 →
  不存在则创建 OtaAccount；已存在则更新其 partitionName 为这次新登录
  （design.md 决策 7）→ 若探测到多个门店，弹出列表让用户勾选，只为
  选中的创建/更新账号
```

**本次范围的断点**：探测逻辑依赖抖音接口踩点（"选公司"页面选完之后，
session/页面里到底能读到什么门店身份信息），这次先不做。用户走完"去
登录"、在标签页里操作、关闭标签页之后，流程会断在这里——**新生成的
partitionName 如果完全不落地记录，这次登录就变成了磁盘上一个没人认领
的孤儿 partition，用户等于白操作了一次，且无法追溯**。所以哪怕探测本
身不做，也必须有一个占位动作把这次的 `{ channel, partitionName,
importedAt }` 存下来，作为"待探测"状态，等 Task 4 落地后能够补跑。

## 流程 B：账号列表 → 直接打开（已有能力，本次不新增 UI）

这条路径服务于**账号已经存在之后**的日常操作——比如用户想看一眼"携程门
店 A"的后台、核对信息、手动做点什么。这一步操作粒度是**具体账号**：

```
用户在"我的账号"列表里点某个已建好的账号（如"携程门店 A"）
        ↓
IPC → main：查 OtaAccountRepository，取出这条记录的 partitionName
        ↓
BrowserManager.createWithAlreadyPartition(那个 partitionName, channel, url)
        ↓
直接用这份已存在的登录态打开标签页——不生成新 partition，不注入 cookie
（partition 里本来就有这个账号的登录态，Electron session 自己管理
cookie 的刷新/过期）
        ↓
标签页关闭：不触发探测（这份登录态早就有账号了，没有"发现新账号"这回事）
```

`createWithAlreadyPartition` 在 Task 3 已经实现，但**目前没有任何 IPC/UI
调用它**——因为触发它的前提"账号列表页面"还不存在（属于 Task 7 之后、
账号真正开始被建出来才有意义的功能）。这次实现流程 A 时不要往这个方向
多做，等 Task 4 探测跑通、账号能被建出来之后再补。

## 两条路径的关键区别

| | 流程 A：去登录 | 流程 B：打开已有账号 |
|---|---|---|
| 触发入口 | 渠道卡片（导入结果里）| 账号列表 |
| 操作粒度 | 渠道（`channel`）| 具体账号（`OtaAccountId`） |
| partitionName 从哪来 | 当场随机生成（新） | 查 `OtaAccount.partitionName`（已有）|
| 是否注入 cookie | 是（若该渠道有已导入的） | 否（partition 里本就有）|
| 标签页关闭后做什么 | 触发探测（建号/查重更新）| 什么都不做 |
| `BrowserManager` 方法 | `createAndNewPartition` | `createWithAlreadyPartition` |
| 本次是否实现 UI | 是（Task 6/7） | 否（等账号列表页面出现后再做）|

## 两个进程、三个术语的关系（辅助理解）

Electron 应用分两个进程，只能通过 IPC（进程间通信）交换消息：

- **`main` 进程**：Node.js 环境，`BrowserManager`/`SessionFactory`/
  `SqliteOtaAccountRepository` 都在这里；能建标签页（`WebContentsView`）、
  碰文件系统、连数据库。
- **`renderer` 进程**：就是用户看到的整个 App 界面（Svelte 写的），包括
  标签页栏、按钮、卡片这些外壳 UI；是沙箱环境，不能直接建标签页/碰文件系统。
- **IPC handler**：写在 `main` 进程里、专门接 `renderer` 发来的请求的函数
  （如 `browser-handlers.ts` 里 `ipcMain.handle(...)` 注册的那些回调）。

用户在标签页里看到的"携程网站内容"，是 `main` 进程创建的内嵌浏览器视图
（`WebContentsView`），被摆放展示在 `renderer` UI 的某块区域里——不是独立
弹出的系统浏览器窗口。用户点击操作会通过 IPC 发给 `main`，`main` 执行真
正的浏览器操作后，再把最新状态通过 IPC 广播回 `renderer` 更新界面。
