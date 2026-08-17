# Design

## Clarification ownership

补全卡属于一个 `pendingClarification`，但渲染锚点不能只使用共享的 `businessExecutionId`。前端仅当目标系统消息是该执行当前最后一条消息时才渲染卡片。提交回答后，客户端会立即插入服务端返回的用户消息，因此旧卡无需额外本地状态即可退出。

## Cancellation transcript

取消由 repository 在一个事务内完成：校验 owner、版本、状态和 interaction 后，将执行转为 `cancelled`，并追加一条用户消息与一条系统确认消息。接口返回这两条消息，desktop 随后加载权威快照。取消不是 Agent run，不创建伪 run 或执行时间线。

## Quick actions

新增快捷操作复用现有意图：

- 近 7 日经营趋势 → `hotel_operating_summary`，预置最近 7 个完整自然日。
- 本月经营进度 → `hotel_operating_summary`，预置本月至今。
- 渠道经营对比 → `generic_hotel_data_query`，预置最近 7 个完整自然日与渠道指标。

所有操作仍要求酒店参数，并继续经过参数解析、只读 MCP、证据校验和回答流程。
