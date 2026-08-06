## Context

见 `proposal.md`。当前 `OtaAccount` 同时包含 OTA 酒店、`partitionName` 和字符串形式的 `channelContext`；`DiscoverAndCreate` 按 `(channel, otaHotelId)` 创建或更新账号，账号打开和 renderer 标签匹配都直接读取 `OtaAccount.partitionName`。

本轮处于整体架构方案的第一步，只调整本地模型和现有调用链。当前 discovery probe 仍只提供酒店信息，没有独立 credential probe；多酒店选择、intent/probe 框架和 RMS 同步均尚未进入本轮。

## Goals / Non-Goals

**Goals:**

- 使 domain 和 SQLite 中的 `OtaCredential`、`OtaAccount` 职责达到目标模型。
- 保持现有登录、cookie 导入、酒店探测、账号列表和打开账号效果。
- 为一 credential 对多 account 提供数据结构能力，不提前重写探测编排。
- 升级时以事务重建 OTA credential/account schema，不保留旧账号数据或 legacy 表。

**Non-Goals:**

- 不新增 CredentialProbe 或改变现有 DiscoveryProbe 的触发时机。
- 不让现有流程一次保存 `multiple` 结果，也不解决抖音跨公司连续发现。
- 不新增本地 OTA 登录信息页面。
- 不接入 `RmsOtaCredential`、`RmsOtaAccount` 或 server API。
- 不在本轮彻底移除 renderer 可见的兼容 `partitionName` 投影；该字段不再属于 domain 模型。

## Decisions

### 1. 本地使用两个独立聚合模型

新增 branded `OtaCredentialId` 和以下领域模型：

```ts
type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
type JsonObject = Readonly<{ [key: string]: JsonValue }>;

type OtaCredential = Readonly<{
  id: OtaCredentialId;
  channel: ChannelId;
  partitionName: string;
  credentialExtra: JsonObject | null;
  discoveredAt: number;
  lastRefreshedAt: number | null;
}>;

type OtaAccount = Readonly<{
  id: OtaAccountId;
  credentialId: OtaCredentialId;
  channel: ChannelId;
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
  discoveredAt: number;
}>;
```

`OtaCredential` 可在没有 account 时存在；`OtaAccount` 必须引用 credential。数据库外键使用 `ON UPDATE CASCADE ON DELETE RESTRICT`，避免删除 credential 时级联丢失账号。

本轮没有 credential probe，因此新 credential 的 `credentialExtra=null`、`lastRefreshedAt=null`。预留字段是为了稳定 schema，后续 probe 只填充字段，不再进行第二次拆表。

替代方案是继续让 `OtaAccount` 保存 partition，等抖音多酒店流程实现时再拆。否决原因是后续所有 feature、probe 和 UI 都会继续依赖错误模型，使迁移范围进一步扩大。

### 2. `bindExtra` 使用结构化 JSON，渠道负责生产和消费

`channelContext: string | null` 改为 `bindExtra: JsonObject | null`：

- 抖音：`{ merchantGroupId: groupId }`。
- 美团：`{ otaPartnerId: partnerId, otaPartnerName: partnerName }`，无相关字段时为 `null`。
- 携程：当前为 `null`。

domain 只定义 JSON value 约束，不解释渠道字段。各 discovery probe 负责生成合法对象，渠道 landing URL policy 负责读取自己认识的字段；SQLite repository 负责 JSON 序列化、解析和对象校验。

替代方案是仅把 `channelContext` 改名但继续保存任意字符串。否决原因是 credential/account 拆模正是一次数据边界调整，保留无 schema 字符串会把同一迁移问题推迟到远端绑定阶段。

### 3. Repository 分离，现有查询通过 main 侧投影组装

新增 `OtaCredentialRepository`：

```text
create(input)
findById(id)
findByPartitionName(partitionName)
```

`OtaAccountRepository` 改为保存和查询 account 事实，并将 `updatePartitionName` 替换为 `updateCredential`。domain repository 不通过 join 返回带 partition 的混合模型。

现有 IPC 暂时需要保持账号列表和标签匹配效果，因此 main 侧增加只读投影组装：查询 account 后再读取 credential，将 `partitionName` 投影到兼容 DTO。DTO 同时返回 `credentialId` 和新的 `bindExtra`，但兼容 `partitionName` 明确不是 `OtaAccount` 字段。

账号打开 handler 同样先查 account，再按 `credentialId` 查 credential。credential 缺失时抛出带 account/credential 上下文的错误，不回退共享 session。

