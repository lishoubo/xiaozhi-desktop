# OTA 登录、酒店身份与绑定关系：现状梳理

> 日期：2026-08-05
>
> 性质：现状调查，不是目标方案
>
> 输入：`docs/踩点/ota登陆问题.md`、`docs/踩点/ota登陆建议.md`、本仓库当前代码与 OpenSpec 变更、`xiaozhi-rms-workspace` 当前接口与实现

## 1. 结论摘要

目前的困难不只是“桌面端和 RMS 各有一套 `OtaAccount`”，而是两边都把不同概念压进了同一个名字，只是耦合范围不同：

- 桌面端 `OtaAccount` = **一个 OTA 酒店身份 + 一份本地浏览器登录态的 partition 指针 + 渠道附加上下文**。
- RMS `OtaAccount` = **实体酒店与渠道的绑定槽位 + 登录输入 + cookie + OTA 酒店身份 + 爬虫上下文 + 生命周期状态**。
- 桌面端尚无实体酒店、远端绑定或 RMS 账号模型；酒店管理页仍是 mock UI。
- 桌面端与本项目 server 之间只有一个未被业务使用的 tRPC client，共享 contract 只有 `system.health`；本项目 server 也没有接入 RMS OTA/酒店接口。
- RMS 给 desktop 的专用接口目前只有“按组织列出 OTA 账号”和“替换指定账号 cookie”，不能独立支撑酒店列表、新增酒店、绑定、解绑和完整详情展示。
- 抖音的 `groupId` 已经作为“进入商户上下文所需参数”被两端保存。2026-08-05 本机 Chrome 实测确认：同一 profile 下两个不同 `groupId` 的 tab 使用完全相同的适用 cookie 集合，`groupId` 不是 tab 级 cookie 隔离键。RMS 当前跨酒店借用 cookie 的键也是 `orgId + source + username`，不是 `groupId`。
- 当前浏览器打开行为没有显式的 intent：新建登录、cookie 登录、打开已有账号、复用已有 session 探测，靠不同方法和可选回调隐式组合。尚不存在“验证远端绑定是否仍有效并回传 cookie”的完整流程。

因此，在继续设计 UI 或 API 前，首先要把“登录凭据、OTA 酒店、实体酒店、绑定关系、爬虫登录上下文”从术语上分清；是否最终拆成独立数据库实体，仍属于下一阶段设计决策。

## 2. 先分清五类事实

| 概念 | 含义 | 当前桌面端载体 | 当前 RMS 载体 |
|---|---|---|---|
| 实体酒店 | 我方管理的物理酒店，如“A 酒店” | 不存在；酒店页只有 mock `ManagedHotel` | `Hotel`，以 `hotelId` 标识 |
| OTA 酒店 | 某渠道内的酒店/POI | `OtaAccount.otaHotelId/otaHotelName` | `OtaAccount.otaHotelId/otaHotelName` |
| 登录凭据/会话 | 能向 OTA 发起已认证请求的状态，核心是 cookie | Electron partition 内的 cookie；另有按渠道保存的导入暂存文件 | `OtaAccount.cookieCiphertext`；也可保存用户名和密码 |
| 爬虫登录上下文 | 有 cookie 仍不足以定位业务页面时所需的信息，如抖音 `groupId`、美团 `partnerId` | `OtaAccount.channelContext` 字符串 | `OtaAccount.bindExtra` JSON |
| 实体酒店与 OTA 酒店的绑定 | “A 酒店在抖音对应哪个 OTA 酒店” | 不存在 | 由一条带 `hotelId + source + otaHotelId` 的 `OtaAccount` 行隐式表达 |

这里最容易混淆的是“登录态”和“OTA 酒店”：

- 一份登录态可能能访问多个 OTA 酒店。
- 一个实体酒店的每个渠道位最终只绑定一个 OTA 酒店。
- `partition` 是 Electron 的本地存储容器，不是业务账号，也不是绑定关系。
- `groupId` 是抖音商户上下文，目前不能据此直接推导 cookie 的归属范围。

## 3. 当前整体链路

