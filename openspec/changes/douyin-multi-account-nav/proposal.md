# 渠道账号二级导航 + 抖音多账号复用 partition

## 背景

`cookie-login-account-discovery` 已经打通"导入 cookie → 去登录 → URL 判定 → 探测门店 → 建 `OtaAccount`"整条链路（携程、抖音均已真机验证）。但账号建成之后**没有任何入口能再打开它**——`BrowserManager.createWithAlreadyPartition`（流程B）已经实现，却从未被任何 IPC/UI 调用。

抖音场景下一份登录态（cookie/partition）可以管理多个门店账号，这与携程"一账号一 partition"的既有假设冲突，需要单独设计数据模型和交互取舍——`douyin-multi-account-nav/design.md` 已完成这部分设计评审。

## 目标

1. 浏览器工作区里加一个"账号列表"（二级导航），把已绑定的门店账号亮出来，点击即可用流程B打开对应标签页。
2. 支持抖音场景下同一份登录态（partition）自然挂多个门店账号：每次新增账号都走独立登录（`createAndNewPartition`），若两次登录落在同一份登录态上（如同一手机号/公司），`partitionName` 会相同。

## 成功标准

- 携程/抖音账号建成后，能在渠道图标下方的账号二级导航里看到对应门店，点击后正确打开/激活标签页。
- 抖音场景下，两次独立登录如果落在同一份登录态上，两条 `OtaAccount` 记录 `partitionName` 自然相同、`otaHotelId` 不同。
- 携程行为不受影响（`channelContext` 为 `null`，一个 partition 仍只对应一个账号）。

## 非目标

见 `design.md` §8「本期不做」：登录失效自动检测、账号列表搜索/筛选排序、删除/解绑账号、`multiple` 探测结果确认 UI、美团渠道特殊处理。
