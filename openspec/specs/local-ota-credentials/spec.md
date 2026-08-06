# local-ota-credentials Specification

## Purpose

定义桌面端本地 OTA 登录凭证与酒店账号的持久化边界：浏览器分区由凭证持有，酒店账号通过凭证关联登录态，并保留各渠道发现出的绑定上下文。

## Requirements

### Requirement: 本地 OTA 凭证独立持有浏览器分区

系统 MUST 以 `OtaCredential` 表示一次可复用的本地 OTA 登录态，并由该模型独立持有 `partitionName`、渠道信息和可选的渠道 credential 附加信息。`OtaAccount` MUST 通过 `credentialId` 关联凭证，不得重复存储 `partitionName` 或将 OTA 酒店信息保存为 credential 的组成部分。

#### Scenario: 保存当前登录态

- **WHEN** 现有登录或 cookie 导入流程成功探测到 OTA 酒店
- **THEN** 系统保存一条与该浏览器分区对应的 `OtaCredential`
- **AND** credential 的渠道与本次登录渠道一致
- **AND** credential 附加信息在尚无 credential probe 时为空

#### Scenario: 同一登录态关联多个酒店

- **WHEN** 同一浏览器分区发现多个 OTA 酒店
- **THEN** 系统只创建或复用一个 `OtaCredential`
- **AND** 每个酒店分别创建 `OtaAccount` 并指向同一个 `credentialId`

### Requirement: OTA 账号保存渠道化绑定上下文

系统 MUST 在 `OtaAccount.bindExtra` 中保存酒店发现阶段获得的渠道原始绑定信息。`bindExtra` MUST 是可空 JSON，并在读写时按渠道校验；系统不得为当前未确认的字段制造占位值。

#### Scenario: 抖音酒店保存商户组

- **WHEN** 抖音发现结果包含 `groupId`
- **THEN** 系统将其保存为 `bindExtra.merchantGroupId`

#### Scenario: 美团酒店保存合作方信息

- **WHEN** 美团发现结果包含合作方 ID 与名称
- **THEN** 系统将其保存为 `bindExtra.otaPartnerId` 与 `bindExtra.otaPartnerName`

#### Scenario: 携程当前没有额外绑定信息

- **WHEN** 携程发现结果没有已确认的渠道原始字段
- **THEN** 系统将 `bindExtra` 保存为 `null`

### Requirement: 账号发现按浏览器分区复用凭证

系统 MUST 在酒店发现写入时按 `partitionName` 查找现有凭证；存在时复用，不存在时创建。酒店账号的唯一性 MUST 继续由 OTA 渠道与酒店 ID 决定。

#### Scenario: 已有分区再次发现酒店

- **WHEN** 某浏览器分区已经对应一个 `OtaCredential`
- **AND** 该分区再次发现酒店
- **THEN** 系统复用原凭证
- **AND** 新建或更新酒店账号与该凭证的关联及发现信息

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

### Requirement: 打开 OTA 账号通过凭证解析浏览器分区

系统 MUST 在打开或复用 OTA 酒店账号时，通过账号的 `credentialId` 读取 `OtaCredential.partitionName`。凭证不存在或凭证渠道与账号渠道不一致时，操作 MUST 明确失败，不得隐式回退到账号上的旧字段。

#### Scenario: 凭证缺失

- **WHEN** 用户打开的 OTA 账号引用了不存在的凭证
- **THEN** 系统返回明确错误
- **AND** 不创建或打开浏览器分区

### Requirement: 升级时清理旧账号数据

系统 MUST 在升级到 credential-account 结构时删除旧结构的 OTA account 数据，并 MUST NOT 创建或保留 legacy 账号表。系统 MUST 通过重新登录或 cookie 导入生成新 credential 与 account。

#### Scenario: 旧数据库升级

- **WHEN** 数据库包含旧版 OTA 账号表
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
