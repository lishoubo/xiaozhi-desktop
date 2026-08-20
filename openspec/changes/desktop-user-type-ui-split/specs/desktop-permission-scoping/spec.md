## ADDED Requirements

### Requirement: Desktop scopes module visibility by user type

桌面端 SHALL 依据登录身份的用户类型（`STAFF` 服务商员工 / `HOTEL` 酒店用户）判定各功能模块是否对该用户开放，并以此收敛导航入口与路由可达性。

该判据 SHALL 独立于权限码判据：用户类型决定「模块是否对该类用户开放」，权限码决定「模块内部能否执行写操作」。两者 SHALL NOT 互相替代。

模块可见性 SHALL NOT 依据角色码判定——同一角色码在两类用户上都可能出现，据其判定会把两类用户混为一谈。

身份未携带用户类型时，SHALL 按服务商员工处置（保持既有可见范围，不因字段缺失而收窄）。

#### Scenario: Hotel user signs in

- **WHEN** 登录身份的用户类型为 `HOTEL`
- **THEN** 酒店管理模块判定为「不开放」

#### Scenario: Staff user signs in

- **WHEN** 登录身份的用户类型为 `STAFF`
- **THEN** 酒店管理模块判定为「开放」，无论其角色码与权限码为何

#### Scenario: Identity carries no user type

- **WHEN** 登录身份未携带用户类型字段
- **THEN** 酒店管理模块判定为「开放」

### Requirement: Modules closed to the user type are unreachable

对当前用户类型不开放的模块，桌面端 SHALL 不在导航中呈现其入口；用户经由既有跳转、历史地址或直接输入到达该模块地址时，SHALL 将其送回工作区首页。

此项为界面收口，SHALL NOT 被当作访问控制——服务端只读接口对酒店用户仍是放行的，收口的目的是不把不属于该用户的功能摆在他面前。

#### Scenario: Hotel user views the navigation

- **WHEN** 用户类型为 `HOTEL` 的用户查看侧边导航
- **THEN** 酒店管理入口不出现
- **AND** 浏览器工作区等其余入口照常出现

#### Scenario: Hotel user reaches the hotel management address

- **WHEN** 用户类型为 `HOTEL` 的用户到达酒店管理页地址
- **THEN** 界面重定向回工作区首页
- **AND** 不呈现酒店管理页内容

#### Scenario: Staff user reaches the hotel management address

- **WHEN** 用户类型为 `STAFF` 的用户到达酒店管理页地址
- **THEN** 酒店管理页照常呈现

## MODIFIED Requirements

### Requirement: Hotel management write entries are hidden without the management capability

不具备酒店管理写能力时，酒店管理界面 SHALL 隐藏全部写操作入口——新增绑定账号、解绑账号、重新认证账号。这些入口 SHALL 被隐藏而非以禁用态展示。

酒店列表、已绑定账号及其状态等只读信息 SHALL 照常展示。

新增酒店与删除酒店 SHALL NOT 在界面上提供入口——服务端对应能力仅在测试环境开放，生产环境调用返回「资源不存在」。该约束与用户类型、权限码均无关，对所有用户一致。

#### Scenario: Read-only user opens hotel management

- **WHEN** 不具备酒店管理写能力的用户打开酒店管理页
- **THEN** 上述三个写操作入口均不出现
- **AND** 酒店与已绑定账号的只读信息照常展示

#### Scenario: User with the management capability opens hotel management

- **WHEN** 具备酒店管理写能力的用户打开酒店管理页
- **THEN** 三个写操作入口均照常出现
- **AND** 新增酒店与删除酒店入口不出现

### Requirement: Empty hotel list renders without remediation guidance

当用户可见的酒店列表为空时，界面 SHALL 展示朴素空态，SHALL NOT 展示引导用户联系管理员开通权限一类的文案，也 SHALL NOT 借空态暴露写操作入口。

#### Scenario: Read-only user has no accessible hotels

- **WHEN** 不具备酒店管理写能力的用户可见酒店列表为空
- **THEN** 界面展示朴素空态，不含开通/联系管理员一类引导文案
- **AND** 不出现任何写操作入口

#### Scenario: Staff user with no accessible hotels

- **WHEN** 用户类型为 `STAFF` 且可见酒店列表为空
- **THEN** 界面展示朴素空态
- **AND** 不出现新增酒店入口
