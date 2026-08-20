# Design: In-process Agent model gateway

## Boundary

`HotelAgentGateway` remains the application-level orchestrator. A new provider-neutral,
LangChain-facing `AgentModelGateway` port supplies chat models for a named purpose. The
`LangChainModelGateway` adapter is created once in the server composition root and injected into
all model consumers.

The purpose names are `workflow`, `analysis`, `routing`, `conversation_summary` and
`conversation_title`. Each purpose maps to the existing fast/analysis tier and preserves its
current maximum output tokens, retry count, timeout and streaming setting. A summary request may
lower its output-token ceiling according to the context policy, but cannot alter tier or transport
configuration.

## Observability

Each model instance receives a LangChain callback that records:

- lifecycle event, LangChain run ID and optional parent run ID;
- purpose, configured tier and model name;
- duration on completion or failure;
- sanitized error type on failure.

The callback never records prompts, messages, tool arguments, model output, credentials or hotel
business results. Logs use the existing injected server logger and require no external backend.

## Error and budget policy

The gateway owns provider-level timeout, retry and maximum-token settings. Existing application
boundaries continue converting SDK failures to typed Agent errors because they have the operation
and workflow state needed to distinguish model failures from an outstanding MCP call. There is no
cross-model fallback because that could change semantics, latency and cost or duplicate work.

## Compatibility

The gateway is an in-process module rather than a network service. Public tRPC contracts,
persistence, cancellation, workflow state, prompts and generative UI are unchanged. The current
LangChain `createAgent` path (backed by LangGraph) receives the same model behavior through the new
port.
