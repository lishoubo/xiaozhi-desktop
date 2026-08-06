## MODIFIED Requirements

### Requirement: 本地 OTA 凭证独立持有浏览器分区

系统 MUST 以 `OtaCredential` 表示一次可复用的本地 OTA 登录态，并由该模型独立持有
`partitionName`、渠道信息、可空的渠道账号 ID 和可选的渠道 credential 附加信息。
`OtaAccount` MUST 通过 `credentialId` 关联凭证，不得重复存储 `partitionName` 或将 OTA
酒店信息保存为 credential 的组成部分。

#### Scenario: 保存已识别的美团登录态

- **WHEN** 美团登录或 cookie 导入流程成功识别渠道账号并发现 OTA 酒店
- **THEN** 系统保存或更新一条与该浏览器分区对应的 `OtaCredential`
- **AND** credential 的渠道账号 ID 等于美团返回的 `bizAcctId`
- **AND** credential 附加信息仅包含经过白名单筛选的美团账号资料

#### Scenario: 渠道账号尚未识别

- **WHEN** 非美团现有流程创建 credential，或旧 credential 尚未完成渠道账号识别
- **THEN** credential 的渠道账号 ID 可以为空
- **AND** 现有渠道的账号发现行为保持不变

#### Scenario: 同一登录态关联多个酒店

- **WHEN** 同一浏览器分区发现多个 OTA 酒店
- **THEN** 系统只创建或复用一个 `OtaCredential`
- **AND** 每个酒店分别创建或更新 `OtaAccount` 并指向同一个 `credentialId`

## ADDED Requirements

### Requirement: 美团账号身份与酒店事实分别持久化

系统 MUST 从美团账号详情读取登录账号身份，并从美团酒店列表读取可操作酒店；账号身份
MUST 保存到 `OtaCredential`，酒店 ID、名称和合作方上下文 MUST 保存到 `OtaAccount`。
系统不得使用酒店 ID 代替美团登录账号 ID。

#### Scenario: 美团账号与单酒店发现成功

- **WHEN** 美团账号详情和酒店列表均返回有效结果
- **THEN** 系统保存或刷新 credential 的渠道账号 ID、附加账号资料和刷新时间
- **AND** 系统创建或更新对应的本地 OTA account
- **AND** account 保存美团酒店 ID、名称和合作方上下文

#### Scenario: 美团账号可访问多个酒店

- **WHEN** 美团酒店列表返回多个有效酒店
- **THEN** 系统为每个酒店创建或更新本地 OTA account
- **AND** 所有 account 引用本次识别出的同一 credential

#### Scenario: 美团身份读取失败

- **WHEN** 无法取得或校验美团渠道账号 ID
- **THEN** 本次发现明确失败
- **AND** 系统不使用酒店 ID 猜测账号身份
- **AND** 系统保留已有 credential 和 account 数据

### Requirement: 美团渠道数据不得泄露敏感信息

系统 MUST 只持久化美团账号详情中业务需要的白名单字段，并 MUST NOT 将原始接口响应、
cookie、完整手机号或其他未选定字段写入普通日志或本地 credential 数据。

#### Scenario: 处理美团账号详情

- **WHEN** 美团账号详情接口返回账号资料
- **THEN** 系统只保存渠道账号 ID、合作方 ID、登录名、账号类型、账号状态和脱敏手机号
- **AND** 普通日志只记录结果类型、数量或不含敏感值的诊断信息
