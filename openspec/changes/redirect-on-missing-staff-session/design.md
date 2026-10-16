## Context

见 proposal.md。token provider 是所有主进程 RMS 业务请求的凭证出口；`StaffAuthService.currentSession()` 还会被后台上报读取。渲染进程只在启动恢复、显式登录、登出时更新当前页面，主进程发现会话缺失后没有主动通知它。

## Goals / Non-Goals

**Goals:** 对确实缺失或被确认失效的会话发一次窗口通知；界面退出工作区并显示登录页。通知不携带 token、身份或 URL。

**Non-Goals:** 不把网络故障视作登出；不改变 RMS 服务端认证协议；不尝试从内部网页回收 token；不自动调用远端 logout。

## Decisions

1. **在两个判定点发信号。** token provider 在读取不到凭证或确认 refresh 已过期并清除后通知；`StaffAuthService.currentSession()` 在服务端明确拒绝会话并清理后通知。这样酒店管理等普通业务调用无需逐个识别 Electron 包装后的错误。相比在 renderer 的每个请求失败处重新查询会话，这条路径不会增加网络请求，也不会把临时故障误认为会话丢失。
2. **进程到窗口只传无内容事件。** app scope 通过既有 `WindowCapabilities` 找当前窗口；窗口停止心跳、关闭内部页并通过新增 `staff-auth:session-ended` IPC 事件通知 renderer。窗口不存在时安全忽略，重新开窗时启动恢复会话仍能得到 `null`。
3. **渲染进程只清本地 UI 状态。** `App.svelte` 订阅事件后清除会话与内部页引用，并退出工作区。它不调用 `logout()`，因为凭证已缺失或被清除，远端请求没有意义。显式登出继续沿用原有入口。
4. **在确认失效后发通知。** refresh 过期分支先完成本地清理再通知；服务端拒绝分支也先清理。回调若抛错，只记录不改变原始认证错误，避免通知失败掩盖请求结果。

## Risks / Trade-offs

- **启动早于订阅** → 启动恢复会话本身会读取缺失状态并显示登录页。
- **并发调用重复通知** → renderer 清状态应幂等；主进程可对同一缺失状态去重，新的登录成功后重置。
- **旧网页仍持有短期有效 token** → 会话结束时关闭内部标签页，避免 UI 上继续展示已退出的页面。

## Migration Plan

无数据迁移。回滚代码即可恢复旧行为；本次不改本地凭证格式。
