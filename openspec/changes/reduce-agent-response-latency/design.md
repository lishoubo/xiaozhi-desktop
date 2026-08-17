# Design: Reduce Agent response latency

## Decisions

`LangChainAgentRuntime` continues to load memories and Skills in parallel before execution. Memories are embedded in the guarded system prompt, so exposing a second `recall_long_term_memory` tool adds latency without adding data. The write-only `remember_long_term_memory` tool remains available.

The `ChatOpenAI` instance is created once per runtime adapter. It is configuration-only and receives per-Run messages, prompt and cancellation through the agent invocation, so it does not hold conversation state.

`McpToolProvider` loads each configured server catalog with `Promise.all`, transforms each server's tools independently, then flattens results in configuration order. The existing promise cache continues to deduplicate concurrent and later loads.

Generated UI is bounded to one successful `render_hotel_ui` call per Run. If the model attempts another render after a valid spec was emitted, the runtime stops the redundant loop and completes with the first UI plus the text already streamed. Duplicate attempts are not projected as additional execution steps.

## Boundaries

This change does not batch persisted streaming events or weaken the persist-before-publish guarantee. Hotel-specific facts still require MCP grounding, and DMS calls remain constrained and read-only.
