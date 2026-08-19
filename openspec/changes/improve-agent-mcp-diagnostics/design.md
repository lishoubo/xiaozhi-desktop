# Design: Improve Agent MCP diagnostics

## Tool-call budget

Raise only `generic_hotel_data_query.maxToolCalls` from 6 to 15. Fixed operating-summary and other
intent budgets remain unchanged. Fifteen calls accommodate bounded schema discovery plus SQL
generation/execution while retaining a finite protocol guard.

LangGraph consumes graph steps separately from the tool-call budget. Derive the workflow recursion
limit as `max(10, maxToolCalls * 2 + 2)`, which gives the generic workflow 32 graph steps while
leaving smaller fixed workflows at 10. A `GraphRecursionError` remains an orchestration protocol
failure and must never be attributed to an in-flight MCP tool.

## MCP lifecycle logging

The runtime already emits internal `mcp_call_started`, `mcp_call_completed`, and
`mcp_call_failed` events. Deterministic collection forwards these events, but model-driven
collection currently drops them. Route those internal events through the gateway's existing
observability handler while continuing to suppress collection-phase text from the user stream.

Safe log fields are allow-listed:

- run, conversation, business execution, and tool-call correlation IDs;
- tool name and duration;
- result shape/fingerprint fields already produced by the MCP summarizer;
- error type, failure kind, retryability, and safe upstream classification.

Never log tool arguments, generated SQL, response content, exception messages, URLs, headers, or
credentials.

## Failure attribution

When `agent.stream()` throws, inspect the runtime's set of started but incomplete MCP calls:

- If at least one exists, wrap the failure as `AgentUpstreamError(service: 'mcp')` and set the
  operation to the concrete outstanding tool name.
- If none exists, classify the stream failure as a model/runtime upstream failure with operation
  `run_agent_stream`.
- Preserve existing typed Agent errors without reclassification.

User-facing mapping continues to describe a verified MCP failure as a hotel-data service problem,
but no longer uses that message for an unclassified workflow stream failure.

## Verification

- Unit-test the increased intent budget.
- Regression-test failure attribution with and without an outstanding MCP tool.
- Regression-test model-driven MCP failure logging and verify raw error text is absent.
- Run focused Agent tests during implementation, then the server completion suite once.
