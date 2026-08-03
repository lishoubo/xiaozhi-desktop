# 术语表与「订单来了」概念映射

日期：2026-08-03
状态：命名已定稿，后续文档与代码以本表为准

本表解决两个问题：① 我们自己的术语统一 ② 读订单来了调研材料时的概念对照，避免把它的词直接搬进我们的代码。

---

## 1. 我们的术语（定稿）

### 1.1 标识类型

全部使用 branded type，让编译器拦住"把 A 的 ID 传给 B 的参数"这类错误。

```ts
// src/shared/identity.ts
export type ChannelId    = string & { readonly __brand: 'ChannelId' };
export type OtaAccountId = string & { readonly __brand: 'OtaAccountId' };
export type HotelId      = string & { readonly __brand: 'HotelId' };
export type AppUserId    = string & { readonly __brand: 'AppUserId' };
```

| 术语 | 含义 | 例值 | 权威方 |
|---|---|---|---|
| `ChannelId` | 渠道（**不是账号，不是域名**） | `ctrip` / `meituan` / `fliggy` / `douyin` | 我们（channel manifest） |
| `OtaAccountId` | OTA 渠道账号 | `ctrip-account-1` | 我们（本地生成） |
| `HotelId` | 门店 | — | rms 后端 |
| `AppUserId` | 我们自己的 app 账号 | — | rms 后端 |

**`ChannelId` 的三条约定**：① 一律小写、字符集 `[a-z0-9-]`（要拼进 partition 字符串和磁盘路径，大小写混用会在 macOS 通过、Linux 失败）；② 取值是渠道而非账号或域名 —— `ctrip` ✅、`ctrip-1` ❌（那是 `OtaAccountId`）、`ctrip.com` ❌（那是 `cookieDomains` 条目）；③ 权威在 manifest 文件名，不在代码里硬编码枚举（渠道高频新增，写成 TS 枚举意味着加渠道要发版）。

**为什么 `OtaAccountId` 和 `AppUserId` 必须是两个类型**：这是「两套账号体系不绑定」这条设计决策在类型层面的落实。命名分开是给人看的，branded type 是给编译器看的——两者都要有，才防得住。

### 1.2 组合类型

```ts
export type BrowserContextKey = {
  environment: 'prod' | 'dev';
  channel: ChannelId;
  otaAccountId: OtaAccountId;
};
```

**业务层定位一个浏览器上下文，一律用 `BrowserContextKey`，不用 partition 字符串。**

```ts
export type HotelExecutionScope = {
  appUserId:    AppUserId;
  hotelId:      HotelId;        // ⚠ 单数，不是数组
  channel:      ChannelId;      // 哪个渠道
  otaAccountId: OtaAccountId;   // 该渠道下的哪个账号
  environment:  'prod' | 'dev';
};
```

**一次 agent 执行的作用域。** `hotelId` 是单数这件事本身是一条架构约束——「不做跨店 fan-out」就落在这个字段上（详见领域模型 §2.6）。

`channel` 必须显式存在，不能靠 `otaAccountId` 反查：反查要访问数据库，而审计要求自包含。加上它之后 **`BrowserContextKey` 正好是 `HotelExecutionScope` 的子集**。

刻意不叫 `ExecutionContext`（该词在 TS 生态被用滥，且 `Context` 暗示"可以装任意东西"），也不叫 `OtaContext`（它有一半字段与渠道无关，而 `Ota*` 前缀在本项目固定表示"属于渠道侧"）。

### 1.3 状态与设施

| 术语 | 含义 | 说明 |
|---|---|---|
| `browserState` | 浏览器侧需要持久化的运行状态 | 页签、活动账号、登录态。存 `app.sqlite` |
| `partition` | 一份独立的 Chromium 存储 | **Electron 术语，仅 `SessionFactory` 内部使用** |
| `LoginState` | 登录态三元组 | `state` + `source` + `updatedAt`，缺一不可 |
| `ChannelManifest` | 渠道的能力与策略声明 | 入口 URL、允许 origin、cookie 域、登录检测策略等 |

#### 关于 `partition`

`partition` 是 Electron 的 API 术语（`session.fromPartition()`），磁盘目录也叫 `Partitions/`。我们**保留这个词但不外泄**：