```text
浏览器 Cookie 导入文件（按渠道暂存）
              │
              ▼
打开新 partition ── 注入 cookie（可选）── 用户在 OTA 页面内完成登录/选择
              │
              ▼ URL 判定“已越过登录页”
渠道 DiscoveryProbe 从页面/接口响应探测当前 OTA 酒店
              │
              ▼
本地 SQLite ota_account
  { channel, otaHotelId, otaHotelName, partitionName, channelContext }

              当前没有连接
                     ╳

RMS Hotel ── RMS OtaAccount
  实体酒店      绑定 + 凭据 + cookie + OTA 酒店 + 状态 + bindExtra
```

这条图中最重要的空白是中间的 `╳`：本地建号成功后不会同步到本项目 server 或 RMS；RMS 账号失效也不会触发桌面端查找 partition、验证页面、导出 cookie 并回传。

## 4. 桌面端实际实现

### 4.1 本地 `OtaAccount`

当前字段为：

```ts
{
  id,
  channel,
  otaHotelId,
  otaHotelName,
  partitionName,
  channelContext,
  discoveredAt
}
```

其实际语义是“已探测到、可由本地浏览器继续操作的一家渠道酒店”，不是远端绑定账号：

- 唯一索引是 `(channel, ota_hotel_id)`。
- 没有实体 `hotelId`、`orgId`、远端 `otaAccountId`、绑定状态或同步状态。
- `partitionName` 是定位 Electron session 的唯一指针，cookie 本身不进本地 SQLite。
- `channelContext` 的内容按渠道变化：抖音存裸 `groupId`，美团存 `{partnerId, partnerName}` JSON，携程为 `null`。
- 一条记录只能放一个 `otaHotelId`；数据库允许多条记录引用同一个 `partitionName`，但没有独立的“登录凭据/登录态”记录。

所以它同时承担了两件事：

1. 记录 OTA 酒店身份；
2. 指向访问该酒店所用的登录态。

### 4.2 Cookie 的三种位置

当前至少存在三种不同形态，不能统称为同一个“cookie”：

1. **外部浏览器导入暂存**：`<userData>/cookie-imports/<channel>/` 下的文件，按渠道整体覆盖，尚未对应某个具体账号或酒店。
2. **Electron 运行登录态**：写入某个 persistent partition，由 Chromium 原生保存和刷新；本地 `OtaAccount` 只保存 partition 名字。
3. **RMS 登录 cookie**：一个字符串，经 RMS AES-GCM 加密后存入 `ota_account.cookie_jar_cipher`。

桌面端当前有“将导入 cookie 写进新 partition”的代码，但没有：

- 将 partition 中的 cookie 按 RMS 所需格式序列化；
- 将 cookie 发送给本项目 server/RMS；
- 从一个 partition 复制 cookie 到另一个 partition；
- 对 cookie 同步范围、允许域名、删除项和覆盖规则作出 contract 约定。

### 4.3 登录与探测流程

现有入口大致分为四类：

| 入口 | partition | cookie 来源 | 到达登录后页面后的行为 |
|---|---|---|---|
| 新建账号 | 新建 | 无 | URL matcher 命中后探测并建本地 `OtaAccount` |
| 从已导入 cookie 登录 | 新建 | 渠道级暂存文件 | 携程首次加载即探测；其他渠道由 URL matcher 触发 |
| 打开已有账号 | 复用 `OtaAccount.partitionName` | partition 原有 cookie | 只打开页面，不做登录健康检查或重新探测 |
| 抖音“服务商切换” | 复用已有 partition | partition 原有 cookie | URL matcher 命中后尝试再次探测并建号 |

`BrowserManager` 暴露 `createAndNewPartition` 与 `createWithAlreadyPartition`，再由调用方选择传入：

- `importedCookies`
- `loginUrlMatcher + onUrlPastLogin`
- `onLoadFinished`

这些可选项实际表达了操作目的，但代码里没有 `login`、`discover`、`validate-and-refresh`、`browse` 等显式 intent，也没有“意图决定监听哪些页面、URL 或接口”的统一注册点。

### 4.4 探测能力的实际边界

- 携程：从页面 DOM 解析一家 OTA 酒店。
- 美团：调用同源接口，可能返回多家酒店。
- 抖音：从当前 URL 取 `groupId`，进入门店管理，借 CDP 被动捕获 `dsl/get` 响应，得到当前一家酒店。

