## MODIFIED Requirements

### Requirement: partition 名称不可从账号反推

系统 MUST 以 `persist:xiaozhi:<environment>:<channel>:<shortId>` 命名 partition，其中
`shortId` MUST 由随机源生成，不得由账号 ID、酒店 ID 或任何业务标识派生。定位某个账号的
登录态 MUST 通过 `OtaCredential.partitionName` 字段查询，不得通过拼接规则推导。

`<environment>` MUST 取当前产物的构建期环境值（见 `desktop-build-environments`），
MUST NOT 由调用方各自传入字面量——此前该段虽贯穿契约但所有调用点写死同一个值，使其
无法反映真实环境。

#### Scenario: 定位账号的登录态

- **WHEN** 任意流程需要打开某个 OTA 账号的登录态
- **THEN** 系统读取该账号关联 credential 的 `partitionName`
- **AND** 不得按渠道与账号 ID 拼出 partition 名称

#### Scenario: partition 名称反映构建环境

- **WHEN** 在某套环境的产物中创建新 partition
- **THEN** 名称中的 `<environment>` 段等于该产物的构建期环境值
