# desktop-permission-scoping Specification

## Purpose

约束桌面端如何按 RMS 下发的权限码收敛界面上的写操作入口，使只读用户看不到自己无权
执行的动作。界面收口是可用性措施，服务端始终是权限的最终防线。

## Requirements

### Requirement: Desktop derives capabilities from RMS permission codes

桌面端 SHALL 把登录身份中的权限码集合收敛成具名能力判断，并以该判断作为界面渲染依据。
界面各处 SHALL NOT 各自比较权限码字符串。

未持有某项能力对应权限码的用户 SHALL 被视为不具备该能力；权限码集合为空时，所有写能力
SHALL 判定为否。

#### Scenario: Identity carries the management permission code

- **WHEN** 登录身份的权限码集合包含 `hotel:manage`
- **THEN** 酒店管理写能力判定为「具备」

#### Scenario: Identity carries only read permission codes

- **WHEN** 登录身份的权限码集合只含只读权限码（如 `hotel:view`）
- **THEN** 酒店管理写能力判定为「不具备」

#### Scenario: Identity carries no permission codes

- **WHEN** 登录身份的权限码集合为空
- **THEN** 酒店管理写能力判定为「不具备」

### Requirement: Capabilities are available on both login and session restore

桌面端 SHALL 在「用户完成登录」与「启动时恢复既有会话」两条路径上都取得相同的能力判断
结果。SHALL NOT 出现某条路径下能力判断缺失而被当作「具备」的情况。

#### Scenario: Capabilities after a fresh login

- **WHEN** 用户完成登录且身份权限码不含 `hotel:manage`
- **THEN** 酒店管理写操作入口不出现

#### Scenario: Capabilities after restoring a stored session

- **WHEN** 应用启动并恢复出一个权限码不含 `hotel:manage` 的既有会话
- **THEN** 酒店管理写操作入口同样不出现

### Requirement: Hotel management write entries are hidden without the management capability

不具备酒店管理写能力时，酒店管理界面 SHALL 隐藏全部写操作入口——新增酒店、删除酒店、
新增绑定账号、解绑账号、重新认证账号。这些入口 SHALL 被隐藏而非以禁用态展示。

酒店列表、已绑定账号及其状态等只读信息 SHALL 照常展示。

#### Scenario: Read-only user opens hotel management

- **WHEN** 不具备酒店管理写能力的用户打开酒店管理页
- **THEN** 上述五个写操作入口均不出现
- **AND** 酒店与已绑定账号的只读信息照常展示

#### Scenario: User with the management capability opens hotel management

- **WHEN** 具备酒店管理写能力的用户打开酒店管理页
- **THEN** 五个写操作入口均照常出现

### Requirement: Empty hotel list renders without remediation guidance

当用户可见的酒店列表为空时，界面 SHALL 展示朴素空态，SHALL NOT 展示引导用户联系管理员
开通权限一类的文案，也 SHALL NOT 借空态暴露写操作入口。

#### Scenario: Read-only user has no accessible hotels

- **WHEN** 不具备酒店管理写能力的用户可见酒店列表为空
- **THEN** 界面展示朴素空态，不含开通/联系管理员一类引导文案
- **AND** 不出现任何写操作入口
