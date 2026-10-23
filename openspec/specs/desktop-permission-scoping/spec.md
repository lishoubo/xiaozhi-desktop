# desktop-permission-scoping Specification

## Purpose

酒店管理写操作由 RMS 服务端接口判断权限。桌面端不按 `hotel:manage` 隐藏操作入口，
避免在 App 中重复维护服务端权限规则。模块可见性仍遵循既有用户类型规则。

## Requirements

### Requirement: Hotel management write authorization belongs to the server

桌面端 SHALL NOT 根据登录身份中的 `hotel:manage` 权限码隐藏新增绑定账号、解绑账号、
重新认证账号或补选门店入口。实际操作 SHALL 通过既有接口提交，由服务端决定是否允许；
服务端拒绝时，桌面端 SHALL 沿用既有错误反馈。

本要求 SHALL NOT 恢复因服务端未开放而下线的新增酒店、删除酒店入口。

#### Scenario: User opens hotel management without a management permission code

- **WHEN** 可访问酒店管理页的用户不持有 `hotel:manage`，或权限码集合为空
- **THEN** 每家酒店显示新增绑定账号入口，账号详情显示解绑入口
- **AND** 重新登录和补选门店入口按账号状态展示，不再受权限码限制

#### Scenario: Server refuses a write operation

- **WHEN** 用户提交酒店管理写操作且服务端拒绝
- **THEN** 桌面端沿用既有错误反馈，不将该操作视为成功

### Requirement: Login and session restore use the same entry visibility

桌面端 SHALL 在完成登录和恢复既有会话后使用相同的酒店管理操作入口展示规则，
两条路径均 SHALL NOT 按 `hotel:manage` 隐藏入口。

#### Scenario: User restores a session without a management permission code

- **WHEN** 可访问酒店管理页的用户恢复了不含 `hotel:manage` 的既有会话
- **THEN** 酒店管理操作入口与新登录时相同

### Requirement: Account status continues to determine recovery actions

桌面端 SHALL 保留既有账号状态展示：绑定缺少门店时提供补选门店入口；门店完整且状态为
`LOGIN_FAILED`、`LOGIN_EXPIRED` 或 `UNBOUND` 时提供重新登录入口。
正常绑定、流程处理中及需管理员处理的状态 SHALL NOT 因移除权限判断而新增重新登录入口。

#### Scenario: Account has an expired login and a bound hotel

- **WHEN** 账号关联了 OTA 门店且状态为 `LOGIN_EXPIRED`
- **THEN** 账号详情显示重新登录入口，无需 `hotel:manage`

### Requirement: Empty hotel list renders without remediation guidance

当用户可见的酒店列表为空时，界面 SHALL 展示朴素空态，SHALL NOT 展示引导用户联系管理员
开通权限一类的文案，也 SHALL NOT 借空态暴露写操作入口。

#### Scenario: User has no accessible hotels

- **WHEN** 用户可见的酒店列表为空
- **THEN** 界面展示朴素空态，不含开通或联系管理员一类引导文案
- **AND** 不出现酒店行或账号的写操作入口
