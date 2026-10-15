## Purpose

定义桌面应用内嵌网页向第三方站点呈现的浏览器 User-Agent，以及导入 Cookie 后如何保留所选浏览器的标识、在账号会话重开时恢复并安全回退。

## ADDED Requirements

### Requirement: 内嵌网页具有统一默认浏览器标识

系统 MUST 为所有内嵌网页会话提供统一的 Chrome 风格默认 User-Agent，且默认值 MUST 不包含 Electron 或应用产品标识。该默认值 MUST 在网页首次请求前生效，不改变 Cookie、权限、沙箱或代理策略。

#### Scenario: 新建空白登录会话

- **WHEN** 用户新建 OTA 登录标签而未导入 Cookie
- **THEN** 该标签首次请求使用统一默认 User-Agent

#### Scenario: 非 OTA 内嵌页面

- **WHEN** 应用打开自己的内嵌网页
- **THEN** 未指定更具体 User-Agent 的请求使用同一默认值

### Requirement: Cookie 导入记录可用的来源浏览器标识

系统 MUST 在导入 Cookie 时尝试从所选浏览器的本机安装或 Profile 版本信息推导 User-Agent，并将成功推导的值与导入结果按渠道共同保存。系统 MUST NOT 假定 Cookie 数据本身包含 User-Agent，MUST NOT 把无法验证的来源版本编造成已采集值。

#### Scenario: 可识别的 Chromium 浏览器来源

- **WHEN** 用户从受支持的 Chrome 或 Edge Profile 导入 Cookie，且可读取有效浏览器版本
- **THEN** 每个被导入渠道的记录保存该来源对应的 User-Agent
- **AND** 后续从该导入记录打开账号时，首次请求使用保存值

#### Scenario: 不能识别来源版本

- **WHEN** 所选浏览器缺少可用版本信息或没有可靠的 User-Agent 模板
- **THEN** Cookie 导入仍可成功
- **AND** 导入记录不保存推断的 User-Agent，后续打开使用统一默认值

### Requirement: 账号浏览器标识随会话持久化

系统 MUST 将从导入记录使用的 User-Agent 与新建账号浏览器分区关联；重启后再次打开同一分区，以及将该登录态复制到新的绑定分区时，MUST 继续使用关联值。旧导入记录与旧分区没有该值时 MUST 使用统一默认值。

#### Scenario: 重启后打开已导入账号

- **WHEN** 用户重启应用并打开先前通过导入 Cookie 建立的账号
- **THEN** 首次请求使用该分区保存的来源 User-Agent

#### Scenario: 为账号创建新的绑定分区

- **WHEN** 用户从已有账号发起新分区绑定流程
- **THEN** 新分区继承原分区保存的 User-Agent

#### Scenario: 旧数据兼容

- **WHEN** 已有导入记录或账号分区没有 User-Agent 元数据
- **THEN** 系统仍能读取并打开该账号，使用统一默认值
