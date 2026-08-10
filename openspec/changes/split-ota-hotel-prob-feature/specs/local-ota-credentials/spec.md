## MODIFIED Requirements

### Requirement: 美团账号身份与酒店事实分别持久化

系统 MUST 从美团账号详情读取登录账号身份并保存到 `OtaCredential`。酒店 ID、名称
和合作方上下文的持久化不再是本 Requirement 的职责，由 `ota-hotel-discovery`
capability 独立触发和保存（见该 capability 的 Requirement）。系统不得使用酒店
ID 代替美团登录账号 ID。

#### Scenario: 美团身份读取成功

- **WHEN** 美团账号详情返回有效结果
- **THEN** 系统保存或刷新 credential 的渠道账号 ID、附加账号资料和刷新时间

#### Scenario: 美团身份读取失败

- **WHEN** 无法取得或校验美团渠道账号 ID
- **THEN** 本次身份识别明确失败
- **AND** 系统不使用酒店 ID 猜测账号身份
- **AND** 系统保留已有 credential 数据

### Requirement: 抖音账号身份与酒店事实分别持久化

系统 MUST 从当前抖音登录页面同源接口读取登录用户身份并保存到 `OtaCredential`。
酒店 ID、名称和商户组上下文的持久化不再是本 Requirement 的职责，由
`ota-hotel-discovery` capability 独立触发和保存。系统不得使用商户组 ID 或酒店
ID 代替抖音登录用户 ID。

#### Scenario: 抖音身份识别成功

- **WHEN** 当前页面同源接口返回有效 `user_id`
- **THEN** 系统保存或刷新 credential 的渠道账号 ID、附加账号资料和刷新时间

#### Scenario: 抖音账号身份缺失

- **WHEN** 当前页面同源接口失败、格式无效或没有完整身份字段
- **THEN** 本次身份识别明确失败
- **AND** 系统不创建或更新 credential

### Requirement: 携程从当前登录页面发现酒店

系统 MUST 在触发登录成功的当前携程页面中读取酒店信息，不得为了携程酒店发现创建
隐藏浏览器 View 或重新加载固定管理页。系统 MUST 在读取页面前校验当前页面属于受
信任的携程商家后台 HTTPS 域名。携程酒店信息与临时 credential 身份仍由同一次页面
读取动作产出：credential 身份部分保存到 `OtaCredential`（沿用现有临时身份策略），
酒店信息部分交由 `ota-hotel-discovery` capability 消费同一次读取结果并保存，不
重复读取页面。

#### Scenario: 当前页面发现一家酒店

- **WHEN** 当前受信任携程页面包含一家有效酒店的标题链接
- **THEN** 系统从当前页面读取酒店 ID 和名称
- **AND** 系统保存该酒店的临时 credential 身份

#### Scenario: 当前页面不受信任

- **WHEN** 当前页面不是受信任的携程商家后台 HTTPS 页面
- **THEN** 系统拒绝执行酒店发现脚本
- **AND** 系统不创建或更新 credential

#### Scenario: 当前页面发现多家酒店

- **WHEN** 当前受信任携程页面包含多家有效酒店
- **THEN** 系统返回多酒店发现结果
- **AND** 系统暂不保存 credential

## REMOVED Requirements

### Requirement: OTA 账号保存渠道化绑定上下文

**Reason**：`bindExtra` 的持久化职责随酒店信息一起迁移到 `ota-hotel-discovery`
capability 的新表，不再属于 `local-ota-credentials` 的范围。
**Migration**：`ota-hotel-discovery` capability 声明等价的 Requirement，字段
含义和保存规则不变，只是宿主表从 `OtaAccount` 换成新表。

### Requirement: 现有账号使用效果保持一致

**Reason**：renderer 已不再展示或查询 `OtaAccount`（上一次 IPC 收敛改动已确认无
任何界面消费该数据），这条面向"账号列表/导航"用户效果的 Requirement 失去测试
对象，予以移除。
**Migration**：无需迁移，行为本身已不存在。

### Requirement: 打开 OTA 账号通过凭证解析浏览器分区

**Reason**：`OtaAccount` 不再是被打开/复用的对象（renderer 侧打开浏览器分区已
改为直接通过 `OtaCredential`），该 Requirement 描述的路径不再存在。
**Migration**：打开浏览器分区统一走 `OtaCredential`，规则见
`local-ota-credentials` 现有的 credential/partition 相关 Requirement，不受本
次改动影响。
