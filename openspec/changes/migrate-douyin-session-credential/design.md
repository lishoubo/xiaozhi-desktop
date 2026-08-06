## Context

抖音现有 discovery 已直接操作用户可见的当前 `webContents`：从落地 URL 读取 `groupid`，点击
“门店管理”，再通过 CDP 捕获页面原生 `dsl/get` 响应获得酒店 ID 和名称。它返回通用 `single`
结果，`DiscoverAndCreate` 因而只创建 `channelAccountId=null`、`credentialExtra=null` 的
credential。

真机结构日志确认当前页面的 `sessionStorage.PartnerPrefetchStorage` 只有 `getAccountDetail` 和
`getPassportAccount`，不包含踩点记录中的 `getLoginInfo`。页面缓存与网络缓存同时确认登录资料
来自同源 `GET /life/gate/v1/user/login_info/`，其中 `user_id` 是登录用户身份。

## Goals / Non-Goals

**Goals:**

- 在当前可见 View 中同源请求登录信息接口，复用其 cookie/session 识别登录用户。
- 保留已验证的 CDP 酒店发现流程和 `groupid` 绑定语义。
- 让抖音模块一次返回 credential 身份与一家酒店，并分别持久化。

**Non-Goals:**

- 不修改抖音多商户组选择流程。
- 不把 `groupid`、酒店 ID 或角色 ID 当作登录用户 ID。
- 不保存完整缓存、头像、日志 ID、token 或未选定字段。
- 不新增统一 ChannelAdapter。

## Decisions

### 1. 在当前可见 View 同源读取登录信息

页面表达式调用 `GET /life/gate/v1/user/login_info/`，只携带 `groupId` 与 `accountId`，并设置
`credentials: 'include'` 复用当前 View 的登录态。请求的 `groupId` 来自当前页面 URL 的
`groupid`，`accountId` 来自 `PartnerPrefetchStorage.getAccountDetail.data.account_id`；两者语义
独立，不使用 `groupid` 猜测 `accountId`。表达式只从响应 `data` 返回 `user_id`、
`login_id`、`name`、`role_name` 和 `role_type`。

不创建隐藏 View、不复制 cookie，也不从 `getPassportAccount` 的摘要字段猜测角色身份。接口失败
或响应字段不完整时返回 `none`。

### 2. 主进程再次校验白名单结果

页面表达式返回值按 `unknown` 进入主进程，由 Zod 接受字符串或数字形式的 ID/枚举并正规化。
`user_id` 必须非空并成为 `channelAccountId`；`login_id`、`name`、`role_name` 和 `role_type` 必须
完整并进入 `credentialExtra`。即使页面表达式被改动，也不能绕过主进程白名单。

账号身份是本次完整发现的必要条件。接口失败或字段不完整时直接返回 `none`，不创建空身份
credential，也不使用 `groupid` 回退。

### 3. 酒店发现保持现状并迁移到渠道模块

原 `account-discovery/douyin-discovery.ts` 迁移为 `main/ota/douyin/discover-douyin.ts`，保留
菜单轮询、CDP `responseReceived/loadingFinished/getResponseBody` 和酒店解析逻辑。账号身份确认
后再启动酒店响应捕获；成功结果包含一个 credential 和一个酒店。

`DiscoverAndCreate` 增加与携程、美团并列的抖音显式分支，复用其内部带身份持久化流程。通用
probe registry 不再注册抖音，但接口保留给未迁移渠道和现有测试，不引入渠道调用抽象。

## Risks / Trade-offs

- [登录信息接口发生变化] → 当前 View 请求失败时返回 `none`，主进程继续做严格白名单校验。
- [身份已读到但酒店 CDP 捕获失败] → 整次发现不落库，避免留下用户无法操作的孤立 credential。
- [当前酒店捕获会改变可见页面] → 保持已验证行为，本 change 不改变菜单点击交互。

## Migration Plan

1. 用解析器和当前 View 测试覆盖同源接口、无效身份与白名单字段。
2. 迁移既有抖音 discovery，并用编排测试锁定 credential/account 分离落库。
3. 运行 desktop 受影响模块验证、verification 和 code-review pass。
4. 同步稳定规范；本次无数据库 schema 或数据迁移。
