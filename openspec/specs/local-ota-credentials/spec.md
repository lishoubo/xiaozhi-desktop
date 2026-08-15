# local-ota-credentials Specification

## Purpose

定义桌面端本地 OTA 登录凭证与酒店账号的持久化边界：浏览器分区由凭证持有，酒店账号通过凭证关联登录态，并保留各渠道发现出的绑定上下文。

## Requirements

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

> 本条约束的是 **account 改指新 credential** 的场景。**同一 credential 的 partition
> 指针被绑定流程替换**是另一回事，那时旧 partition 会退休并清空 —— 见
> `browser-partition-lifecycle` 的「绑定成功后账号登录态迁移到新 partition」。

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

该指针**可变**：绑定流程会把它改写到新建的 partition。指针的变更规则与旧 partition 的
归宿见 `browser-partition-lifecycle`。

#### Scenario: 复用登录态

- **WHEN** 任意现有流程需要使用一条本地 OTA account 的登录态
- **THEN** 系统先解析该 account 引用的 credential
- **AND** 使用 credential 中原样保存的 partition 指针
