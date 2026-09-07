## Purpose

定义 desktop 把一份 OTA 登录态 cookie 采集下来、上送给 RMS 的行为契约：快照必须包含哪些属性、属性缺省怎么表达、采集能力受限时如何降级并留痕。RMS 拿这份快照写回浏览器复现登录态，因此快照的**完整性**（而非可读性）是这条链路的唯一目标。

## ADDED Requirements

### Requirement: cookie 快照必须携带浏览器复现登录态所需的全部属性

系统 MUST 在上送给 RMS 的 cookie 快照中，为每一条 cookie 携带 `name`、`value`、`domain`，
并在来源提供时携带 `path`、`secure`、`httpOnly`、`sameSite`、`expires`、`partitionKey`。

系统 MUST NOT 仅上送 `{name, value, domain}` —— 缺少有效期的 cookie 会被接收方当作会话
cookie 处理，缺少分区键的 cookie 无法写回原分区，两者都会让复现出的登录态残缺。

`sameSite` 的取值 MUST 是 `"None"` / `"Lax"` / `"Strict"` 之一。

#### Scenario: 上送一条带有效期的普通 cookie

- **WHEN** 采集到一条设置了过期时间的非分区 cookie
- **THEN** 快照条目包含 `name`、`value`、`domain`、`path`
- **AND** 包含 `secure`、`httpOnly` 的实际布尔值
- **AND** 包含 `expires`，其值为 epoch 秒且大于 0

#### Scenario: 上送一条分区 cookie

- **WHEN** 采集到一条带分区键的 cookie
- **THEN** 快照条目包含 `partitionKey`
- **AND** `partitionKey` 的结构与采集来源给出的完全一致

### Requirement: 属性缺省以省略字段表达，不以默认值或 null 表达

系统 MUST 在某个可选属性未被采集来源提供时**省略该字段**，MUST NOT 为其填入默认值。

`sameSite` 未设置（浏览器按默认策略处理）与 `sameSite: "None"`（明确声明允许跨站携带）
是两种不同的浏览器行为；系统 MUST NOT 把前者补成后者或补成 `"Lax"`。

系统 MUST 在 cookie 为会话 cookie（无过期时间）时省略 `expires`，MUST NOT 上送负数或 0。

#### Scenario: 来源未提供 sameSite

- **WHEN** 采集来源对某条 cookie 未给出 `sameSite`
- **THEN** 该快照条目不包含 `sameSite` 字段

#### Scenario: 会话 cookie 的有效期

- **WHEN** 采集到一条没有过期时间的会话 cookie
- **THEN** 该快照条目不包含 `expires` 字段

### Requirement: partitionKey 原样透传

系统 MUST 把采集来源给出的 `partitionKey` 原样放入快照，MUST NOT 解析、重新拼装、
转换为字符串或做任何形式的归一化。

不同浏览器版本给出的 `partitionKey` 形态可能不同（对象或字符串）；接收方负责原样存储
与写回，任何客户端加工都会让浏览器不认这个分区键，导致分区 cookie 失效。

#### Scenario: 分区键形态与来源不一致时

- **WHEN** 采集来源给出的 `partitionKey` 是一个对象
- **THEN** 快照中的 `partitionKey` 仍是同一个对象，字段与取值均未被改写

### Requirement: 不裁剪、不去重

系统 MUST 上送采集范围内的全部 cookie，MUST NOT 按域名或名称过滤。

系统 MUST NOT 按 `name` 去重。同一个 `name` 在不同 `domain`、不同 `path`、分区与非分区
之下是不同的 cookie，取值可能不同；去重由接收方按 `(name, domain, path, partitionKey)` 负责。

#### Scenario: 同名 cookie 存在多份

- **WHEN** 采集结果中同一个 `name` 出现在两个不同 domain 下
- **THEN** 两条都出现在快照中

#### Scenario: 同名 cookie 分区与非分区各一份

- **WHEN** 采集结果中同一个 `name` 有一份带 `partitionKey`、一份不带
- **THEN** 两条都出现在快照中，且各自的 `partitionKey` 状态保持原样

### Requirement: 采集覆盖登录态涉及的全部域

系统 MUST 采集该登录态浏览器分区内的全部 cookie，MUST NOT 只采集当前页面所属域。

OTA 登录态可能跨多个域（抖音实测跨 `.douyin.com` / `.life.douyin.com` /
`.bytedance.com` / `.oceanengine.com`），SSO 票据分散其中，漏任一域都可能导致登录态不完整。

#### Scenario: 登录态跨多个域

- **WHEN** 当前页面属于其中一个域，而登录票据分散在多个域
- **THEN** 快照包含全部这些域下的 cookie，不限于当前页面域

### Requirement: 采集能力受限时降级并留痕

系统 SHALL 在完整采集能力不可用时，降级为仅缺少 `partitionKey` 的采集方式，
其余属性（`path` / `secure` / `httpOnly` / `sameSite` / `expires`）仍 MUST 补齐。

系统 MUST NOT 因采集能力受限而让绑定、重新登录或补门店流程失败 —— 降级快照虽不完美，
但显著优于当前的三字段快照。

系统 MUST 在降级发生时打印结构化日志，标明本次为降级采集及其原因，使接收方排查登录态
质量问题时能区分「客户端未改造」与「本次采集降级」。

#### Scenario: 完整采集不可用

- **WHEN** 完整采集能力当下不可用
- **THEN** 系统改用降级方式采集
- **AND** 快照条目仍包含 `path`、`secure`、`httpOnly`、`sameSite`、`expires`
- **AND** 快照条目不包含 `partitionKey`
- **AND** 系统记录一条标明降级及原因的结构化日志
- **AND** 当前的绑定 / 重新登录 / 补门店流程继续执行，不因此失败

#### Scenario: 降级采集的 sameSite 取值

- **WHEN** 降级采集来源给出的 `sameSite` 取值属于其自有值域
- **THEN** 系统将其映射为 `"None"` / `"Lax"` / `"Strict"`
- **AND** 来源标明「未指定」时，快照条目省略 `sameSite` 字段

### Requirement: 快照不落地、不入日志

系统 MUST NOT 把 cookie 快照写入本地存储或普通日志。日志中 MUST 只出现条数、
采集方式与降级原因等元信息，MUST NOT 出现任何 cookie 的 `value`。

#### Scenario: 采集完成后记录日志

- **WHEN** 一次采集完成
- **THEN** 日志包含本次条数与采集方式
- **AND** 日志不包含任何 cookie 名称对应的取值