`DiscoveryOutcome` 支持 `multiple`，但 `DiscoverAndCreate` 对多结果只记录日志并返回，不落库；renderer 没有选择并确认多酒店的完整入口。因此美团多店并未形成闭环，抖音也没有一次枚举某个服务商/公司下全部酒店的能力。

另外，`DiscoverAndCreate` 用 `bound: Set<partitionName>` 规定“一个 partition 在当前进程成功探测一次后不再探测”。这与“复用同一个抖音 partition 再切换商户/酒店并创建第二条账号”的目标存在直接冲突：

- 数据模型允许多条账号共享 partition；
- 当前进程内的探测去重却会阻止同一 partition 的第二次成功探测；
- 应用重启后内存 Set 清空，行为又会变化。

因此，“同一登录态下创建多个抖音 OTA 酒店账号”目前不是稳定、已验证的能力。

### 4.5 酒店管理页

当前页面是纯 renderer 原型：

- 数据来自 `MOCK_MANAGED_HOTELS`。
- `ManagedHotel` 与 `BoundOtaAccount` 是 renderer 展示类型，不是共享 contract。
- 新增绑定、管理、重新登录、重试等按钮只显示“暂未连接服务端”通知。
- 页面没有 loading/error/refresh，也没有 main/preload/tRPC 数据通路。
- 对应 OpenSpec `add-hotel-management-page` 明确把服务端、IPC 和数据库接入排除在本期范围外；verification 与 code-review 任务仍未完成。

### 4.6 登录与 server 通路

桌面应用自己的登录仍是 renderer mock：固定手机号/验证码，session 存在 `localStorage`。main 进程不知道真实用户、组织和权限。

本项目的远端通路现状：

- `packages/api` 只有公开的 `system.health` tRPC procedure。
- desktop main 有 `createServerTrpcClient`，但没有业务调用方，也没有携带用户会话的实现。
- `apps/server` 使用 Better Auth 和 PostgreSQL 管自己的用户；尚未建立该身份与 RMS employee/org/hotel 权限之间的映射。
- `apps/server` 虽有只读 RMS MySQL 连接基础设施，但 OTA/酒店业务不应绕过 RMS 领域服务直接改库；当前也没有相关查询实现。

## 5. RMS 实际实现

### 5.1 `Hotel` 是实体酒店权威

RMS `Hotel` 已包含 `id/orgId/name/shortName/省市区/类型/房间数/status` 等字段。RMS 也已有面向自身 Web 端的酒店创建、更新和列表 REST API。

但这些接口不属于 `DesktopOtaAccountApi`，本项目 server 尚未调用它们，也没有把对应 contract 定义到 `packages/api`。

### 5.2 RMS `OtaAccount` 是聚合模型

RMS 一行同时包含：

- 所属：`hotelId`、`orgId`、`source`
- 登录输入：`username`、加密 password
- 登录结果：加密 cookie、`lastLoginAt`
- OTA 酒店：`otaHotelId`、`otaHotelName`
- 状态：`PENDING_LOGIN/BOUND/LOGIN_EXPIRED/...`
- 爬虫上下文：`bindExtra`，如 `merchantGroupId`、`otaPartnerId`、登录方式和手机号
- 绑定生命周期：`deletedAt`、`bindError`、`lastInitAt`

这意味着 RMS 当前没有独立的：

- OTA 酒店实体；
- 实体酒店—OTA 酒店绑定表；
- 可由多条绑定共享的 credential/login-session 实体。

应用服务还显式执行“同酒店同渠道复用同一槽位”：更换用户名时会覆盖凭据并清掉旧 OTA 酒店信息。数据库 V17 的唯一索引为 `(org_id, hotel_id, source, ota_hotel_id)`，而应用服务的查找与更新逻辑仍以“同酒店同渠道一份活跃绑定”为主。数据库约束和应用层语义并不完全等价，应在未来改模前单独核对历史数据和软删行为。

### 5.3 Desktop 专用 API 的能力

`DesktopOtaAccountApi` 当前只有：

```text
GET  /api/v1/desktop/ota-accounts?orgId=...
POST /api/v1/desktop/ota-accounts/{otaAccountId}/cookie
```

列表返回：

```text
id, orgId, hotelId, hotelName, source, username, status, bindExtra
```

