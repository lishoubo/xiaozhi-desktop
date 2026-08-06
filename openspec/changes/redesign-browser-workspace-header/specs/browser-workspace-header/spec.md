## Purpose

定义 OTA 浏览器工作区中渠道、登录 credential 与页面标签的层级和交互，使用户能明确区分切换平台、切换登录态与新建页面。

## ADDED Requirements

### Requirement: 工作区分层展示渠道、credential 与页面

系统 SHALL 使用渠道行和页面工作栏展示 OTA 工作区。渠道行 MUST 只负责切换渠道；页面工作栏 MUST 同时保留浏览器控制、当前 credential 的页面标签和当前登录账号区域。

#### Scenario: 当前渠道没有活动 credential

- **WHEN** 当前渠道没有活动标签，或活动标签的 partition 未匹配到 credential
- **THEN** 当前登录账号区域展示当前渠道名称
- **AND** 标签区新建按钮保持禁用

### Requirement: 两个加号具有独立登录态语义

标签区加号 MUST 使用当前活动 credential 的已有 partition 新建标签，并 MUST 保留已有标签。账号区加号 MUST 先打开当前渠道的 credential 列表，不得立即创建 partition；只有列表内“登录新渠道账号”操作可以开始创建新登录 partition。

#### Scenario: 当前 credential 新建页面

- **WHEN** 用户点击标签区加号且当前标签匹配到 credential
- **THEN** 系统使用该 credential 的已有 partition 打开渠道默认页面
- **AND** 系统不关闭已有标签、不创建 credential、不创建 partition

#### Scenario: 打开账号列表后取消

- **WHEN** 用户打开账号区列表后未选择 credential 并关闭列表
- **THEN** 系统恢复打开列表前的活动标签

### Requirement: Cookie 导入入口采用各自的完成流程

系统 MUST 复用同一套浏览器 Cookie 导入能力。初始化导入成功后 MUST 保留设置页复核流程；账号列表内导入成功后 MUST 直接使用当前渠道创建登录页面，不得导航到设置页或展示已导入 Cookie 列表。

#### Scenario: 从账号列表导入当前渠道 Cookie

- **WHEN** 用户在当前渠道账号列表内完成 Cookie 导入
- **THEN** 系统使用当前渠道的已导入 Cookie 创建新 partition 并打开页面
- **AND** 系统关闭账号列表并留在浏览器工作区

#### Scenario: 当前渠道没有已导入 Cookie

- **WHEN** Cookie 导入完成但当前渠道没有可用 Cookie
- **THEN** 系统保留原账号的全部标签
- **AND** 系统显示明确失败提示，不进入设置页

### Requirement: 切换 credential 保持单渠道单登录态

系统 MUST 先使用目标 credential 打开或激活页面；成功后 MUST 关闭当前渠道中其他 partition 的标签。目标页面打开或激活失败时 MUST 保留原标签，并允许账号列表关闭后恢复原活动页面。

#### Scenario: 成功切换 credential

- **WHEN** 用户选择当前渠道的另一条 credential 且目标页面成功打开
- **THEN** 系统激活目标页面
- **AND** 系统关闭当前渠道中使用旧 partition 的全部标签

#### Scenario: 目标 credential 打开失败

- **WHEN** 用户选择另一条 credential 但目标页面打开失败
- **THEN** 系统保留原 credential 的全部标签
- **AND** 用户关闭账号列表后恢复原活动标签

### Requirement: 账号列表合并重复渠道身份

系统 MUST 在账号选择列表中按渠道与非空 `channelAccountId` 合并重复 credential。默认 MUST 展示最近发现的 credential；当当前活动 partition 属于该身份时 MUST 优先展示当前 credential。没有稳定渠道账号标识的 credential MUST 按 partition 独立展示。

#### Scenario: 同一美团账号被重复导入

- **WHEN** 同一美团 `channelAccountId` 存在多个不同 partition 的 credential
- **THEN** 账号选择列表只展示一项
- **AND** 当前正在使用其中一个 partition 时，该项仍表示当前 credential

### Requirement: 重复渠道身份复用原 credential

系统 MUST 在新 partition 探测到已有的渠道与 `channelAccountId` 组合时保留原 credential ID，并将其权威 `partitionName`、身份字段和刷新时间更新为本次探测结果，不得新建同身份 credential。被替换的旧 partition MUST 在没有 BrowserTab 引用后清空 Session 存储；清理失败不得回滚已成功的身份绑定。

#### Scenario: Cookie 导入再次识别同一美团账号

- **WHEN** 新 partition 探测出的美团 `channelAccountId` 已存在
- **THEN** 系统更新已有 credential 指向新 partition
- **AND** 已有关联的 `OtaAccount` 继续引用同一 credential ID
- **AND** 旧 partition 在最后一个引用标签关闭后清空 Session 数据

### Requirement: 标签关闭保持可预测的活动页面

系统 MUST 在关闭活动标签后激活其相邻标签；关闭当前渠道最后一个标签后 MUST 清除该渠道活动标签，并进入显示渠道名称的空态。关闭非活动标签不得改变当前活动标签。

#### Scenario: 关闭存在相邻项的活动标签

- **WHEN** 用户关闭活动标签且同渠道仍有其他标签
- **THEN** 系统激活与关闭位置相邻的剩余标签

#### Scenario: 关闭最后一个标签

- **WHEN** 用户关闭当前渠道最后一个标签
- **THEN** 系统不再显示该标签
- **AND** 当前登录账号区域展示当前渠道名称
