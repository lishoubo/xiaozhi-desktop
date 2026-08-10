## Purpose

为已登录的酒店运营人员提供可检索、可确认且凭证安全的 RMS 酒店与 OTA 绑定管理入口，并支持使用本地已有 OTA 登录态建立新的酒店绑定。

## ADDED Requirements

### Requirement: Hotel management navigation
系统 SHALL 在已登录用户的应用导航中提供“酒店管理”入口，并在用户进入后加载其可管理的 RMS 酒店及全部活跃 OTA account 最小投影。

#### Scenario: Open hotel management
- **WHEN** 已登录用户点击“酒店管理”导航入口
- **THEN** 系统展示加载状态，并在查询成功后显示远端酒店及其 OTA 绑定

#### Scenario: Remote list fails
- **WHEN** 酒店管理数据加载失败
- **THEN** 系统展示可重试的错误状态，且不得用静态 mock 数据伪装成远端结果

### Requirement: Managed hotel list
系统 SHALL 以紧凑列表展示每家 RMS 酒店及其 OTA account，并允许用户查看酒店名称、酒店状态，以及账号的渠道、OTA 酒店和绑定状态。

#### Scenario: Hotel has no OTA account
- **WHEN** 某酒店没有活跃 OTA account
- **THEN** 系统展示明确空状态并保留新增绑定入口

#### Scenario: Hotel has many OTA accounts
- **WHEN** 单个酒店的 OTA account 无法在可用行宽内全部展示
- **THEN** 系统保持酒店主列表可扫描，并提供明确的剩余数量或按需访问方式

### Requirement: Server model and credential privacy
系统 SHALL 使用最小 RMS 投影构建酒店管理模型：酒店只包含 `id/name/status`；OTA account 只包含 `id/hotelId/otaHotelId/otaHotelName/status/source/bindExtra`。酒店管理数据和远端 mutation MUST NOT 包含 `orgId`、`username`、密码、Cookie、Electron partition 名称或完整本地 credential 扩展数据。

#### Scenario: Render remote account information
- **WHEN** 系统向 renderer 返回酒店管理数据
- **THEN** 响应严格只包含已定义的酒店与 OTA account 最小字段，不包含组织、用户名、密码、Cookie、错误详情或时间字段

#### Scenario: Export binding cookies
- **WHEN** 用户确认新增绑定
- **THEN** main 进程只导出所选 credential 中属于目标渠道域名白名单的 Cookie，并直接交给远端 Gateway

### Requirement: RMS hotel creation
系统 SHALL 允许用户提交 RMS 酒店必填信息，并仅在远端创建成功后将新酒店加入列表。

#### Scenario: Create hotel successfully
- **WHEN** 用户提交有效酒店信息且远端创建成功
- **THEN** 系统重新加载远端酒店数据并展示新酒店

#### Scenario: Create hotel fails
- **WHEN** 远端拒绝或无法完成酒店创建
- **THEN** 系统保留用户可修正的输入并展示失败原因，不得在本地创建待同步酒店

### Requirement: RMS hotel deletion
系统 SHALL 通过远端酒店删除能力删除指定 RMS 酒店，并在调用前要求用户确认目标酒店。

#### Scenario: Delete hotel successfully
- **WHEN** 用户确认删除酒店且远端删除成功
- **THEN** 系统重新加载远端数据，且被删除酒店不再出现在列表中

#### Scenario: Remote hotel deletion is rejected
- **WHEN** 远端因权限、关联数据、并发冲突或其他业务规则拒绝删除
- **THEN** 系统保持当前列表并展示远端错误，不得自行解绑账号或模拟删除成功

### Requirement: OTA binding deletion
系统 SHALL 允许用户确认后删除指定 RMS OTA 绑定，并保留本机的 `OtaCredential`、partition 与 `OtaHotelProb`。

#### Scenario: Delete binding successfully
- **WHEN** 用户确认删除 OTA 绑定且远端成功
- **THEN** 系统使用该绑定的远端 `otaAccountId` 发起解绑并重新加载远端列表，但不删除对应的本地登录态或酒店探测记录