```ts
class SessionFactory {
  private toPartition(key: BrowserContextKey): string {
    return `persist:xiaozhi:${key.environment}:${key.channel}:${key.otaAccountId}`;
  }
  sessionFor(key: BrowserContextKey): Session { /* 业务层只调这个 */ }
}
```

除 `SessionFactory` 外，任何文件不得出现 `partition` 字样，也不得手工拼接这个字符串。

**理由**：改叫自造词会和 Electron 文档对不上（净损失）；但让它满代码飞又会把底层细节泄漏到业务层。封装是两全解。

文档和 UI 文案里可以说「浏览器身份」或「登录上下文」，代码里一律 `BrowserContextKey`。

### 1.4 留白不用的词

| 词 | 为什么留白 |
|---|---|
| `workspace` | 将来可能用作**业务作用域**（知识库 + skill + 可操作账号的容器）。但那三样现在都不存在，提前定容器大概率定错形状。**不借用它指代渠道或浏览器状态。** |
| `tenant` / 多租户 | 已确认不做。需要分组时加 mapping 层，不在标识符里预留字段 |
| `property` | 酒店行业英文术语，但我们是中文团队做中文产品，多一层翻译。统一用 `HotelId` |

---

## 2. 与「订单来了」的概念映射

读 `docs/research/` 下的调研材料时用这张表对照。**左列是它的词，右列是我们的词——不要把左列直接搬进代码。**

### 2.1 需要改名的概念

| 订单来了 | 我们 | 差异说明 |
|---|---|---|
| `workspaceId` | `ChannelId` | ⚠️ **最容易踩的坑**。它的 `workspaceId` 就是渠道 ID（实测 `lastActiveChannelWorkspaceId: "ctrip"`），不是工作空间。我们直接叫 `channel`，把 `workspace` 留给真正的业务作用域 |
| `accountId` | `OtaAccountId` | 它的 `accountId` 只指 OTA 账号（app 账号在另一个文件里，见下）。我们加 `Ota` 前缀明确归属 |
| `ntwIdNew` | `HotelId` | 它的 PMS 门店 ID，"网点 ID"缩写。语义相同，命名不知所云，不采用 |
| `campName` | （暂无） | 它 `pms_get_context` 里的字段，推测是门店名。我们用 `HotelId` + 单独的显示名字段 |
| `workspace-state.prod.json` | `browserState`（存 SQLite） | 概念对应，但**我们用 SQLite 不用 JSON**（见 2.3） |
| `channelHotelName` / `channelUserLogin` | 渠道身份回显字段 | 概念保留（让用户肉眼确认操作对象），命名待定 |

### 2.2 直接沿用的概念

这些它做对了，我们照抄，连命名思路一起：

| 订单来了 | 我们 | 说明 |
|---|---|---|
| partition per (workspace, account) | partition per (channel, otaAccountId) | 结构完全一致，只换词 |
| `loginState` + `loginStateSource` + `loginStateUpdatedAt` | 同名保留 | 登录态必须带判断来源和时间，不能只存 bool |
| `isPrimary` / `openerTabId` | 同名保留 | 渠道主页签标记 + 弹窗父子关系 |
| `allowAnyUrl`（per-tab） | 同名保留 | 导航策略默认收紧、按 tab 放开 |
| `channelSync` 定时上报 | `OtaAccountSyncGateway` | 机制照抄，封装成 Gateway |
| `bridge.sock`（MCP 无权限，转发到主进程） | 同架构 | 见 `2026-08-03-harness-and-architecture-review.md` |
| snapshot → ref → act → snapshot | 同流程 | 不让模型猜 selector 和 URL |
| context-first（`pms_get_context` 先行） | 同原则 | 上下文不完整拒绝执行 |
| 订单盒子（不占库存 / 不计营收 / 同步房态） | `InventoryImpact` 枚举 | 见 `2026-08-03-research-gaps-and-backend-abstraction.md` 遗漏 1 |

### 2.3 我们刻意做得不一样

