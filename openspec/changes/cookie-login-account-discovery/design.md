## Context

现状（实读确认）：

- `src/main/browser/browser-manager.ts:65` 全应用只有一个共享 session（`persist:hotel-butler-browser`），所有标签页、所有渠道都绑这一个，账号之间的登录态会互相覆盖
- `src/main/browser/cookie-import.ts` 的 cookie 导入硬编码 13 个域，不分渠道
- `domain/policy/partition-policy.ts`、`main/browser/session-factory.ts` 已经写了"按账号切 partition"的机制，但没有调用方
- `domain/identity.ts` 已有 `ChannelId` / `OtaAccountId` / `OtaHotelId` / `CredentialId` 等 branded type，可直接复用
- 已用真实抖音账号验证：cookie 本身不含门店信息；但在已应用 cookie 的 session 里，用 `webContents.executeJavaScript()` 对渠道自己的接口发起 `fetch(..., {credentials:'include'})`，可以拿到 200 响应和完整门店列表（`account_id` + `account_name`），不需要在主进程伪造任何安全 token
- 完全没有 `OtaAccount` / `OtaCredential` 这类账号模型和持久化

本次要解决的：**如何从"拿到一份渠道登录态"走到"创建一个可用的 OtaAccount"**——完整链路是"一次性导入所有渠道的 cookie → 用户对某个渠道点去登录（导入的 cookie 直接注入新建的标签页）→ 标签页关闭后统一探测账号"。

## Goals / Non-Goals

**Goals:**
- 支持"从系统浏览器导入 cookie（不分渠道，一次导入全部）→ 引导到对应渠道的登录标签页（导入的 cookie 直接注入）→ 标签页关闭后统一探测账号"这一条完整链路
- 探测逻辑（触发判断、执行、查重后创建）只有一套实现，不因为登录态来自"导入"还是"用户手动登录"而分叉
- 探测逻辑按渠道可插拔，本次只落地抖音，其余渠道占位
- 顺带修复现有的"全渠道共享一个 partition"问题（不专门列为独立任务，因为本次流程本身就要求"一份登录态一个 partition"）

**Non-Goals:**
- 不实现携程、美团的探测逻辑（接口未踩点，现在写就是猜）
- 不做定时轮询触发探测——本次唯一的触发时机是"登录标签页关闭"，定时轮询等后续需要再加
- 不做探测失败的用户提示——静默，不算异常
- 不做"重复门店"的处理界面——查重后如果已存在账号，只记日志，不建表、不提示、不阻断
- 不做 cookie 快照持久化——`OtaAccount` 只存 partition 名字这个指针，cookie 内容完全交给 partition 自己管理
- 不引入完整的 `ChannelManifest`（渠道差异先用最小化的域清单/探测实现覆盖）

## Decisions

### 1. 导入是登录标签页的预填步骤，本身不触发探测

**决策**：用户点"导入 Cookie"时，**不需要预先选择渠道**——一次性读取浏览器里所有支持渠道的 cookie，按渠道拆分后分别存文件到 `<userData>/cookie-imports/<channel>/`（同渠道再导入直接覆盖，成功建账号后不删，见决策 3 的既有部分不变）。

导入完成后，界面按渠道分组展示这次导入结果，每个渠道呈现"已导入，待登录确认"状态，配一个"去登录"动作。**导入本身不触发探测**，探测统一发生在"登录标签页关闭"之后：

```
用户点"导入 Cookie"（一次性读取所有支持渠道）
        ↓
按渠道拆分存文件，每渠道一份：<userData>/cookie-imports/<channel>/
        ↓
界面展示：按渠道分组，每个渠道显示"已导入，待登录确认"
        ↓
用户点某个渠道的"去登录"
        ↓
创建临时 partition（environment:channel:短id）
把该渠道已导入的 cookie 注入进这个新 partition
        ↓
加载渠道后台页面 —— 因为 cookie 已经在里面，大概率直接是登录状态，
用户看到的可能就是"选公司"页面，不需要重新输入账号密码；
若 cookie 已过期，用户在这个标签页里正常重新登录即可
        ↓
标签页关闭 → 触发探测（账号探测层，见决策 2）
```

**理由**：如果导入完还要求用户先选一个渠道才能导入，跟"用户通常不会记得自己在哪些渠道登录过"的真实使用场景不符——一次性导入所有渠道、让用户在结果列表里挑感兴趣的去确认登录，路径更短。同时，"导入 cookie"如果导入完不喂给任何后续动作，价值就只是"证明曾经登录过"，用户还是要重新走一遍账号密码——**注入进登录标签页**才是导入这个动作的实际价值所在：省去重新输入账号密码的步骤。

### 2. 账号探测层：三段式，触发条件是"状态"而非"事件"

```
1. 探测触发 —— 判断依据：这份登录态（partition）还没有关联任何 OtaAccount
   当前唯一触发时机：登录标签页关闭时
   （时机只是"什么时候去检查触发条件"，不是触发逻辑本身；以后加新时机（如定时轮询）不改这层判断）

2. 探测执行 —— 复用已验证方式：
   在该 partition 上创建一个 WebContentsView，加载渠道后台页面，
   用 executeJavaScript 在页面上下文里发起 fetch 调用门店列表接口，
   按渠道各自实现（DiscoveryProbe 接口，channel → 实现 的 registry）

3. 探测成功后创建 —— 按 (channel, otaHotelId) 查重：
   - 不存在 → 创建 OtaAccount { channel, otaHotelId, displayName, partitionName }
   - 已存在 → 更新该账号的 partitionName 为这次新的 partition，
     并删除旧 partition 的 session 目录（见决策 7）
   - 探测到多个门店 → 弹出列表由用户选择，只为选中的创建/更新账号
```