替代方案是 repository 直接 join 并把 partition 塞回 `OtaAccount`。否决原因是它只在类型表面完成拆分，业务代码仍会继续把 account 当 credential 使用。

### 4. 现有探测链只改变落库，不改变 probe

`DiscoverAndCreate` 的输入和 `DiscoveryProbe` 接口保持不变。`single` 结果的落库顺序改为：

```text
按 partitionName 查 OtaCredential
  ├── 已存在：复用
  └── 不存在：创建 credential（extra=null）
        ↓
按 (channel, otaHotelId) 查 OtaAccount
  ├── 不存在：创建 account 并引用 credential
  └── 已存在：更新酒店事实、bindExtra 和 credentialId
```

仍保留当前 `(channel, otaHotelId)` 的单账号展示规则，以保证用户看到的账号集合不变。数据模型允许一 credential 多 account，但同一酒店同时保留多个 credential 的产品语义留到登录信息页面设计时再决定。

旧实现会在相同酒店换用新 partition 后清理旧 partition。本轮停止自动清理：credential 被视为有价值的独立登录态，且旧 credential 将来可能关联其他账号。无引用 credential 的清理需要单独的显式生命周期策略，不能作为账号更新的副作用。

credential 创建成功而 account 写入失败时可能留下无账号引用的 credential。这是合法状态，且比回滚后遗失一份有效登录态安全；错误继续向上保留上下文，不静默吞掉。

### 5. SQLite 升级直接重建账号表

新增一个事务性 migration：

1. 删除旧结构的 `ota_account` 表及其索引。
2. 创建 `ota_credential`，其中 `partition_name` 唯一。
3. 创建目标结构的 `ota_account`，含 `credential_id` 外键和 JSON `bind_extra`。
4. 创建 `(channel, ota_hotel_id)` 唯一索引以及 `credential_id` 查询索引。

migration 已由 `ApplicationDatabase` 包裹在单一 transaction 中。任何 schema 操作失败都会整体回滚。migration 不创建 `ota_account_legacy_v5`，也不接触 Electron session 目录。

不转换旧账号是本轮明确的产品取舍：旧 OTA 酒店信息可通过重新登录或 cookie 导入再次发现，避免维护一次性 legacy 数据模型、格式转换和恢复路径。

### 6. 兼容 DTO 是临时边界，不扩散回 domain

现有 renderer 用 `account.partitionName` 判断账号对应标签是否已打开。本轮为了控制迭代大小保留该效果：

```text
domain OtaAccount + OtaCredential
              ↓ main projection
OtaAccountDto { ..., credentialId, bindExtra, partitionName }
```

所有 main 内部写路径和账号打开路径必须使用 credential repository；只有 IPC 输出 mapper 可以生成兼容 `partitionName`。后续引入 BrowserIntent/本地登录信息页时，再用 `credentialId` 替代 renderer 的 partition 匹配并删除该 DTO 字段。

这是一项明确的过渡债务，不能以“兼容”为理由让新 domain 类型重新拥有 partition。

## Risks / Trade-offs

- [升级后旧 OTA 账号列表为空] → 这是已确认的取舍；用户重新登录或导入 cookie 后重新发现账号。
- [无引用 credential 逐渐累积] → 本轮不做自动删除；后续登录信息页提供可审计、显式的生命周期管理。
- [兼容 DTO 继续向 renderer 暴露 partitionName] → 限制在一个 mapper，新增测试确保 domain/account repository 不再包含该字段，并在后续 intent 迭代删除。
- [现有 `bound Set<partitionName>` 仍限制同一运行期重复发现] → 本轮只提供正确数据模型；多酒店连续发现属于下一轮 probe/feature 改造。

## Migration Plan

1. 先用旧结构内存数据库覆盖 migration 输入样本，验证旧账号被丢弃且没有 legacy 表残留。
2. 发布包含 schema migration、两个 repository 和兼容 mapper 的同一版本，避免出现只有表没有读取链路的中间态。
3. 真机升级后确认 OTA 账号为空，并通过重新登录或 cookie 导入重新生成 credential/account。
4. 发生 migration schema 错误时 transaction 自动回滚并停止启动。
5. 本轮不提供自动 down migration；升级前旧账号数据不作为回退来源保留。

## Open Questions

无。本轮需要影响任务拆分的决策已经确定；credential probe 的渠道字段和本地登录信息页交互属于后续 change。
