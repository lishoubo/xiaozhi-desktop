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
   触发时机：登录标签页的 URL 导航到达"已登录"特征时（见决策 8）
   （时机只是"什么时候去检查触发条件"，不是触发逻辑本身；以后加新时机（如定时轮询）不改这层判断）

2. 探测执行 —— 按渠道各自实现（DiscoveryProbe 接口，channel → 实现 的 registry）：
   - 抖音：已验证方式——在该 partition 上创建一个 WebContentsView，加载渠道后台页面，
     用 executeJavaScript 在页面上下文里发起 fetch 调用门店列表接口（groupAccountList），拿结构化数据
   - 携程：接口未踩点，先用 DOM 解析落地——在该 partition 上创建 WebContentsView，
     加载登录后落地页，解析 `a.he-ctrip-hotel-title-link` 元素的文本与 href 拿门店名和 otaHotelId
     （与 rms-rpa-worker 的 ctrip/init_hotel_info.py 已验证的选择器一致）；后续若接口踩点成功，
     可换成接口调用，不改 DiscoveryProbe 接口本身

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

### 8. 探测触发时机改为"URL 判定登录成功"，取代"标签页关闭"

**决策**：登录标签页的 `did-navigate` / `did-navigate-in-page` 事件里，按渠道注册一个 `LoginUrlMatcher.isPastLogin(url)` 判定函数——URL 命中"已离开登录页"特征即视为登录成功，直接触发探测（决策2 步骤1）。**不再以"标签页关闭"作为触发时机**，原因见下。渠道未注册 matcher 时，这个渠道暂不支持 URL 触发（现状：仅携程注册，判据抄自已验证过的 RPA 实现——`!url.includes('/login/')`，见 `rms-rpa-worker/.../ctrip/login.py:30`；抖音未注册，等以后需要再补）。

**触发去重（防止重复探测/性能问题）**：判断依据不是"事件发生过没有"，而是"这个 partition 是否已经关联了 OtaAccount"——一个二态状态，不是三态状态机：
- 未绑定：允许触发探测
- 已绑定：任何后续导航都直接跳过，不创建 `WebContentsView`、不发请求

用户登录成功后长时间停留在后台页面里点导航（SPA 路由跳转会不断触发 `did-navigate-in-page`），只有第一次成功探测会真正执行；探测成功、账号创建/更新完成的那一刻，这个 partition 的状态就翻转为"已绑定"，后续所有导航事件在状态判断这一步就短路返回，不会重复创建 view 或重复请求渠道接口。探测执行期间（尚未有结果）用一个内存 `Set<partitionName>` 做防重入锁，避免探测未完成时同一 partition 被并发触发第二次；探测失败或返回 `none`（页面还没完全跳转、接口/DOM 还没就绪）时不加入这个 Set 之外的任何标记，允许下一次导航事件重新尝试。

**为什么不再用"标签页关闭"兜底**：如果 URL 判定这条路径本身就能可靠捕捉"登录态已经生效"这个状态转移，"标签页关闭"作为并列的第二个触发入口就是冗余的——同一件事有两个入口，会让"这次账号到底是哪次触发建的"难以排查。改为 URL 触发后，`onClosed` 不再调用探测层；`BrowserManager.createAndNewPartition`（Task 3.2）新增的回调改名为 `onUrlPastLogin`，语义从"标签页关闭时"改为"URL 判定登录成功时"。

**对决策 7 的影响**：决策 7 原本的前提"探测发生在标签页关闭之后，新旧 partition 都不再被占用"不再成立——URL 触发时标签页仍然开着，查重命中要删除的"旧 partition"有可能仍被另一个还开着的标签页占用。决策 7 的"删除失败不阻断账号更新"这条容错本身已经覆盖这种情况，不需要新增逻辑，只是这里明确一下：删除失败（含"目录被占用"）在 URL 触发场景下会更常见，不是异常路径。

**完整链路**：

```
用户点携程"去登录"
        ↓
LoginTabOpener.open()：读该渠道已导入的 cookie
  → BrowserManager.createAndNewPartition(environment, channel, url,
      { importedCookies, loginUrlMatcher, onUrlPastLogin })
        ↓
BrowserManager.bindTabEvents 监听 did-navigate / did-navigate-in-page
  每次导航 → checkUrlPastLogin(tab, url)：
    tab.urlPastLoginTriggered 已置位 → 短路返回（同一标签页只触发一次）
    否则 loginUrlMatcher.isPastLogin(url)
      false → 什么都不做，等下一次导航再判定
      true  → 置位 urlPastLoginTriggered，调 onUrlPastLogin(partitionName)
        ↓
DiscoverAndCreate.trigger(partitionName, channel)
  bound（已绑定）/ inflight（探测中）内存 Set 短路 → 未命中则执行探测
        ↓
  CtripDiscoveryProbe.discover(partitionName)（决策 8.1，见下）
        ↓
  single  → 查重创建/更新 OtaAccount，partition 标记 bound（永久不再探测）
  multiple → 只记日志，不落库、不标记 bound（等 Task 6/7 的用户选择 UI）
  none    → 不标记 bound，允许用户下次重新走"去登录"时再次触发整条链路
```

