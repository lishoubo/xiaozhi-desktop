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

#### Scenario: 保存已识别的抖音登录态

- **WHEN** 抖音当前登录页面同源接口返回有效登录用户身份并成功发现酒店
- **THEN** 系统保存或更新与该浏览器分区对应的 `OtaCredential`
- **AND** credential 的渠道账号 ID 等于抖音返回的 `user_id`
- **AND** credential 附加信息只包含白名单账号资料

#### Scenario: 渠道账号尚未识别

- **WHEN** 非美团、非抖音、非携程单酒店的现有流程创建 credential，或旧 credential 尚未完成渠道账号识别
- **THEN** credential 的渠道账号 ID 可以为空
- **AND** 现有渠道的账号发现行为保持不变

#### Scenario: 同一登录态关联多个酒店

- **WHEN** 同一浏览器分区发现多个 OTA 酒店
- **THEN** 系统不得选择其中任意一家酒店 ID 作为 credential 的渠道账号 ID
- **AND** 每个已确认保存的酒店分别由 `OtaAccount` 表示并指向同一个 `credentialId`

## ADDED Requirements

### Requirement: 抖音账号身份与酒店事实分别持久化

系统 MUST 从当前抖音登录页面同源接口读取登录用户身份，并继续从抖音门店页面响应读取可操作酒店。
登录用户 ID 和白名单资料 MUST 保存到 `OtaCredential`；酒店 ID、名称和商户组上下文 MUST
保存到 `OtaAccount`。系统不得使用商户组 ID 或酒店 ID 代替抖音登录用户 ID。

#### Scenario: 抖音账号与酒店发现成功

- **WHEN** 当前页面同源接口返回有效 `user_id` 且酒店发现返回有效酒店
- **THEN** 系统保存或刷新 credential 的渠道账号 ID、附加账号资料和刷新时间
- **AND** 系统创建或更新对应的本地 OTA account
- **AND** account 保存抖音酒店 ID、名称和商户组上下文

#### Scenario: 抖音账号身份缺失

- **WHEN** 当前页面同源接口失败、格式无效或没有完整身份字段
- **THEN** 本次发现明确失败
- **AND** 系统不创建或更新 credential 与 account

#### Scenario: 抖音账号数据白名单

- **WHEN** 系统处理抖音登录信息接口中的账号资料
- **THEN** 系统只保存用户 ID、登录 ID、名称、角色名称和角色类型
- **AND** 系统不保存原始缓存、cookie、token 或其他未选定字段
