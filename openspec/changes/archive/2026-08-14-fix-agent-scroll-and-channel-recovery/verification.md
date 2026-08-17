# Verification

## 结论

通过。历史会话与持续聊天的贴底行为、用户向上阅读保护、失败后释放快捷操作，以及渠道对比第 5 次 SQL 执行预算均已有实现和回归证据。

## 根因证据

- 用户日志中的工具链为 `list → describe → describe → generate`，旧的 `generic_hotel_data_query.maxToolCalls = 4` 在下一次 `query_hotel_operating_data_sql` 启动前抛出协议错误。
- 对真实 DMS 执行只读名称解析，`银际酒店（包头青山文化路王府井店）` 精确匹配酒店 `4`；名称不是本次失败原因。
- 服务端 `completeRun(..., 'failed')` 已原子收敛业务执行；Desktop 的 `run_failed` 投影未清除旧 `activeBusinessExecution`，造成后续快捷操作的错误等待提示。

## 定向验证

- Desktop Agent 状态与滚动单元测试：2 files / 5 tests passed。
- Server 快捷意图与工具预算单元测试：1 file / 7 tests passed。
- Desktop 滚动 E2E（经 `npm run test:e2e` 重新构建）：1 passed。
- `svelte-check`：0 errors / 0 warnings。
- Svelte autofixer：0 issues；仅提示 DOM 同步副作用与 `bind:this` 可考虑 attachment，当前副作用不写响应式业务状态，保留窄作用域实现。

## 完成门禁

执行 `TRUST_STORES=nss npm run verify`：

- Desktop unit：86 files / 503 tests passed。
- Server unit：35 files / 151 tests passed。
- Shared API unit：2 files / 24 tests passed。
- Desktop E2E：9 passed。
- Server E2E：8 passed。
- TypeScript、Svelte checks 与 ESLint 全部通过。

## Code review

- 确认没有放松 SQL 只读限制、证据校验或同会话单执行约束。
- 工具预算只对需要模型探索 schema 的通用酒店数据意图从 4 调整为 5。
- `run_completed` 不会误清等待补充状态；只有 `run_failed` 与 `run_cancelled` 清理前端活动执行投影。
- 自动滚动仅在接近底部或用户主动开始新交互时生效，历史阅读不会被新内容打断。
