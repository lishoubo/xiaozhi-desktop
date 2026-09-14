## ADDED Requirements

### Requirement: partition 会话可导出为渠道 HTTP 请求的凭证

除了「在该 partition 的页面里操作」之外，系统 SHALL 允许主进程按 partition 指针读取该会话的 cookie，用于直接向渠道发起 HTTP 读取请求。该读取 SHALL NOT 依赖该 partition 当前是否有打开的标签页。

该读取 SHALL 满足：

| 约束 | 要求 |
|---|---|
| 唯一入口 | 读取 SHALL 只由持有 partition 会话访问权的那一个模块提供，其他层通过注入的窄回调获得 |
| 最小形状 | 注入给其他层的窄回调 SHALL 只暴露拼装请求头所需的字段，SHALL NOT 透出会话注入专用字段 |
| 只读 | 读取 SHALL NOT 修改会话，也 SHALL NOT 把 cookie 复制进凭证记录或其他持久化存储 |
| 请求头归一 | 用于请求头时 SHALL 归一为请求头格式的字符串，SHALL NOT 直接投放结构化存储形态 |
| 脱敏 | 读取到的内容 SHALL NOT 进入日志、错误信息或上报数据 |

#### Scenario: 主进程需要以某账号身份读取渠道数据

- **WHEN** 主进程模块需要以某条凭证的身份向渠道发起 HTTP 读取
- **THEN** 它通过注入的窄回调按该凭证的 partition 指针取得 cookie
- **AND** 以请求头格式装配后发起请求
- **AND** 不复制 cookie 到任何持久化位置

#### Scenario: 导出内容出现在日志路径上

- **WHEN** 任何日志、错误信息或上报数据的构造过程中出现导出的 cookie
- **THEN** 该内容 SHALL 被脱敏或剔除

#### Scenario: partition 当前没有打开的标签页

- **WHEN** 某凭证的 partition 当前没有任何打开的标签页
- **THEN** cookie 导出仍 SHALL 可用，不依赖标签页存在
