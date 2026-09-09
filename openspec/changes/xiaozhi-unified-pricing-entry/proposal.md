## Why

RMS 已上线统一改价页（`/unified-pricing`）：用户只填一个卖价，服务端按各渠道当日促销
反算划线价并下发到携程 / 美团 / 抖音，解决「同样填 400，客人在三个平台看到 400 / 380 /
196」的问题。该页面目前只能在浏览器里登录 RMS 后台访问，而真正要改价的酒店前台用的是
desktop —— 每天改价却要切到另一个系统、再登一次录。

desktop 登录后主进程已持有可用的 RMS 会话，把这个页面接进渠道管理只差一个入口。

## What Changes

- 渠道管理（浏览器工作区）顶部第一位新增「小智平台」入口，点击直接在应用内 tab 打开
  统一改价页
- 渠道入口区分 OTA 渠道与内部页面两类：内部页面不参与账号绑定、不出现在账号切换弹窗、
  不在历史绑定记录里被反查
- 主进程新增一条打开内部页面的窄链路，与 OTA 标签页链路并列：使用固定 partition，不做
  登录判定、不做门店探测、不采集 cookie、不监听改价
- 主进程新增「取当前 RMS 访问令牌」的能力，令牌随 URL 传给页面
- 构建期新增 RMS **web 页面地址**，与既有的 RMS **API 地址**分开固化

不传 `refreshToken`、不传 `hotelId`（理由见 design）。

## Capabilities

### New Capabilities

- `desktop-internal-web-pages`: desktop 在应用内打开自有 RMS web 页面的规则 —— 入口如何
  与 OTA 渠道区分、登录态如何传递、会话过期时的归属、以及这条链路 MUST NOT 沾染哪些
  OTA 专属副作用

### Modified Capabilities

- `desktop-build-environments`: 「服务端地址随环境固化」目前只覆盖 RMS API 地址。新增
  要求：RMS web 页面地址同样随环境固化，且 MUST 与 API 地址各自独立取值 —— dev 下两者
  分处不同端口（API `:8080`，web dev server `:5173`），复用同一个值会打开一个不存在的
  页面
- `browser-partition-lifecycle`: 现有规范假定所有 partition 都由 OTA 登录流程创建、都要
  进账本并等待认领。新增要求：内部页面使用固定的长驻 partition，MUST NOT 每次打开新建、
  MUST NOT 登记进账本 —— 否则会堆积永不认领的 `pending` 记录，误触发「认领链路故障」信号

## Impact

**desktop 代码**

| 层 | 影响 |
|---|---|
| 构建期 | 新增 web origin 常量与其 profile 取值、校验 |
| `main/staff-auth/` | `RmsTokenProvider` 增加取当前令牌的方法 |
| `main/browser/` | `SessionFactory` 增加内部页面的固定 session |
| `main/ipc/` | 新增打开内部页面的通道 |
| `renderer/` | 渠道入口数据结构区分类型；点击行为分流 |

**刻意不改**

- `main/ota-tab/`、`main/channels/registry.ts`、`main/channels/landing-url.ts` —— 内部页面
  不走 OTA 链路，registry 不注册即自动不挂载登录判定 / 探测 / 改价监听
- `packages/api/` —— 不新增跨端契约，本次全部是 desktop 进程内的事

**外部依赖（不在本仓库实施）**

统一改价页当前要求 `token` 与 `refreshToken` **成对出现**，缺一个则登录态完全不写入
（`if (token && refreshToken)`），且会话过期时跳转 `/login`。desktop 场景下这两点都不
适用。需要 rms-admin 侧配合调整，诉求详见 `design.md` 的「对 rms-admin 的诉求」一节。

**在该调整落地前，本变更无法端到端联调** —— desktop 侧可以先行实现并验证 URL 拼装与
tab 打开，改价页能否正常渲染取决于对方。
