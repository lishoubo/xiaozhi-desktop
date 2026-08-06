## Context

携程 `DiscoveryProbe` 已接收触发登录成功的 `webContents`，但当前实现忽略该参数，另建隐藏
`WebContentsView`、复用 partition Session 并加载固定管理页。酒店信息最终仍通过
`a.he-ctrip-hotel-title-link` DOM 元素解析；通用落库流程只给非美团 credential 写入空身份。

稳定模型允许一个 credential 关联多家酒店，因此酒店 ID 不是一般意义上的登录账号 ID。本次
只按用户确认的短期策略处理单酒店携程账号，并用来源字段标识该身份可以被未来真实账号接口
替换。

## Goals / Non-Goals

**Goals:**

- 消除携程酒店发现中的隐藏 View 和二次导航。
- 在渠道边界内完成当前页面校验、DOM 解析和临时 credential 身份映射。
- 保持其他 OTA 渠道以及多酒店暂不落库的既有行为。

**Non-Goals:**

- 不调用或捕获 `queryAccountInfoV2`。
- 不解决携程多酒店选择与落库。
- 不修改数据库 schema、renderer 或共享 API。
- 不把酒店 ID 宣称为携程真实登录账号 ID。

## Decisions

### 1. 携程只操作调用方传入的当前 WebContents

携程发现先读取 `webContents.getURL()`，仅接受 `https://ebooking.ctrip.com/*`，随后在同一
`webContents` 中执行现有 DOM 轮询表达式。不调用 `loadURL`，也不创建或关闭任何 View。

选择精确主机名而不是 `endsWith('ctrip.com')`，避免相似恶意域名和与本功能无关的携程消费端
页面。备选方案是在当前 View 中强制导航到 `/home/mainland`；它会改变用户当前页面并再次产生
导航触发，因此不采用。

### 2. 携程迁移为独立渠道模块

新增 `main/ota/ctrip/`，由该模块返回携程特有的发现结果：`none`、`multiple` 或包含临时
credential 身份与酒店列表的 `found`。`DiscoverAndCreate` 只负责选择渠道结果并持久化，
不解析携程 DOM 或解释携程字段。

这与现有美团模块边界一致，但不新增统一 ChannelAdapter；每个 OTA 模块保留自己的调用与解析
方式。旧 `account-discovery/ctrip-discovery.ts` 删除，通用 probe registry 只保留仍使用通用
`DiscoveryProbe` 的渠道。

### 3. 单酒店临时身份使用显式来源标记

单酒店结果映射为：

```ts
channelAccountId = otaHotelId
credentialExtra = {
  hotelId: otaHotelId,
  hotelName: otaHotelName,
  identitySource: 'hotel-dom'
}
```

`identitySource` 是替换真实账号身份时的识别依据。酒店名称仅作展示性快照，不参与唯一性判断。
现有 `channel_account_id` 只有普通索引而非唯一约束，因此该临时值不会引入数据库迁移。

多酒店结果不生成 credential 身份，也不进入落库路径，避免任意选择酒店 ID。备选方案是把排序后
的酒店 ID 组合成账号 ID；酒店授权变化会使组合值不稳定，因此不采用。

### 4. 复用带身份的持久化流程，不抽象渠道适配器

`DiscoverAndCreate` 为携程增加与美团并列的显式分支，并复用一个仅在编排类内部使用的“持久化
已确认 credential 身份和酒店列表”私有流程。该复用只去除创建/更新 credential 与 account 的
重复代码，不形成渠道调用抽象。

现有 partition 对应 credential 时更新身份和刷新时间；不存在时创建。单酒店 account 继续按
`(channel, otaHotelId)` 创建或更新。

## Risks / Trade-offs

- [当前页面尚未渲染目标 DOM 时发现失败] → 保留有限轮询并返回 `none`，允许后续登录导航重新触发。
- [当前登录落地页不包含酒店标题链接] → 不偷偷导航；通过真机日志确认后再增加携程页面内的显式流程。
- [酒店 ID 被临时当作账号 ID] → `identitySource='hotel-dom'` 明确标记，真实账号接口接通时覆盖。
- [多酒店账号仍无法落库] → 保持现状，避免在没有选择产品流程时错误绑定。

## Migration Plan

1. 先用单元测试锁定当前 View、受信任 URL、单酒店临时身份和多酒店不落库行为。
2. 替换携程模块装配与发现编排，删除旧隐藏 View 实现。
3. 运行受影响 desktop 模块验证并进行独立 verification。
4. 若真机发现失败，可回退代码到旧 probe；本次无数据库 schema 变化，无数据回滚步骤。
