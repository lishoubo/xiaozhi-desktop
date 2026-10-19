## MODIFIED Requirements

### Requirement: 小智平台仅对服务商员工开放
桌面端在所有构建环境中 SHALL 向已登录且用户类型明确为 `STAFF` 的服务商员工展示小智平台入口。对于用户类型明确为 `HOTEL` 的酒店用户，桌面端 SHALL 仅在 `/me.permissions` 包含 `xiaozhi:access` 且 `/me.accessibleHotelIds` 非空时展示入口。未登录、用户类型缺失或未知，以及不满足上述两个条件的酒店用户 SHALL 看不到入口，直接请求打开内部页面也 SHALL 被拒绝。

打开内部页面、复用旧页面和恢复已存在标签时 SHALL 使用同一判据；会话身份或授权变化后，不符合判据的内部页面 SHALL 被关闭或不再恢复。桌面端 SHALL 使用既有 `permissions` 与 `accessibleHotelIds`，不要求 `/me` 新增字段或第二份酒店列表。

#### Scenario: 服务商员工打开页面
- **WHEN** 已登录用户的类型为 `STAFF` 且点击小智平台入口
- **THEN** 桌面端展示并打开统一改价页

#### Scenario: 获授权且有酒店的酒店用户打开页面
- **WHEN** 已登录用户的类型为 `HOTEL`，权限集合包含 `xiaozhi:access`，且可访问酒店列表非空
- **THEN** 桌面端展示并允许打开统一改价页

#### Scenario: 酒店用户缺少任一条件
- **WHEN** 酒店用户没有 `xiaozhi:access`，或可访问酒店列表为空
- **THEN** 桌面端隐藏入口、拒绝打开内部页面，且不恢复旧标签

#### Scenario: 授权撤销或切换账号
- **WHEN** 桌面端重新取得的身份不再满足打开条件
- **THEN** 已打开的小智平台页面关闭，旧标签不再恢复

#### Scenario: 未知用户类型
- **WHEN** 登录身份的用户类型缺失或未知
- **THEN** 桌面端隐藏入口并拒绝打开内部页面