它不返回 `otaHotelId`、`otaHotelName`、`lastLoginAt`、`lastInitAt`、`bindError` 或时间戳，而当前酒店管理 mock 页面展示了其中多项。它也只返回已有 OTA 账号，不能返回“尚未绑定任何渠道的酒店”。

cookie 更新接口会：

- 校验员工组织和酒店访问权限；
- 接收一个非空、最大 256 KiB 的 cookie 字符串；
- 加密保存；
- 将该 RMS `OtaAccount` 状态置为 `BOUND` 并更新最近登录时间。

它不会创建账号、变更 OTA 酒店身份、写 `groupId`、建立绑定或解绑。

### 5.4 RMS 的抖音 cookie 复用

RMS 在执行抖音 `LOGIN_OTA` 时，如果当前绑定没有 cookie，会查找：

```text
同 orgId + 同 source + 同 username + 最近更新 + 状态 BOUND
```

并借用该账号的 cookie。由此可以确认：

- RMS 已把“同一个抖音登录账号可服务多家实体酒店”作为现实场景处理；
- 当前复用身份键是 `username`，不是 `merchantGroupId`；
- 复用是任务 payload 生成时的借用，不是把多行真正关联到一个 credential，也不会在某行 cookie 更新后自动同步其他行；
- `merchantGroupId` 仍按每条绑定保存在 `bindExtra`，用于进入目标商户上下文。

## 6. 两套模型无法直接映射的地方

| 问题 | 桌面端 | RMS | 直接映射为何失败 |
|---|---|---|---|
| 账号主键 | 本地 UUID 字符串 | 远端 Long | 没有远端 ID 映射字段 |
| 账号归属 | 只归渠道/OTA 酒店 | 归实体酒店、组织和渠道 | 本地没有实体酒店与绑定 |
| 登录身份 | 通常不知道手机号/用户名 | username 是复用和展示字段 | 浏览器内登录后未必能可靠探测 username |
| cookie | partition 内原生 cookies | 加密 cookie 字符串 | 缺序列化与同步 contract |
| 多酒店登录态 | 可让多行引用同一 partition，但流程不闭环 | 多行各存 cookie，任务时可按 username 借用 | 两边共享键不同，也都没有 credential 实体 |
| 抖音 group | 裸 `channelContext` | `bindExtra.merchantGroupId` | 可转换但不是已验证的登录态唯一键 |
| 绑定状态 | 没有 | `status` 与错误/时间戳 | 本地列表只能远端拉取，无法由本地记录推导 |
| 无绑定酒店 | 本地无酒店实体 | `Hotel` 可独立存在 | Desktop OTA 列表无法返回它们 |

## 7. 抖音：已知事实与未验证假设

### 已知事实

- 用户登录抖音来客后会进入公司/商户上下文，URL 含 `groupId`。
- 当前桌面探测能从该上下文抓到当前一家 OTA 酒店的 ID 和名称。
- 桌面端已有“复用同一 partition 打开页面并再次探测”的服务商切换入口，但该流程尚未完整验收。
- RMS 保存每条绑定的 `merchantGroupId`，并能按同 username 跨酒店借 cookie。
- Electron 技术上支持从一个 partition 读取 cookies 后写入另一个 partition，但本项目尚无该实现。

### 2026-08-05 本机 Chrome 验证

在本机 Chrome `Default` profile 的同一窗口中，定位到两个同时打开的抖音来客普通 tab：

```text
groupId=1808569915022548
groupId=1735800488519687
```

第二个 tab 已经从讨论开始时给出的 `groupId=1737229348435016` 导航到 `1735800488519687`，以下结论以检查时实际打开的两个 URL 为准。

只读查询 Chrome Cookie 数据库后得到：

| 检查项 | 结果 |
|---|---:|
| 每个 URL 适用的 cookie 记录 | 66 |
| HttpOnly 记录 | 43 |
| Chrome partitioned cookie 记录 | 13 |
| 不同 cookie 名称 | 52 |
| 两个当前 URL 的适用 cookie key 差异 | 0 |
| `/p/home` 与两个 `/p/liteapp/...` URL 的适用 cookie key 差异 | 0 |

核心登录 cookie 的作用域都是站点级：