### Requirement: Select an existing credential for binding
系统 SHALL 在用户为某酒店新增渠道绑定时，复用现有 `otaCredential.listByChannel` 查询该渠道已有的本地 `OtaCredential`，并允许用户选择其中一个开始绑定探测。

#### Scenario: Select an existing credential
- **WHEN** 用户在目标酒店和渠道下选择一个已有登录凭据
- **THEN** renderer 只提交 RMS 酒店 ID 和所选 credential ID，main 重新查询 credential、创建可信 intent，并复用其本地登录态打开 OTA 页面

#### Scenario: No local credential exists
- **WHEN** 目标渠道没有本地登录凭据
- **THEN** 系统说明需要先建立渠道登录凭据，且本期不得暗中创建远端绑定

### Requirement: Probe and confirm an OTA hotel binding
系统 SHALL 在带有新增绑定 intent 的 OTA 页面到达可探测状态后复用酒店 Probe，并且只有在用户明确确认候选 OTA 酒店后才能创建远端绑定。

#### Scenario: Probe finds one hotel
- **WHEN** Probe 返回一个 OTA 酒店候选
- **THEN** 系统展示 RMS 目标酒店、渠道和候选 OTA 酒店，并要求用户确认，不得自动绑定

#### Scenario: Probe finds multiple hotels
- **WHEN** Probe 返回多个 OTA 酒店候选
- **THEN** 系统要求用户选择一个候选并确认后才能绑定

#### Scenario: Probe finds no hotel
- **WHEN** Probe 未返回 OTA 酒店候选
- **THEN** 系统展示无法绑定的结果，且不得调用远端绑定接口

#### Scenario: User confirms binding
- **WHEN** 用户确认一个仍属于当前 operation 的候选酒店
- **THEN** main 进程导出渠道 Cookie，提交 RMS 酒店 ID、渠道、OTA 酒店信息、绑定扩展和 Cookie，并在成功后重新加载远端列表

#### Scenario: User cancels binding
- **WHEN** 用户取消确认、关闭操作对应标签页或离开未提交的绑定流程
- **THEN** 系统取消该 operation，且不得创建远端绑定

### Requirement: Binding consistency and idempotency
系统 SHALL 保证同一 RMS 酒店的同一渠道最多存在一个活跃绑定，并对重复事件、重复确认和网络重试执行幂等保护。

#### Scenario: Channel already has a binding
- **WHEN** 目标 RMS 酒店已经存在该渠道的活跃绑定
- **THEN** 系统拒绝从新增流程创建第二个绑定，并引导用户先处理现有绑定

#### Scenario: Confirmation is replayed
- **WHEN** 同一 binding operation 的确认被重复提交
- **THEN** 系统最多调用一次远端创建语义，且最终列表不得出现重复绑定

#### Scenario: Start another binding while one is active
- **WHEN** 已有酒店绑定流程正在探测、等待确认、提交或取消后等待旧 tab/probe 结束，用户又发起一次新增绑定
- **THEN** 系统拒绝第二次启动并保留当前流程，不得并发复用固定的 Probe 结果回调键

#### Scenario: Cancelled probe finishes late
- **WHEN** 用户取消绑定后旧 Probe 尚未完全结束
- **THEN** 系统在旧执行确认终止前不得启动下一次绑定，也不得用迟到结果创建确认弹窗或远端绑定

#### Scenario: Remote binding fails
- **WHEN** Cookie 导出或远端绑定调用失败
- **THEN** 系统可以保留本地探测结果，但远端列表仍保持未绑定状态并展示可理解的失败信息

### Requirement: Deferred re-login workflow
系统 SHALL 将失效 OTA account 的重新登录与凭证修复保留为独立后续流程，不得让本期新增绑定 intent 更新已有远端账号。

#### Scenario: Existing remote account needs re-login
- **WHEN** 用户操作一个登录失效或登录失败的既有 RMS OTA account
- **THEN** 系统不得将其转入新增绑定流程，本期只提示该能力尚未实现