| 维度 | 订单来了 | 我们 | 理由 |
|---|---|---|---|
| app 账号 ↔ OTA 账号 | 无绑定（OTA 账号全局） | 同样无绑定 | 判断一致：生命周期不同步，硬绑处处是特例 |
| browserState 存储 | JSON 文件（有 `.bak`） | SQLite | JSON 全量重写易写坏（它自己有 `.bak` 就是在防这个）；我们已有迁移框架 |
| 门店归属 | `channelHotelName` 事后回显 | 待定（见下方未决） | 它实测 15 个账号全为空 |
| 审批粒度 | 按 MCP server（整个 browser 一律 approve） | 按工具 `RiskLevel` 分级 | 它的粒度导致只读 snapshot 也要人点确认 |
| 并发锁 | `execute_skill` 串行锁（全局） | 账号级读写锁 | 全局锁限制吞吐；账号级允许跨账号并行 |
| 工具超时 | `tool_timeout_sec = 3600`（browser） | 按工具分别设 | 1 小时超时会让卡住的页面挂死 agent |
| 会话持久化 | 全外包给 Codex | 双写（Codex + 我们的 `agent_session`） | 换 harness 时会话不丢，且能关联业务实体 |
| 模型网关 | 自建（`base_url` 指向自家域名） | 同样自建 | 判断一致：合规 + 可换模型 |
| 多租户 | 无 | 同样无 | 判断一致 |

### 2.4 它有但我们暂不做

| 订单来了 | 我们的处置 |
|---|---|
| 跨店 fan-out | **架构上让它做不到**（`HotelExecutionScope` 只持有单个 `HotelId`）。它自己也关掉了这个功能 |
| skill marketplace | 等有 skill 再说 |
| `browser_evaluate` | 要么不提供，要么用代码限制（不能只靠 prompt 约束） |
| 云 PMS / Channel Manager | 我们的权威在 rms 后端，产品定位不同 |

---

## 3. 命名一致性检查清单

新增代码或文档时对照：

- [ ] 用 `ChannelId` 不用 `workspaceId`
- [ ] 用 `OtaAccountId` 不用裸 `accountId`
- [ ] 用 `HotelId` 不用 `propertyId` / `ntwId`
- [ ] app 账号用 `AppUserId`，不和 `OtaAccountId` 混用
- [ ] `partition` 字样只出现在 `SessionFactory`
- [ ] 不使用 `workspace` 指代渠道或浏览器状态
- [ ] 登录态一律三元组，不用裸 bool
- [ ] 执行作用域用 `HotelExecutionScope`，不用 `ExecutionContext` / `OtaContext`
- [ ] `HotelExecutionScope.hotelId` 保持单数（改成数组 = 拆掉跨店 fan-out 防线）
- [ ] `ChannelId` 取值小写、是渠道不是账号/域名（`ctrip` 而非 `CTRIP` / `ctrip-1` / `ctrip.com`）

---

## 4. 未决事项

以下需要产品判断，定了再回来补本表：

1. **一个 OTA 账号挂多家店时怎么定位当前门店**（订单来了用 `channelHotelName` 事后回显，实测为空）。取决于目标客户是单体还是连锁
2. **`workspace` 将来的确切含义**（知识库 + skill + 可操作账号的容器？和 HotelId 什么关系？）
3. **rms 后端现有术语**——本表定稿时未读 `/Users/lishoubo/p/projects/xiaozhi-rms-workspace`。若 rms 已有 `HotelId` 之外的叫法，以 rms 为准并回来更新本表

---

## 5. 验证说明

本表的「订单来了」列全部来自本机只读观察，来源：

- `~/Library/Application Support/ddlldesk/workspace-state.prod.json`（全量 19 个 workspace）
- `~/Library/Application Support/ddlldesk/Partitions/`（15 个目录）
- `~/Library/Application Support/ddlldesk/{device-auth,global-store,ai-workbench-session-owners}.json`
- `~/.smartorder/config.toml`
- `~/.smartorder/state_5.sqlite`（`.schema` 元数据）
- `/Applications/订单来了.app/Contents/Resources/{skills-catalog.json,release-runtime-config.json,smart-order-skills/browser-guide/SKILL.md}`
- `docs/research/` 13 篇调研文档

`campName` 的语义为推测（未见实际取值）。`pms_get_context` 的字段清单来自调研文档转述，本次未直接验证。
