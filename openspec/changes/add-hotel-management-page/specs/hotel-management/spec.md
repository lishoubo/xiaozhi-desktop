## Purpose

为已登录的酒店运营人员提供清晰、可扫描的酒店与 OTA 账号绑定总览，并提供与当前账号状态匹配的后续操作入口。

## ADDED Requirements

### Requirement: Hotel management navigation
系统 SHALL 在已登录用户的应用导航中提供“酒店管理”入口，并在用户进入后展示酒店管理页面。

#### Scenario: Open hotel management
- **WHEN** 已登录用户点击“酒店管理”导航入口
- **THEN** 系统展示该用户管理的酒店列表

### Requirement: Managed hotel list
系统 SHALL 以高密度列表展示用户管理的酒店，每个酒店 SHALL 保持为单个列表行，并包含酒店名称、所在城市、已配置的 OTA 账号和酒店级操作入口。

#### Scenario: View multiple managed hotels
- **WHEN** 用户管理多个酒店并进入酒店管理页面
- **THEN** 系统为每个酒店展示一个紧凑的单行条目，使常规桌面窗口可同时浏览多家酒店

#### Scenario: Hotel has no OTA account
- **WHEN** 某酒店尚未配置 OTA 账号
- **THEN** 系统展示明确的空状态并保留“新增绑定账号”入口

### Requirement: Bound OTA account summary
系统 SHALL 将酒店的每个 OTA 账号展示为行内紧凑信息模块，默认突出渠道与绑定状态，并允许用户按需查看账号、OTA 酒店 ID、OTA 酒店名称、服务端 `bindExtra` 中已定义的渠道信息和服务端时间字段。

#### Scenario: View a healthy bound account
- **WHEN** OTA 账号状态为已绑定
- **THEN** 系统在酒店行内展示渠道与正常状态，且不展示登录恢复操作

#### Scenario: View channel-specific metadata
- **WHEN** OTA 账号的 `bindExtra` 包含 `merchantGroupId`、`otaPartnerId`、`loginMethod` 或 `loginPhone`
- **THEN** 用户可从紧凑账号模块按需查看对应的带标签信息，而不是原始 JSON

### Requirement: Server model alignment
系统 SHALL 以服务端 `OtaAccount` 的非凭证字段作为客户端 OTA 账号模型，不得新增服务端不存在的持久化字段。

#### Scenario: Map an OTA account from the server
- **WHEN** 后续同步层将服务端 OTA 账号传给客户端
- **THEN** 客户端可直接映射同名的非凭证字段，包括 `bindExtra` 与登录、初始化、更新等时间字段

#### Scenario: Render channel metadata
- **WHEN** 页面需要展示渠道附加信息
- **THEN** 系统从 `bindExtra` 派生显示内容，不在账号模型中维护 `extraFields`

#### Scenario: Hotel has many OTA accounts
- **WHEN** 单个酒店绑定的 OTA 账号无法在可用行宽内全部展示
- **THEN** 系统保持酒店单行高度并提供明确的剩余账号数量或横向访问方式

### Requirement: Status-aware account actions
系统 SHALL 根据 OTA 账号状态提供可理解的状态说明与上下文操作，并在登录失效或登录失败时提供“去登录”入口。

#### Scenario: Account login expired
- **WHEN** OTA 账号状态为登录已失效
- **THEN** 系统突出显示异常状态、说明需要重新登录，并提供“去登录”操作

#### Scenario: Account initialization failed
- **WHEN** OTA 账号状态为初始化失败、酒店名称不匹配或酒店名称有歧义
- **THEN** 系统展示对应异常说明并提供合适的后续处理入口

### Requirement: Hotel-level binding operations
系统 SHALL 为每个酒店提供“新增绑定账号”和“绑定账号管理”操作入口。

#### Scenario: Start a new account binding
- **WHEN** 用户点击某酒店的“新增绑定账号”
- **THEN** 系统明确反馈操作所针对的酒店，并进入或模拟进入新增绑定流程

#### Scenario: Open account management
- **WHEN** 用户点击某酒店的“绑定账号管理”
- **THEN** 系统明确反馈操作所针对的酒店，并进入或模拟进入账号管理流程

### Requirement: Credential privacy
系统 MUST NOT 在酒店管理页面模型、mock 数据或可见界面中包含密码或 cookie 凭证内容。

#### Scenario: Render hotel account data
- **WHEN** 酒店及 OTA 账号信息在 renderer 中展示
- **THEN** 可展示数据不包含密码密文、cookie 密文或原始 cookie 值
