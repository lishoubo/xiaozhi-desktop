## ADDED Requirements

### Requirement: 工作区按渠道读取本地 OTA 凭证

系统 MUST 支持按 OTA 渠道读取全部本地 `OtaCredential`，结果不得依赖 credential 是否已关联 `OtaAccount`。每项结果 MUST 包含 credential 标识、渠道、partition 指针和可用于展示的渠道身份字段。

#### Scenario: credential 尚未关联酒店账号

- **WHEN** 当前渠道存在一条没有关联 `OtaAccount` 的 credential
- **THEN** 工作区查询该渠道 credential 时仍返回该 credential

### Requirement: 工作区直接复用本地 OTA 凭证

系统 MUST 支持通过 credential 标识读取其原样保存的 partition，并使用该渠道默认入口打开浏览器页面。credential 不存在时操作 MUST 明确失败，不得创建临时 partition 或回退到 `OtaAccount`。

#### Scenario: 打开已有 credential

- **WHEN** 工作区请求打开一条存在的 credential
- **THEN** 系统使用该 credential 的 partition 和渠道默认入口创建页面标签
- **AND** 系统不要求该 credential 存在关联酒店账号

#### Scenario: credential 不存在

- **WHEN** 工作区请求打开不存在的 credential 标识
- **THEN** 系统返回明确错误
- **AND** 系统不创建浏览器页面或 partition