- `.douyin.com /`：`sessionid`、`sessionid_ss`、`sid_guard`、`sid_tt`、`uid_tt`、`ttwid` 等。
- `.life.douyin.com /`：`sessionid_ls`、`sid_guard_ls`、`uid_tt_ls` 等。
- 发现的 `/p` 路径 cookie 同样同时适用于两个被检查页面。
- Chrome partitioned cookie 按顶级站点分区；两个 tab 的顶级站点相同，因此不是按 `groupId` 分区。

检查过程没有读取或输出 cookie 明文值。由于两个普通 tab 位于同一 Chrome profile、命中同一组 cookie 存储记录，它们不存在各自独立的 `sessionid`；任一 tab 更新同一个 cookie key 后，另一个 tab 也会使用更新后的共享值。

这次实测支持以下工作模型：

```text
共享 cookie ──► 认证登录账号/服务商身份
                      │
                      ├── URL/请求 groupId=A ──► 商户上下文 A
                      └── URL/请求 groupId=B ──► 商户上下文 B
```

现有抖音探测代码也提供了实现侧佐证：页面原生发出的 `dsl/get` 请求会在 `extra_param.router_back` 中携带当前页面的 `groupId`。因此，`groupId` 更像业务上下文选择器；抖音服务端再判断当前登录账号是否有权访问该商户，而不是由浏览器切换另一份 cookie。

本次验证的边界：只检查了一个 Chrome profile 中的一套当前登录态，没有验证不同抖音登录账号、不同服务商身份或无权限 `groupId` 之间如何隔离，也没有抓取并对比具体业务 API 的完整请求头和请求体。

### 尚不能下结论

- 不同抖音登录账号或服务商身份之间，cookie 的稳定业务唯一键究竟是 username、账号 ID 还是其他标识。
- 同一登录账号可访问的全部 `groupId` 如何枚举，以及无权限 `groupId` 的服务端拒绝行为。
- 复制 cookie 后，刷新 token、设备指纹或后续 Set-Cookie 是否会让各 partition 再次分叉。
- 一个 `groupId` 下究竟如何稳定枚举多个 OTA 酒店，以及 group/company/hotel 的退化关系。
- 登录一个 partition 后，其他历史 partition 应该复制 cookie、改为共享同一 partition，还是只把新 cookie 同步到 RMS。

本机实测已经否定“同一 Chrome profile 中每个 `groupId` 各有一份 tab 级 cookie”这一模型；但它还不足以单独决定桌面端应按什么业务键归并历史 partition。目标模型仍需结合多账号实测、RMS username 数据和登录后可探测的稳定身份共同确定。

## 8. 历史讨论中已表达、但尚未落地的意图

以下是讨论中较稳定的产品意图，不是当前能力：

- 酒店管理页从远端加载实体酒店及各渠道绑定状态。
- 新增酒店以服务端成功为准；失败即失败，不在本地保留待同步酒店。
- 一个实体酒店的一个渠道位只能绑定一个 OTA 酒店。
- 绑定时可新登录，也可复用本地已有登录态。
- 解绑只解除远端绑定，不清除本地 partition/cookie。
- 远端绑定登录失效时，从桌面端打开对应登录态；成功后读取最新 cookie 并回传 RMS。
- 浏览器打开动作需要能按目的选择不同监听器，未来可能由 MCP 形式的渠道能力提供探测。

历史讨论曾提出直接给本地 `OtaAccount` 增加 `groupId/groupName/extra`，后来 `ota登陆建议.md` 又进一步提出独立 `ota_login_info`。两者是不同建模方向，目前都没有进入正式 OpenSpec proposal，也没有实现；不能把前者视为已定方案。

## 9. 现有文档与代码的偏差

理解现状时不能只读 2026-08-03 的“定稿”文档：

- `domain-model.md` 的 D1 仍写“所有 OTA 账号共用 session”，当前代码已使用随机 per-login partition，这一缺陷描述已过时。
- 同文档明确“不设 `OtaCredential`”，依据是当时没有独立凭据历史或远端同步需求；新的酒店绑定、cookie 回传和跨酒店复用需求已经使该依据需要重审。
- 文档曾规定 partition 永不删除，但当前 `DiscoverAndCreate` 在同一 `(channel, otaHotelId)` 重新登录时会尝试删除旧 partition。
- `douyin-multi-account-nav` 的设计希望多条账号共享 partition，但当前 `bound Set` 会阻断同进程内的再次探测。
- 多个相关 OpenSpec change 尚未归档，且没有 `verification.md`；任务勾选和代码注释中记录了部分真机结果，但不能等同于完整验收。

