# browser-partition-lifecycle Specification

## Purpose

定义浏览器 partition 从创建到销毁的完整生命周期：谁能创建、账本如何记录状态、绑定流程
如何把账号的登录态换到新 partition，以及旧 partition 在什么条件下被清空。

本能力回答的是 `local-ota-credentials` 不回答的问题：那份规范定义「credential 持有
partition 指针」这一**静态事实**，这里定义 partition 指针**如何随流程变化**、以及
被替换下来的 partition 的归宿。

## Requirements

### Requirement: partition 名称不可从账号反推

系统 MUST 以 `persist:xiaozhi:<environment>:<channel>:<shortId>` 命名 partition，其中
`shortId` MUST 由随机源生成，不得由账号 ID、酒店 ID 或任何业务标识派生。定位某个账号的
登录态 MUST 通过 `OtaCredential.partitionName` 字段查询，不得通过拼接规则推导。

`<environment>` MUST 取当前产物的构建期环境值（见 `desktop-build-environments`），
MUST NOT 由调用方各自传入字面量——此前该段虽贯穿契约但所有调用点写死同一个值，使其
无法反映真实环境。

#### Scenario: 定位账号的登录态

- **WHEN** 任意流程需要打开某个 OTA 账号的登录态
- **THEN** 系统读取该账号关联 credential 的 `partitionName`
- **AND** 不得按渠道与账号 ID 拼出 partition 名称

#### Scenario: partition 名称反映构建环境

- **WHEN** 在某套环境的产物中创建新 partition
- **THEN** 名称中的 `<environment>` 段等于该产物的构建期环境值

### Requirement: 每个 partition 在账本中有唯一记录

系统 MUST 为每个被创建的 partition 在 `<userData>/partitions.json` 中登记一条记录，
状态取值为 `pending`、`claimed`、`retired`、`cleared` 之一。状态 MUST 落盘，不得只存在于
进程内存。

状态迁移路径：

```
created ──→ pending ──探测成功──→ claimed ──被替换──→ retired ──清空──→ cleared
                │                                                        │
                └──────────── 用户放弃/探测失败，长期未认领 ─────────────┘
```

系统 MUST 保留 `cleared` 之外的全部状态记录；`cleared` 记录 MAY 按数量与时间双上限裁剪。
`pending` 记录 MUST NOT 设置数量上限——异常堆积是认领链路故障的信号，需要暴露而非裁剪。

#### Scenario: 新建 partition 登记待认领

- **WHEN** 任意流程创建一份新 partition
- **THEN** 系统在账本中登记该 partition，状态为 `pending`

#### Scenario: 探测成功后转为已认领

- **WHEN** 某个 `pending` partition 上的身份探测成功并写入 credential
- **THEN** 系统将该 partition 状态改为 `claimed` 并记录 credential 标识

#### Scenario: 重启后退休标记仍然有效

- **WHEN** 某个 partition 被标记 `retired` 时仍有标签页占用，随后应用重启
- **THEN** 该 partition 的 `retired` 状态在账本中保留
- **AND** 系统仍可在后续时机完成清空

### Requirement: 绑定流程使用新建 partition 而非复用

发起酒店绑定时，系统 MUST 为本次绑定创建一份新的 partition，并把原账号 partition 中的
cookie 注入其中；MUST NOT 直接复用原 partition 打开绑定流程。

约束成因：渠道服务端会记住会话上次选择的门店（抖音表现为 `/p/login` 由页面脚本读取
`/passport/account/info/v2/` 的响应后自行跳转），复用原 partition 会使用户失去重新选择
门店的机会。该记忆绑定在登录会话上，清除本地存储无效。

以下做法 MUST NOT 被再次采用作为替代方案，均已实测无效：

| 已否决方案 | 实测结果 |
|---|---|
| 删除 localStorage 的门店选择键 | 删除成功但页面照跳；该键是落地结果的副本，不是原因 |
| 清除 Service Worker | 绕开 SW 后照跳；SW 只缓存了本就会发生的跳转 |
| 拦截页面自身跳转并停在中转页 | 中转页无可见内容，目标选择页不在该地址 |

#### Scenario: 为已登录账号发起绑定

- **WHEN** 用户选择一个已登录账号并发起酒店绑定
- **THEN** 系统创建新 partition 并注入原 partition 的 cookie
- **AND** 在新 partition 中打开渠道落地页
- **AND** 将新 partition 以 `pending` 登记入账本

#### Scenario: 绑定时选择新登录账号

- **WHEN** 用户在绑定入口选择「新登录账号」
- **THEN** 系统创建新 partition 且不注入任何 cookie
- **AND** 将新 partition 以 `pending` 登记入账本

### Requirement: 绑定成功后账号登录态迁移到新 partition

当新 partition 上的身份探测识别出一个**已存在的**渠道账号时，系统 MUST 把该账号
credential 的 `partitionName` 改写为新 partition，并将原 partition 标记为 `retired`。

此后该账号的一切登录态操作（打开账号、新建标签页、切换账号）MUST 使用新 partition。
系统 MUST NOT 保留回退到原 partition 的路径。