#### 8.1 探测执行内部的重试：只在同一次已加载页面上多轮询几轮，不重新导航

**背景（2026-08-04 真机验证暴露）**：真实携程账号验证时，同一账号不同次登录，页面有时先落到移动端布局再跳桌面版，移动布局下 `a.he-ctrip-hotel-title-link` 不存在。原实现是"`loadURL` 一次 → 轮询 15 秒（200ms 间隔）→ 超时就用当前已有结果 resolve"，命中移动布局这一轮必然拿到 `none`；第一次真机验证正是如此，耗时约 52 秒（页面慢 + 15s 轮询超时）后返回 `none`，用户必须手动重新走一遍"去登录"整条链路才能重试，第二次命中桌面布局，1.7 秒内探测成功。

**决策**：`discover()` 内部把"轮询等待元素出现"从 1 轮 15 秒改为**最多 3 轮，每轮 15 秒**，轮次之间**不重新 `loadURL`、不改 UA、不做任何导航动作**——只是在同一个已经加载好的页面上，继续用 `querySelectorAll('a.he-ctrip-hotel-title-link')` 反复找元素。理由：

- 移动/桌面布局是两套不同的 DOM，重新导航同一个 URL 不会让页面从移动布局变成桌面布局（同一 session、同一账号、同一入口 URL，服务端判定逻辑不会因为刷新一次而改变），所以"刷新页面重试"对这个具体故障没有帮助，只会重复消耗一次页面加载时间
- 真机验证观察到的现象是"重新走一遍登录标签页后能拿到桌面布局"，但触发桌面布局的确切条件未知（可能是页面自身有延迟的客户端跳转、也可能是别的因素）——**在没有查明确切原因前，不应该在方案里假设"强制某个 UA 就能命中桌面布局"这类未经验证的因果关系**；真正确定成立的只有"多等一会、多查几次 DOM，如果页面本身会自己从移动跳桌面，重试就能等到"
- 3 轮是"给页面自己完成潜在跳转的时间"，不是"反复触发新的网络请求"

单轮内部机制不变：`querySelectorAll` 立即查一次，查到就直接 resolve；查不到则 `setInterval(200ms)` 轮询，最长 15 秒。3 轮轮询之间**无间隔**，因为间隔不能解决任何已知问题——第一轮的 15 秒本身已经给了页面足够的等待时间，轮次之间加间隔只是单纯拉长总耗时，不改变第二轮拿到 DOM 的概率。3 轮全部落空则返回 `none`（成本：最坏情况下探测总耗时从 15 秒变为 45 秒，仍在一次用户操作可接受的等待范围内；`WebContentsView` 全程只创建一次，不是每轮重新创建，内存/进程开销不随轮数增加）。

**仍然不做的**：跨越"标签页整个生命周期"的重试（即 `none` 之后不在探测层内部安排下一次登录标签页级别的重试），这仍然依赖用户手动重新触发"去登录"——因为 `none` 也可能是页面结构真的变了（选择器过期），无限重试没有意义，交还给用户判断要不要重试是本次明确接受的简化（Non-Goals：不做探测失败的用户提示，本次也不做失败后的自动化外层重试）。

### 9. 抖音门店探测：URL 判定要求带 `groupid`，执行层是两步接口调用，不产生 `multiple`

**决策**：抖音渠道的 `LoginUrlMatcher.isPastLogin(url)` 要求 URL 同时满足"命中 `/p/home`"和"带 `groupid` 查询参数"——只判路径不判参数会在"停在选公司中间态"误判为已登录。抖音登录流程和携程不同：一个账号可能挂多家"公司"，登录后若只挂一家会自动带 `groupid` 直跳 `/p/home`，若挂多家则先停在 `/p/login` 下的选公司列表页，**由用户在登录标签页里手动选完公司**，选完之后才会落到同样带 `groupid` 的 `/p/home`（参照 `session.py:81-90` 的落地页约定）。这意味着"选哪个公司"这一步完全在用户的登录标签页交互里完成，探测层看到 URL 触发时，`groupid` 已经唯一确定，**不需要在探测层里处理"多公司选择"**——本次抖音探测的 `DiscoveryOutcome` 只会产生 `single`/`none`，不会产生 `multiple`（`multiple` 分支目前仍是携程独有的，探测执行阶段发现同一账号下有多个门店时才会触发）。

**探测执行是两步接口调用，不做 Prefetch/DOM 兼底**：URL 判定命中时落地页是 `/p/home?groupid=xxx`，但 `groupid`（= account_id/group_id，账号层 ID）和门店信息接口 `dsl/get` 需要的 `root_life_account_id`（根生活号 ID）是两套不相等、无法互相换算的 ID（同账号实测数据：`group_id="1813179858562059"` vs `root_life_account_id="7324560848234481702"`，位数、数值都不同，参见 `docs/抖音/踩点/session踩点.md`），必须先请求 `getAccountDetail` 拿到 `root_life_account_id`：

