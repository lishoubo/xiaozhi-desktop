## ADDED Requirements

### Requirement: 内部页面使用固定的长驻 partition

系统 MUST 让内部 web 页面（RMS 自有页面）使用一份按环境固定命名的 partition，MUST NOT
每次打开新建。

该 partition MUST NOT 登记进账本 —— 账本的状态机（`pending → claimed`）描述的是「等待
身份探测认领」这一 OTA 登录语义，内部页面没有可探测的渠道账号，登记进去的记录永远停在
`pending`。而 `pending` 记录刻意不设数量上限（异常堆积是认领链路故障的信号），把一批
永不认领的记录混进去会让该信号失去意义。

该 partition MUST 与 OTA 登录 partition 的命名布局不同，从而天然落在孤儿回收的候选范围
之外 —— 它与服务端会话、RMS API 会话同属基础设施 partition。

#### Scenario: 反复打开内部页面

- **WHEN** 用户多次打开内部页面
- **THEN** 系统始终使用同一份 partition
- **AND** 磁盘上不产生新的 partition 目录

#### Scenario: 内部页面 partition 不进账本

- **WHEN** 系统为内部页面创建或使用其 partition
- **THEN** 账本中不新增任何记录

#### Scenario: 内部页面 partition 不被孤儿回收

- **WHEN** 启动清理扫描 partition 目录
- **THEN** 系统不将内部页面的 partition 视为孤儿
- **AND** 不清空其存储

#### Scenario: 内部页面 partition 随环境隔离

- **WHEN** 同一台机器上安装了多套环境的产物
- **THEN** 各环境的内部页面使用各自独立的 partition
