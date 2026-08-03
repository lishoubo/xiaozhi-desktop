# Electron 里 BrowserWindow / WebContentsView / Session / Partition 的关系

日期：2026-08-03
状态：**概念说明**。不涉及本项目的账号/登录业务设计，仅澄清四个基础概念各自是什么、谁包含谁。

---

## 四个概念本身

**Session（会话）**

Chromium 里"一份完整的存储环境"——cookie、localStorage、缓存、权限设置全在里面。是一个真实的运行时对象（`Electron.Session`），也对应磁盘上一份数据。

**Partition（分区）**

给 Session 起的一个"名字/地址"。`session.fromPartition('foo')` 的意思是："给我名字叫 foo 的那个 Session，没有就新建一个"。

- **partition 是 session 的唯一标识符**，两者不是并列关系，是"名字 vs 名字指向的实际对象"。
- 传同一个字符串两次，拿到的是**同一个** Session 对象（Electron 内部有缓存）。

```
partition("foo")  ──指向──▶  Session 对象（真实的 cookie/存储数据）
```

**BrowserWindow（浏览器窗口）**

应用里那个原生窗口外壳。它本身**不持有任何 cookie 数据**，纯粹是个容器/画布。

**WebContentsView（也就是"标签页/tab"）**

真正加载网页、跑 JS、发网络请求的东西。**创建它的时候必须指定一个 Session**（通过 `webPreferences.session`），这个绑定**创建后不能改**。

```
new WebContentsView({ webPreferences: { session: 某个Session对象 } })
                                            ↑
                                    这一步钉死了，以后没法换
```

## 谁包含谁

```
BrowserWindow（一个窗口外壳，不含数据）
  └── 可以装多个 WebContentsView（标签页）
        每个 WebContentsView 创建时绑定一个 Session
                                    ↑
                        这个 Session 由某个 partition 名字唯一确定
```

**关键的多对一关系**：

```
partition "foo" ──▶ Session A ◀── WebContentsView #1（标签页1）
                            ▲
                            └────── WebContentsView #2（标签页2）

partition "bar" ──▶ Session B ◀── WebContentsView #3（标签页3）
```

- 一个 **partition 对应恰好一个 Session**（1:1，partition 就是 Session 的名字）
- 一个 **Session 可以被多个 WebContentsView（多个标签页）共用**（1:N）——两个标签页只要绑的是同一个 partition 名，它们看到的 cookie 就是同一份，登一次号，两个标签页都是登录状态
- 一个 **WebContentsView 只能绑一个 Session**，且创建后终身不变（1:1，且不可变更）
- **BrowserWindow 和 Session 没有直接关系**，窗口只是标签页的展示容器，跟数据存哪毫无关系

## 总结图

```
                    BrowserWindow（外壳，装标签页，不含数据）
                          │
              ┌───────────┼───────────┐
        WebContentsView #1      WebContentsView #2   ← 标签页，各自创建时绑定一个 session
              │                        │
              └──────────┬─────────────┘
                     Session（cookie等数据实体）
                          │
                     由 partition 名字唯一确定
                     "persist:xxx"（这个字符串）
```

## 与本项目现状的关系（不展开设计，仅指出现状事实）

`src/main/browser/browser-manager.ts` 当前的实现：构造函数里创建唯一一个 `this.browserSession = session.fromPartition('persist:hotel-butler-browser')`，`create()` 方法每次开新标签页都传入这同一个 session 对象。也就是说**当前所有标签页共用同一个 partition/Session**，`channelId` 参数只是打日志用的标签，不参与存储隔离。

这是否需要改、要怎么改（例如是否需要"标签页可以先绑一个未确定归属的 session，之后再确定"这类机制），属于业务设计范畴，不在本文讨论。
