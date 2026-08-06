## Purpose

将本机 OTA 登录态与可操作酒店分开保存，使一份登录态能够关联多个 OTA 酒店，同时兼容现有账号发现、列表展示和打开流程。

## ADDED Requirements

### Requirement: 本地 credential 独立保存登录态

系统 SHALL 使用独立的本地 OTA credential 保存渠道、partition 指针和可选的渠道 credential 附加信息，不 SHALL 将 OTA 酒店信息保存为 credential 的组成部分。

#### Scenario: 保存当前登录态

- **WHEN** 现有登录或 cookie 导入流程成功探测到 OTA 酒店
- **THEN** 系统保存一条与该 partition 对应的本地 credential
- **AND** credential 的渠道与本次登录渠道一致
- **AND** credential 附加信息在尚无 credential probe 时为空

#### Scenario: 同一 partition 重复参与探测

- **WHEN** 系统再次处理一个已经存在 credential 的 partition
- **THEN** 系统复用原 credential
- **AND** 不为同一 partition 创建重复 credential

### Requirement: 本地账号引用 credential

系统 SHALL 让每条本地 OTA account 通过 `credentialId` 引用登录态，并 SHALL 将 OTA 酒店信息与进入该酒店所需的 `bindExtra` 保存在 account 上。

#### Scenario: 创建探测到的账号

- **WHEN** hotel probe 返回一条当前不存在的 OTA 酒店
- **THEN** 系统创建引用当前 credential 的本地 OTA account
- **AND** account 保存渠道、OTA 酒店标识、酒店名称和 `bindExtra`
- **AND** account 本身不保存 partition 指针

#### Scenario: 一份 credential 关联多个账号

- **WHEN** 两条本地 OTA account 引用相同 `credentialId`
- **THEN** 系统允许两条记录分别保存自己的 OTA 酒店信息和 `bindExtra`

#### Scenario: 同一酒店被新登录态再次发现

- **WHEN** 现有探测流程使用新的 credential 再次发现同一渠道、同一 OTA 酒店
- **THEN** 系统保持当前单账号展示效果
- **AND** 将该账号改为引用新的 credential
- **AND** 不自动删除旧 credential 或其 partition

### Requirement: 现有账号使用效果保持一致

系统 SHALL 在拆分 credential 后保持现有账号列表、账号导航和打开账号的用户效果。

#### Scenario: 列出渠道账号

- **WHEN** renderer 查询某渠道的本地 OTA account
- **THEN** 系统返回已按新模型发现并保存的账号集合和排序
- **AND** 每条结果包含关联 credential 的标识

#### Scenario: 打开已有账号

- **WHEN** 用户打开一条已有本地 OTA account
- **THEN** main 通过该 account 的 `credentialId` 解析 credential
- **AND** 使用 credential 的 partition 打开原渠道酒店入口

#### Scenario: credential 缺失

- **WHEN** 用户打开的 account 引用了不存在的 credential
- **THEN** 系统拒绝打开并返回可诊断错误
- **AND** 不创建临时或共享 partition 作为静默回退

### Requirement: 升级时清理旧账号数据

系统 MUST 在升级到 credential-account 结构时删除旧结构的 OTA account 数据，并 MUST NOT 创建或保留 legacy 账号表。系统 MUST 通过重新登录或 cookie 导入生成新 credential 与 account。

#### Scenario: 旧数据库升级

- **WHEN** 数据库升级前存在旧结构的 OTA account
- **THEN** 迁移删除旧账号表及数据
- **AND** 创建空的 `ota_credential` 与新版 `ota_account`
- **AND** 数据库中不存在 `ota_account_legacy_v5`

#### Scenario: 升级后重新发现账号

- **WHEN** 用户在升级后重新登录或导入 cookie 并成功发现酒店
- **THEN** 系统按新模型创建 credential 与 account

### Requirement: partition 保持单一权威

系统 SHALL 仅以本地 credential 保存的 partition 指针定位 OTA 登录态，不 SHALL 复制 cookie 到 account 数据或通过 account 标识重新推导 partition 名称。

#### Scenario: 复用登录态

- **WHEN** 任意现有流程需要使用一条本地 OTA account 的登录态
- **THEN** 系统先解析该 account 引用的 credential
- **AND** 使用 credential 中原样保存的 partition 指针
