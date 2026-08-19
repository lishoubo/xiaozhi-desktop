# Proposal: Improve Agent MCP diagnostics

## Background

Generic hotel-data requests currently allow six workflow tool calls. Schema discovery can consume
that entire budget before SQL generation and execution. In addition, model-driven MCP calls do not
forward their observability events to the gateway logger, and a broad stream-error wrapper labels
any business-workflow stream failure as an MCP outage.

## Goals

- Give generic hotel-data workflows enough tool-call budget to discover schemas and execute data
  queries in one run.
- Scale the execution-graph recursion limit with that tool budget so the graph can actually use it.
- Record structured lifecycle and failure diagnostics for every MCP call made during model-driven
  evidence collection.
- Attribute stream failures to MCP only when an MCP call was actually in flight, preserving the
  concrete tool operation in diagnostics.
- Keep user-facing errors concise and free of transport details or sensitive data.

## Non-goals

- Persisting raw SQL, MCP arguments, results, URLs, headers, or exception messages.
- Retrying DMS calls automatically or changing DMS query semantics.
- Changing desktop rendering or the public Agent API contract.

## Success criteria

- `generic_hotel_data_query` permits 15 workflow tool calls.
- Model-driven MCP calls emit structured start, completion, and failure logs with correlation IDs,
  tool name, duration, safe error classification, and retryability.
- A stream failure without an in-flight MCP call is not shown as a hotel-data service outage.
- An in-flight MCP failure is attributed to its concrete tool rather than `run_agent_stream`.
- Relevant unit tests and the server verification suite pass.
