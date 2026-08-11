# 设计

## 数据流

1. 已登录员工通过现有 Agent tRPC 接口提交自然语言问题。
2. `HotelAgentRuntime` 要求真实经营问题必须调用酒店数据工具。
3. `McpToolProvider` 连接固定 DMS MCP，仅装载自然语言查询、表列表、表结构和受限 SQL 四个工具。
4. 工具结果经行数、长度和凭证过滤后进入现有 Agent 事件流；模型可按需调用 `render_hotel_ui`。

## 查询边界

- DMS Token 仅由 server 环境变量 `AI_DMS_MCP_BEARER_TOKEN` 提供。
- 所有已登录员工共享该 Token 的查询权限；权限收敛留待后续业务规则明确。
- SQL 仅允许一条 `SELECT` 或 CTE，拒绝写操作、多语句、注释、文件访问、锁及高风险函数，并强制最多 50 行。
- 业务字段保持原值；只隐藏 Token、Authorization、密码等系统凭证。

## 失败与展示

- 自然语言查询不能生成 SQL 时，Agent 可读取表结构后改用受限 SQL。
- 查询失败返回面向运营人员的可重试提示，不暴露 SQL、服务地址或凭证。
- 过大结果截取为适合界面展示的部分并显式提示；表格最多 50 行、12 列。