这些偏差不是本次修复范围，但下一份 proposal 必须以当前代码和重新确认后的规范为准，不能继续叠加旧假设。

## 10. 下一阶段设计前必须回答的问题

1. **业务实体边界**：是否正式拆出 OTA 酒店、绑定、credential/login-info；每个实体的权威在桌面还是 RMS。
2. **绑定键**：实体酒店×渠道是否严格单槽位；换 OTA 酒店是更新绑定还是新建后解绑旧绑定。
3. **登录态共享键**：各渠道分别按 username、groupId、partnerId 或其他稳定身份关联；拿不到 username 时如何处理。
4. **Cookie contract**：桌面如何筛选、排序和序列化 Electron cookies；RMS worker 当前实际接受哪种字符串格式；安全审计与日志脱敏边界是什么。
5. **抖音补充实测**：在已确认“同一 profile 可用共享 cookie 同时打开不同 group”的基础上，继续验证不同登录账号的隔离键、同 group 多酒店、无权限 group 和 cookie 跨 partition 复制。
6. **浏览器 intent**：登录发现、绑定确认、健康检查/刷新、普通浏览、服务商切换分别监听什么，何时结束，结果交给谁。
7. **远端接口归属**：desktop 是否只调用本项目 server 的 tRPC；若是，server 如何代表当前用户访问 RMS，组织/酒店权限如何映射。
8. **已有本地数据迁移**：现有 `ota_account` 和 partition 如何映射到新模型；无法识别登录身份的历史记录如何保留。

## 11. 可确认的当前边界

在上述问题解决前，可以确认：

- 当前酒店管理页适合作为信息架构原型，不是可直接接 API 的完成模型。
- 现有 Desktop RMS API 可以作为“列出部分绑定信息”和“刷新已有绑定 cookie”的基础，但不是完整 contract。
- 本地 `OtaAccount` 不能直接改名为 `RmsOtaAccount`，也不能直接与远端行合并；两者标识和职责都不同。
- `partitionName` 必须留在 desktop main 基础设施边界，不应进入远端 contract 或 renderer 业务模型。
- 下一步应先形成新的 OpenSpec proposal/design/tasks，明确模型和 contract，再分别修改 `packages/api`、server、desktop main/preload/renderer；不宜直接从酒店页按钮开始接线。

## 12. 主要证据位置

桌面端：

- `apps/desktop/src/domain/ota-account.ts`
- `apps/desktop/src/main/account-discovery/discover-and-create.ts`
- `apps/desktop/src/main/account-discovery/{ctrip,douyin,meituan}-discovery.ts`
- `apps/desktop/src/main/features/ota-account/login-tab-opener.ts`
- `apps/desktop/src/main/browser/browser-manager.ts`
- `apps/desktop/src/main/ipc/browser-handlers.ts`
- `apps/desktop/src/main/database/application-database.ts`
- `apps/desktop/src/renderer/hotel-management/`
- `apps/desktop/src/renderer/pages/HotelManagementPage.svelte`
- `apps/desktop/src/renderer/auth.ts`
- `packages/api/src/router.ts`

相关未归档变更：

- `openspec/changes/cookie-login-account-discovery/`
- `openspec/changes/douyin-multi-account-nav/`
- `openspec/changes/add-account-flow-per-channel/`
- `openspec/changes/add-hotel-management-page/`

RMS：

- `rms-gateway/.../api/ota/DesktopOtaAccountApi.java`
- `rms-gateway/.../api/ota/DesktopOtaAccountView.java`
- `rms-server/.../interfaces/controller/desktop/DesktopOtaAccountController.java`
- `rms-server/.../domain/ota/OtaAccount.java`
- `rms-server/.../application/ota/OtaAccountAppService.java`
- `rms-server/.../application/ota/task/runner/rpa/compositor/DouyinRpaPayloadCompositor.java`
- `rms-server/.../domain/hotel/Hotel.java`
- `rms-server/.../resources/db/migration/V4__init_ota_account.sql`
- `rms-server/.../resources/db/migration/V17__update_ota_account_unique_key.sql`
