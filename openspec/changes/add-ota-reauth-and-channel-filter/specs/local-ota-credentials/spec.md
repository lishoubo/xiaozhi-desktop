## MODIFIED Requirements

### Requirement: OTA 账号保存渠道化绑定上下文

系统 MUST 在 `OtaAccount.bindExtra` 中保存酒店发现阶段获得的渠道原始绑定信息。`bindExtra` MUST 是可空 JSON，并在读写时按渠道校验；系统不得为当前未确认的字段制造占位值。

用户确认绑定时，系统 MUST 额外把本次使用的**渠道账号标识**写入提交给远端的绑定上下文，使远端记录自带账号关联、无需回查本地数据即可认出是哪个账号建立的绑定。渠道账号标识为空时 MUST 省略该字段，不得写入空值占位。

#### Scenario: 抖音酒店保存商户组

- **WHEN** 抖音发现结果包含 `groupId`
- **THEN** 系统将其保存为 `bindExtra.merchantGroupId`

#### Scenario: 美团酒店保存合作方信息

- **WHEN** 美团发现结果包含合作方 ID 与名称
- **THEN** 系统将其保存为 `bindExtra.otaPartnerId` 与 `bindExtra.otaPartnerName`

#### Scenario: 携程当前没有额外绑定信息

- **WHEN** 携程发现结果没有已确认的渠道原始字段
- **THEN** 系统将 `bindExtra` 保存为 `null`

#### Scenario: 确认绑定时写入渠道账号标识

- **WHEN** 用户确认绑定某个候选门店
- **AND** 本次使用的凭证有非空的渠道账号标识
- **THEN** 提交给远端的绑定上下文包含该渠道账号标识
- **AND** 该字段与探测阶段获得的渠道原始字段并存

#### Scenario: 凭证没有渠道账号标识

- **WHEN** 用户确认绑定时所用凭证的渠道账号标识为空
- **THEN** 提交给远端的绑定上下文不包含渠道账号标识字段
- **AND** 系统不写入空字符串或其他占位值
