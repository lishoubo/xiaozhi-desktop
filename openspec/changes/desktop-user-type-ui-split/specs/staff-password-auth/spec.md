## ADDED Requirements

### Requirement: Staff identity carries a closed-set user type

登录身份契约 SHALL 携带用户类型字段，其值域 SHALL 是封闭枚举 `STAFF`（服务商员工）与 `HOTEL`（酒店用户）。桌面端 SHALL 以该字段作为两类用户的唯一判据。

服务端对该字段恒有取值——存量数据缺列时按 `STAFF` 归置。桌面端契约 SHALL 仍容忍字段缺失或取值不在枚举内，两种情况均按 `STAFF` 处置，SHALL NOT 因此使身份解析整体失败。

此项容错是必需的：身份契约为严格对象，任一字段解析失败都会使登录整体失败并清除凭证。用户类型的取值集合由服务端单方扩展，桌面端 SHALL NOT 因见到未知取值而把用户锁在门外。

身份契约 SHALL 同时携带手机号字段；服务商员工可能没有手机号，故该字段 SHALL 同时容许取值为空与键缺失。

用户类型 SHALL NOT 由角色码推导——角色码 `HOTEL_STAFF` 在服务商侧同样在用，据其推导会把两类用户混为一谈。

#### Scenario: Identity of a hotel user

- **WHEN** 酒店用户完成登录并取得身份
- **THEN** 身份的用户类型为 `HOTEL`

#### Scenario: Identity of a staff user

- **WHEN** 服务商员工完成登录并取得身份
- **THEN** 身份的用户类型为 `STAFF`

#### Scenario: Identity omits the user type

- **WHEN** 身份响应中不含用户类型字段
- **THEN** 身份解析成功
- **AND** 该身份按 `STAFF` 处置

#### Scenario: Identity carries an unknown user type

- **WHEN** 身份响应中的用户类型不属于封闭枚举
- **THEN** 身份解析成功，登录照常放行
- **AND** 该身份按 `STAFF` 处置
