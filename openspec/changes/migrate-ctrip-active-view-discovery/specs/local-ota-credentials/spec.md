## MODIFIED Requirements

### Requirement: 本地 OTA 凭证独立持有浏览器分区

系统 MUST 以 `OtaCredential` 表示一次可复用的本地 OTA 登录态，并由该模型独立持有
`partitionName`、渠道信息、可空的渠道账号 ID 和可选的渠道 credential 附加信息。
`OtaAccount` MUST 通过 `credentialId` 关联凭证，不得重复存储 `partitionName`。除携程真实
账号身份尚未接通期间的单酒店临时映射外，系统不得将 OTA 酒店信息保存为 credential 的
组成部分；该临时映射 MUST 明确记录身份来源，且不得被解释为携程真实登录账号身份。

#### Scenario: 保存已识别的美团登录态

- **WHEN** 美团登录或 cookie 导入流程成功识别渠道账号并发现 OTA 酒店
- **THEN** 系统保存或更新一条与该浏览器分区对应的 `OtaCredential`
- **AND** credential 的渠道账号 ID 等于美团返回的 `bizAcctId`
- **AND** credential 附加信息仅包含经过白名单筛选的美团账号资料

#### Scenario: 携程单酒店使用临时身份

- **WHEN** 携程当前登录页面只发现一家有效酒店
- **THEN** 系统保存或更新与该浏览器分区对应的 `OtaCredential`
- **AND** credential 的渠道账号 ID 暂时等于该酒店 ID
- **AND** credential 附加信息包含酒店 ID、酒店名称和 `hotel-dom` 身份来源

#### Scenario: 渠道账号尚未识别

- **WHEN** 非美团、非携程单酒店的现有流程创建 credential，或旧 credential 尚未完成渠道账号识别
- **THEN** credential 的渠道账号 ID 可以为空
- **AND** 现有渠道的账号发现行为保持不变

#### Scenario: 同一登录态关联多个酒店

- **WHEN** 同一浏览器分区发现多个 OTA 酒店
- **THEN** 系统不得选择其中任意一家酒店 ID 作为 credential 的渠道账号 ID
- **AND** 每个已确认保存的酒店分别由 `OtaAccount` 表示并指向同一个 `credentialId`

## ADDED Requirements

### Requirement: 携程从当前登录页面发现酒店

系统 MUST 在触发登录成功的当前携程页面中读取酒店信息，不得为了携程酒店发现创建隐藏
浏览器 View 或重新加载固定管理页。系统 MUST 在读取页面前校验当前页面属于受信任的携程
商家后台 HTTPS 域名。

#### Scenario: 当前页面发现一家酒店

- **WHEN** 当前受信任携程页面包含一家有效酒店的标题链接
- **THEN** 系统从当前页面读取酒店 ID 和名称
- **AND** 系统保存该酒店及其临时 credential 身份

#### Scenario: 当前页面不受信任

- **WHEN** 当前页面不是受信任的携程商家后台 HTTPS 页面
- **THEN** 系统拒绝执行酒店发现脚本
- **AND** 系统不创建或更新 credential 与 account

#### Scenario: 当前页面发现多家酒店

- **WHEN** 当前受信任携程页面包含多家有效酒店
- **THEN** 系统返回多酒店发现结果
- **AND** 系统暂不保存 credential 或 account