本要求与 `local-ota-credentials` 的「同一酒店被新登录态再次发现」不冲突：那条约束的是
**account 改指新 credential 时不动旧 credential**，本条约束的是**同一 credential 的
partition 指针被替换后旧 partition 的归宿**。

⚠️ 迁移的代价：新 partition 只注入了 cookie，原 partition 的 localStorage、IndexedDB、
Service Worker 与缓存 MUST NOT 被视为已迁移。依赖这些存储的渠道页面状态在绑定后会丢失，
表现为用户需要重新完成某些页面级验证。这是当前方案的已知代价，不是缺陷。

#### Scenario: 绑定成功触发登录态迁移

- **WHEN** 绑定新建 partition 上的探测识别出一个已有 credential 的渠道账号
- **THEN** 系统将该 credential 的 `partitionName` 改写为新 partition
- **AND** 新 partition 状态转为 `claimed`
- **AND** 原 partition 标记为 `retired`

#### Scenario: 迁移后新建标签页使用新 partition

- **WHEN** 迁移完成后用户对该账号新建标签页
- **THEN** 系统使用 credential 当前记录的新 partition
- **AND** 即使用户关闭了绑定期间打开的标签页，也不回退到原 partition

#### Scenario: 绑定中途放弃

- **WHEN** 用户在探测成功前关闭标签页或放弃绑定
- **THEN** 该账号 credential 的 `partitionName` 保持不变
- **AND** 新建的 partition 保持 `pending`，由启动清理按孤儿回收

### Requirement: 退休 partition 在无人占用且无人认领时才清空

系统 MUST 在清空一个 `retired` partition 前同时满足两个条件：没有任何标签页正在使用它，
且没有任何 credential 指向它。任一条件不满足 MUST NOT 执行清空。

当「无人占用」不满足时，系统 MUST 保留退休标记，延迟到最后一个占用标签页关闭时重试；
当「无人认领」不满足时，系统 MUST 撤销退休标记而非保留——该 partition 已是某条 credential
的活跃登录态，退休判断本身是错的，保留标记会让后续每次关闭标签页都重新尝试清空它。

清空 MUST 通过公开 Session API 完成（关闭连接、清除存储数据与缓存）；系统 MUST NOT 依赖
Chromium 未公开的 partition 目录结构删除文件。

#### Scenario: 占用中的退休 partition 延迟清空

- **WHEN** 某 partition 被标记退休时仍有标签页在使用
- **THEN** 系统保留退休标记且不清空
- **AND** 在该 partition 最后一个标签页关闭时重新尝试清空

#### Scenario: 退休判断被撤销

- **WHEN** 系统准备清空某 `retired` partition
- **AND** 检查发现仍有 credential 指向它
- **THEN** 系统撤销退休标记
- **AND** 不清空该 partition

#### Scenario: 关闭标签页只重试自身 partition

- **WHEN** 用户关闭一个标签页
- **THEN** 系统只对该标签页所属 partition 重试清空
- **AND** 不遍历退休集合中的其他 partition

### Requirement: 孤儿回收只作用于本环境的 OTA 登录 partition

系统 MUST 把「磁盘上存在、且无人认领」的 partition 当作孤儿回收，但候选范围 MUST 同时
满足两个条件：命名符合 OTA 登录 partition 的布局，且 `<environment>` 段等于当前产物的
构建期环境。

**环境段必须比对**：孤儿的判定依据是「本环境的 credential 表里查不到」，而 credential
按环境隔离存储，其他环境的 partition 在本环境的表里必然查不到——不比对环境就会把它们
全部误判成孤儿清空。基础设施 partition（服务端与 RMS 的会话）不符合该布局，天然被排除。

#### Scenario: 其他环境的 partition 不被回收

- **WHEN** 同一数据目录下存在其他构建环境命名的 partition
- **THEN** 系统不将其视为孤儿
- **AND** 不清空其存储

#### Scenario: 基础设施 partition 不被回收

- **WHEN** 启动清理扫描到服务端或 RMS 会话所用的 partition
- **THEN** 系统不将其视为孤儿

#### Scenario: 本环境的无主 partition 被回收

- **WHEN** 磁盘上存在本环境命名、账本与 credential 表中均无记录的 partition
- **THEN** 系统清空其存储

### Requirement: 新建标签页继承当前标签页的登录态

系统 MUST 使新建标签页使用「当前激活标签页所属 partition 对应 credential」的
`partitionName`。当前激活标签页的 partition 无法解析出 credential 时，新建标签页入口
MUST 不可用，MUST NOT 回退到该渠道的任意其他账号。

#### Scenario: 当前标签页已有可解析账号

- **WHEN** 用户在一个已识别账号的标签页上新建标签页
- **THEN** 新标签页使用该账号 credential 当前记录的 partition

#### Scenario: 当前标签页尚未完成身份探测

- **WHEN** 当前激活标签页的 partition 尚未写入任何 credential
- **THEN** 新建标签页入口不可用
- **AND** 系统提示用户先选择登录账号
