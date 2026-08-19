# Design: Complete empty hotel-data Runs normally

## Empty-result boundary

No-data detection belongs in deterministic evidence assessment, after a tool call has completed
successfully and before answer generation. The classifier is restricted to the renamed read-only
hotel SQL tool. It accepts two unambiguous representations:

- an empty JSON/structured collection;
- a syntactically valid Markdown table containing a header and separator but no body rows.

The second form matches the observed DMS `executeScript` response for a successful query with zero
matching rows. Error protocol flags and rejected promises are handled before evidence normalization
and therefore cannot enter this branch.

## State transition

Evidence assessment gains a `no_data` result. The business state machine transitions directly from
`validating_evidence` to `answering` with a `no_data` mode, without consuming its bounded follow-up.
The gateway builds deterministic text and finalizes the Run through the existing success transaction,
so persistence, SSE ordering and conversation history remain unchanged.

## User message

The message refers to “这家酒店” unless a safe human-readable hotel reference remains in the
resolved request. It includes the requested date or date range when available and says that no
matching operating data was found. It may suggest trying another period or checking whether data has
been synchronized. It does not mention DMS, MCP, SQL or evidence validation.

## Safety

The no-data path emits no generated UI and invokes no model. Genuine upstream exceptions and
protocol-level error results retain their current retryable failure behavior.