```
loadURL('https://life.douyin.com/p/home')
        ↓
从落地 URL 解析 groupid（缺失 → none，不发起任何接口请求）
        ↓
第 1 步：按路径模板顺序请求 getAccountDetail(groupid)
  逐个模板尝试，第一个解析出 root_life_account_id 的即用
  全部模板都未命中 → none
        ↓
第 2 步：用 root_life_account_id 请求 dsl/get
  正则提取 poiId/poiName
  未解析出 → none
        ↓
single（otaHotelId=poiId, displayName=poiName）
```

两步都在页面上下文内用同步 XHR 发起（`executeJavaScript` 里跑，带 `withCredentials`），不依赖 Node 环境发请求，和携程 `executeJavaScript` 里跑 DOM 查询是同一机制。**不做** RPA 脚本里 `getAccountDetail` 之外的 Prefetch（sessionStorage/localStorage 缓存读取）、DOM scrape 兜底——RPA 脚本要兼容"选公司刚跳转、页面还没渲染完"这类过渡态，本次探测场景是"标签页已经在 `/p/home` 落地并触发了 URL 判定"，页面已经稳定，不需要那层兼底；如果真机验证发现 `getAccountDetail` 的接口路径模板本身会变（页面改版），属于 §Risks 里"渠道接口未踩点"同类风险，届时再补兼底，不在本次预先实现。

**理由**：接口调用比携程的 DOM 选择器更贴近"数据的权威来源"（不依赖页面渲染出的具体 DOM 结构，只要接口契约不变就稳定），但代价是多了一次"先解出中间 ID 再查数据"的网络往返，且两个接口都未做真机验证（`ACCOUNT_DETAIL_URL_TEMPLATES` 里 5 个路径模板哪个在当前抖音后台仍然可用、`dsl/get` 的字段名是否仍是 `poiId`/`poiName`，都只是照抄 RPA 脚本的已知实现，未在这次会话里用真实账号验证过）。

## Risks / Trade-offs

- **[风险] 携程门店信息靠 DOM 解析（`a.he-ctrip-hotel-title-link`），接口未踩点** → 页面改版会导致选择器失效；本次明确接受，后续接口踩点成功可直接替换 `CtripDiscoveryProbe` 内部实现，不影响 `DiscoveryProbe` 接口和调用方。**真机验证已实测到的具体表现（2026-08-04）**：同一账号不同次登录，携程有时会先经过移动端布局再跳回桌面版，移动布局下 `a.he-ctrip-hotel-title-link` 不存在，导致该次探测返回 `none`（实测耗时约 52 秒才触发 15 秒轮询超时兜底）；重试一次（同一账号重新走登录标签页）后命中桌面布局，选择器正常解析出门店并成功建号。当前无重试机制——`none` 结果会保留 `bound` 状态为未绑定，允许用户下次重新触发登录标签页时自然重试，但单次探测内部不会自动重试或等待布局切换，这是本次明确接受的简化
- **[风险] URL 触发依赖每个渠道的登录页 URL 特征保持稳定** → 渠道改版登录页路径会导致 `LoginUrlMatcher` 失效，需要人工更新判据；未注册 matcher 的渠道目前没有兜底触发时机（已不再保留"标签页关闭"），本次明确接受
- **[风险] 查重命中后旧 partition 直接删除，没有用户确认或回退手段** → 见决策 7，本次明确接受；用户若误操作会静默丢失旧登录态，只能重新登录找回
- **[风险] Partition 名字里的短id 不携带业务语义，纯粹靠 `OtaAccount.partitionName` 做关联；如果这条数据库记录丢失，找回对应 cookie 需要遍历磁盘上的 partition 目录** → 可接受，因为 `OtaAccount` 本身就是这份登录态唯一的"账本"，与"cookie 是易变数据、数据库不重复存储"的决策一致
- **[风险] 携程/美团探测本次占位不实现** → 明确的范围排除，不是遗漏
- **[风险] 抖音 `getAccountDetail`/`dsl/get` 两个接口均未做真机验证** → 完全照抄 `rms-rpa-worker` 已验证过的 RPA 脚本里的 URL 模板和字段名，但那套脚本运行在"选公司刚完成、Prefetch 尚未就绪"的更早时机，本次探测时机（URL 已落到 `/p/home?groupid=`）没有实测过这两个接口在这个时机点是否仍返回预期结构；且抖音探测目前是 1 轮无重试（决策 8.1 的 3 轮重试只套用在携程，见该决策"重试策略：不套用，先写 1 轮，等真机验证暴露问题再补"的会话内决定），后续用真实抖音账号验证前不应视为已验证可用
