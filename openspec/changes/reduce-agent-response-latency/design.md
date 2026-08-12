# Design: Reduce Agent response latency

## Decisions

`LangChainAgentRuntime` continues to load memories and Skills in parallel before execution. Memories are embedded in the guarded system prompt, so exposing a second `recall_long_term_memory` tool adds latency without adding data. The write-only `remember_long_term_memory` tool remains available.

The `ChatOpenAI` instance is created once per runtime adapter. It is configuration-only and receives per-Run messages, prompt and cancellation through the agent invocation, so it does not hold conversation state.

`McpToolProvider` loads each configured server catalog with `Promise.all`, transforms each server's tools independently, then flattens results in configuration order. The existing promise cache continues to deduplicate concurrent and later loads.

## Boundaries

This change does not batch persisted streaming events or weaken the persist-before-publish guarantee. Hotel-specific facts still require MCP grounding, and DMS calls remain constrained and read-only.