**理由**：把"触发"定义成状态判断而非具体事件，是因为以后可能会加入新的触发时机（比如定时轮询），但"要不要探测"这件事的判断依据应该始终是同一个——"这份登录态是否还没账号"，不应该在不同触发时机里各写一套判断逻辑。

### 3. Partition 命名：`environment:channel:<短id>`，不再按 `(environment, channel, otaAccountId)` 反推

**决策**：用户点某渠道的"去登录"、创建标签页时，partition 名字格式为 `persist:xiaozhi:<environment>:<channel>:<短id>`，`短id` 在创建这个标签页时随机生成（如 `randomUUID()` 截断），不代表业务身份。若该渠道存在已导入的 cookie 文件，创建 partition 后立即注入（见决策 1）。探测成功后，直接把这个 partition 名字原样存进 `OtaAccount.partitionName`，**不做任何"转正"或改名/搬目录操作**。

**理由**：
- 原设计（`toPartitionName(key: BrowserContextKey)`，按三元组 `environment:channel:otaAccountId` 拼接）要求创建 partition 时就已知 `otaAccountId`，但创建登录标签页时账号还完全不存在（探测都还没做），这个前提不成立
- 曾考虑"先用临时命名登录，探测成功后搬目录改成正式命名"，但 Electron 不允许安全地搬动一个仍被 `WebContentsView` 占用的 session 目录，必须等标签页关闭才能搬——这会导致"定时轮询探测到账号信息但标签页还开着"时无法完成建账号
- 改为"partition 名字本身当作账号的存储指针，创建时刻就固定、不再改变"后，探测成功可以在任意时刻直接落库，不依赖标签页是否已关闭，也不需要搬目录

**替代方案**：把 cookie 内容存进数据库，每次需要时新建 partition 注入。被否决——cookie 是浏览器会话类凭证，站点会在使用过程中持续刷新其中的 token（已实测抖音的多个 cookie 带独立 `expires`），存数据库当权威源意味着要持续同步一份不断变化的快照，比"partition 本身就是权威存储、数据库只存指针"复杂得多。

### 4. `isCurrentLayoutPartition` 判断逻辑不受影响

现有 `partition-policy.ts` 的 `isCurrentLayoutPartition(name)` 只检查前缀是否为 `persist:xiaozhi:`，用于区分新旧 partition（旧的是 `persist:hotel-butler-browser`）。只要新命名规则仍以 `persist:xiaozhi:` 开头，这个判断不需要修改。需要改的只是 `toPartitionName` 的具体拼接方式（三元组 → `environment:channel:短id`）。

### 5. `DiscoveryProbe` 接口不变：按渠道各自实现

复用之前讨论过的设计：接口定义在 `domain/ports/discovery.ts`，每个渠道的实现（URL、分页、字段映射）完全封装在各自文件里，本次只实现抖音，携程/美团占位返回"不支持"。

### 6. `OtaAccount` 不存 cookie 快照

`OtaAccount` 记录只包含 `{ id, channel, otaHotelId, displayName, partitionName }`。要使用这个账号的登录态，永远是 `session.fromPartition(该记录的 partitionName)`，cookie 的值、刷新、过期完全由 Electron 的 session 机制自己处理，数据库里不存储、不同步任何 cookie 内容。

### 7. 查重命中：以最新登录为准，旧 partition 直接删除

**决策**：探测按 `(channel, otaHotelId)` 命中已存在的 `OtaAccount` 时，把该账号的 `partitionName` 更新为这次新的 partition，并删除旧 partition 对应的 session 目录（`session.fromPartition(旧名字).clearStorageData()` 或等效的目录清理）。不保留旧 partition，不产生孤儿。

删除时机：探测发生在标签页关闭之后（决策 2），所以旧 partition 和新 partition 此时都不再被任何 `WebContentsView` 占用，可以安全清理，不存在"目录被占用删不掉"的问题。

**理由**：用户点某渠道的"去登录"这个动作，意图就是"让这份登录态对这个门店生效"——不管这个门店是不是第一次被这个渠道探测到。如果保留旧账号、丢弃新登录，用户会在不知情的情况下做了一次没有任何效果的操作；而"当前生效登录态是 A 还是 B"这种未定义状态本身就是不可接受的（业务代码在用旧 partition 操作门店时，无法保证这份登录态没有过期或被别的动作顶替）。"以最新为准"让这个问题始终有唯一答案。

**代价**：如果用户是误操作重新登录了一个早已正常工作的账号，旧登录态会被直接丢弃，没有回退手段——本次不做"确认覆盖"之类的用户提示（Non-Goals 已声明不做探测相关的用户提示），这是明确接受的简化。

## Risks / Trade-offs

- **[风险] 探测触发依赖"标签页关闭"这一个时机，用户长期不关闭标签页会导致账号一直不被创建** → 这是本次明确接受的简化（Non-Goals 已声明不做定时轮询），后续可加
- **[风险] 查重命中后旧 partition 直接删除，没有用户确认或回退手段** → 见决策 7，本次明确接受；用户若误操作会静默丢失旧登录态，只能重新登录找回
- **[风险] Partition 名字里的短id 不携带业务语义，纯粹靠 `OtaAccount.partitionName` 做关联；如果这条数据库记录丢失，找回对应 cookie 需要遍历磁盘上的 partition 目录** → 可接受，因为 `OtaAccount` 本身就是这份登录态唯一的"账本"，与"cookie 是易变数据、数据库不重复存储"的决策一致
- **[风险] 携程/美团探测本次占位不实现** → 明确的范围排除，不是遗漏
