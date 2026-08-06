## Context

见 `proposal.md`。当前两个本地域模型已经落地，但 `OtaCredential` 尚无渠道账号 ID；美团
实现位于 `main/account-discovery/meituan-discovery.ts`，其中已用临时代码验证
`globalStorage.bizAccountId → getDetail`，并通过 `poiInfos` 读取酒店。当前统一 probe registry
还同时注册美团、抖音和携程。

本轮只迁移美团。抖音和携程继续使用现有 discovery probe，不借本次改动统一重构。

## Goals / Non-Goals

**Goals:**

- 将美团账号身份和酒店事实分别写入现有两个模型。
- 让账号发现功能显式调用美团实现，美团代码集中在 `main/ota/meituan`。
- 处理美团返回的全部有效酒店，并复用同一 credential。
- 将临时全量响应日志替换为安全、结构化的诊断日志。

**Non-Goals:**

- 不迁移抖音、携程文件或改变其运行方式。
- 不新增 `ChannelAdapter`、全局渠道 capability interface 或新的领域模型。
- 不修改 renderer、server/RMS 接口或 credential 生命周期 UI。
- 不保证美团账号 ID 唯一对应一份本地 partition。

## Decisions

### 1. `OtaCredential` 增加可空 `channelAccountId`

领域模型增加 `channelAccountId: string | null`。SQLite 新 migration 为 `ota_credential`
增加 `channel_account_id TEXT`，并创建 `(channel, channel_account_id)` 普通索引。旧记录保持
为空；美团下一次成功发现时回填。

repository 增加按 `(channel, channelAccountId)` 查询和更新账号身份的方法。更新内容限制为
`channelAccountId`、`credentialExtra`、`lastRefreshedAt`，不允许顺带改变 partition 或渠道。

不用 `otaAccountId` 命名，因为它容易与现有本地 `OtaAccount.id` 混淆。暂不设唯一约束，
避免未经验证就禁止同一美团账号存在多份导入或登录 partition。

### 2. 美团实现集中在 `main/ota/meituan`

目标文件边界：

```text
main/ota/meituan/
├── account-identity.ts       # globalStorage 候选解析与 getDetail 账号白名单校验
├── poi-infos.ts              # poiInfos 请求与酒店结果校验
├── discover-meituan.ts       # 当前已登录标签页上的两类请求编排
└── login-url-matcher.ts      # 美团登录成功 URL 判断
```

`DiscoverAndCreate` 显式接收并调用美团发现函数；原 registry 只继续服务尚未迁移的抖音和
携程。该临时不对称是有意的渐进迁移，不用适配器把它重新抹平。

### 3. 美团发现返回 credential facts 与全部酒店

美团专属结果包含：

```ts
type MeituanDiscoveryResult =
  | { kind: 'none' }
  | {
      kind: 'found';
      credential: {
        channelAccountId: string;
        credentialExtra: JsonObject;
      };
      hotels: readonly DiscoveredOtaHotel[];
    };
```

`getDetail.bizAcctId` 必须存在且与请求候选账号一致；不一致或无法解析时整次失败，不用
`poiId` 回退。账号白名单为 `partnerId`、`login`、`accountType`、`status`、`maskPhone`；
字段缺失时保存 `null`，不保留完整 response。

功能模块先按 partition 查找或创建 credential，再写入账号身份，随后逐条 upsert 酒店，
最后仅清理一次 pending partition 并通知一次账号已绑定。已有数据只有在整套渠道结果通过
校验后才更新。

### 4. 直接使用当前美团标签页，纯解析可定向测试

同源 XHR 直接在触发发现的当前 `WebContents` 中执行。该标签页已经完成登录并位于
`https://me.meituan.com`，因此无需创建隐藏 view、重复加载页面或等待新页面初始化
`globalStorage`。执行前必须通过 `webContents.getURL()` 校验当前主 frame 的协议和 host。

接口响应先作为 `unknown` 进入 Zod schema；账号和酒店映射函数保持纯函数，以便无需
Electron mock 即可覆盖有效响应、无效账号 ID、多酒店和字段白名单。日志不输出原始响应、
cookie、登录名或手机号。

## Risks / Trade-offs

- [当前标签页刚完成跳转时 `globalStorage` 尚未写入] → 保留有界轮询；超时返回 `none`，
  不写部分数据。
- [账号详情成功但酒店接口失败] → 不更新 credential，保留已有本地数据，等待下次触发。
- [多酒店部分写入时 repository 抛错] → 错误向上保留上下文；SQLite 单次 repository 调用
  仍原子，但本轮不为整个发现引入新的 Unit of Work。
- [registry 与显式美团分支暂时并存] → 明确限制为迁移期结构；本轮不触碰其他渠道。

## Migration Plan

1. 先发布兼容 migration 和 domain/repository 字段；旧 credential 自动得到空值。
2. 同版本切换美团 discovery 入口并移除旧美团文件，防止双重触发。
3. 用户下一次美团登录或 cookie 导入时自动回填账号身份并刷新酒店。
4. 失败时可回滚应用代码；新增可空列与普通索引不影响旧版本读取其已有列。
