# Design: Refined Agent execution results

## General conversation presentation

Routing remains server-side and persisted for audit/retry consistency. The desktop derives whether a
trace is useful from durable trace data: a completed empty trace is hidden, while traces with tool steps
and failed/cancelled traces remain visible. This changes presentation only; it does not create a second
execution path.

## Generated UI commit boundary

`render_hotel_ui` validates and stages a candidate spec inside the runtime. It no longer publishes an
incremental `ui_spec` event. The UI becomes visible only through the final `run_completed.message.ui`,
which is written to the assistant message in the same completion path as its text. The desktop removes
the pre-render skeleton. If validation fails or the model completes without a valid staged spec, the
answer is text-only.

Table validation requires a non-empty scalar column list and rectangular rows containing only strings,
finite numbers, booleans or null. Nested objects and arrays are rejected, preventing renderer coercion
to `[object Object]`. Existing chart schemas remain unchanged.

## Deterministic operating review

At MCP initialization the provider calls `searchDatabase` with `AI_DMS_DATABASE_NAME`, parses both
text and structured MCP representations, and requires one distinct exact DatabaseId. An optional
`AI_DMS_DATABASE_ID` is a second assertion rather than the discovery mechanism. `searchDatabase` is
then removed from the Agent-visible catalog; list/generate/execute arguments are overwritten with the
resolved ID, and table-detail GUIDs must remain in the discovered schema. `askDatabase` is excluded
because its actual schema cannot be bound to a DatabaseId.

The `hotel_operating_summary` intent selects only the renamed DMS `executeScript` wrapper. Code builds
one parameter-constrained aggregate query against the reviewed `fact_business_daily` schema and the MCP
provider overwrites `database_id` with the discovered value. Natural-language `askDatabase` is not a
fallback for this shortcut. If the deterministic tool is unavailable or incompatible, collection fails
with a bounded retryable upstream error rather than handing the same request to the recursive Agent.

The SQL returns metrics actually present in the reviewed schema: GMV, booking/verified/refund amounts,
coupon counts, room nights and verified unit price. It does not claim occupancy, ADR or RevPAR because
the source table does not contain room inventory.

## Quick-action replacement

The shared quick-action identifier `today_weather` is replaced by `yesterday_operating_review`.
`quickActionIntent` maps it to `hotel_operating_summary`, while the slot resolver seeds `dateRange` with
`昨天` for this action. Hotel remains required and is resolved through the existing clarification flow.
The existing broader `hotel_operating_data` action remains available for user-selected periods.

This is a shared contract change across API, server and desktop. Existing persisted Runs containing the
old quick-action ID remain readable as history; they are not retryable through the new catalog.
