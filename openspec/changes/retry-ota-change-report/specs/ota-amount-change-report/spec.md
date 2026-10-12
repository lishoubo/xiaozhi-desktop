## MODIFIED Requirements

### Requirement: 上报是单向通知

上报 SHALL 是单向通知：desktop 对下游的处理终态没有补救动作。下游返回的解析失败、门店反查失败、跳过等终态 SHALL 被视为正常响应，MUST NOT 触发重试或告警。

网络失败以及 HTTP 408、429、5xx SHALL 在首次失败后分别等待 1 秒和 3 秒，最多重试两次。其他 HTTP 4xx 与结构性业务拒绝 MUST NOT 重试。重试均 SHALL 使用同一个 `operationId`。最终失败 SHALL 记录告警并继续后续观测，MUST NOT 持久化待发队列。

#### Scenario: 下游反查不到门店

- **WHEN** 下游返回「门店未解析」一类终态
- **THEN** desktop 仅记录日志，不重试、不告警

#### Scenario: 上报遇到网络失败

- **WHEN** 上报请求因网络原因失败，且前两次尝试都失败
- **THEN** 系统分别等待 1 秒与 3 秒后重试，总共最多发送三次，且不因此中断后续观测

#### Scenario: RMS 暂时不可用

- **WHEN** 上报收到 HTTP 408、429 或 5xx
- **THEN** 系统按同一有限重试策略再次发送

#### Scenario: 请求被永久拒绝

- **WHEN** 上报收到 HTTP 400、401、403 等永久性错误
- **THEN** 上报层不重试，记录失败后继续后续观测
