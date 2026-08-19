# Design: Stabilize Agent responsive layout and conversation continuity

## Responsive message lane

`AgentPage` remains the owner of the transcript width. Every top-level conversation surface,
including the terminal error banner, uses the same `max-w-4xl` centered lane. Assistant content keeps
its avatar gutter; generated UI fills the remaining assistant content width. Retry actions may wrap
below long errors on small widths rather than widening the lane.

Nested components must be shrinkable with `min-width: 0` and contain unbroken values. Markdown tables
and preformatted content scroll inside their own block. Clarification controls use one column when
space is constrained and two columns only when the available width supports it.

## General follow-up context

Persisted messages remain the source of truth. Every prompt classification receives bounded,
text-only recent conversation turns, the rolling summary when present, and bounded employee memory.
No keyword or pronoun regular expression decides whether context is available: natural follow-ups
may omit explicit referential words, and a classifier is better placed to decide whether prior turns
are relevant. The current request remains a separate, authoritative input and takes precedence over
older context, which limits stale-topic pollution.

The answer model continues to receive the prepared summary, recent messages and employee memory.
Its system prompt explicitly states that recent user and assistant turns are untrusted conversation
data that should be used for conversational continuity, including pronouns and omitted subjects,
while the latest explicit request wins. General intent still loads no MCP capability and no
generative UI tool.

## Empty data versus upstream failure

Evidence validation is authoritative. A completed hotel SQL tool call whose normalized result is an
empty collection/table transitions to `no_data` and returns the existing business-facing hotel/date
message as a successful Run. A tool result marked as an error, timeout, unavailable service or
protocol failure remains `AgentUpstreamError` and a failed retryable Run. UI copy may be concise, but
the state distinction is not weakened.

Production logs for the reported case show `query_hotel_operating_data_sql` failing as
`tool_or_data_source / unavailable` in 43–52 ms, so that specific event is a genuine upstream failure,
not an empty result.
