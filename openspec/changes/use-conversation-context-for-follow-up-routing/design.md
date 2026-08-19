# Design: Use conversation context for follow-up routing

## Context handoff

The gateway already prepares an incremental summary and recent persisted messages before routing. It
loads employee memory once per Run and shares that bounded set with model-driven phases. For a prompt
recognized as referential, a pure helper creates a bounded JSON context containing memory, the summary
and up to eight recent text messages, excluding the current trigger message. A self-contained prompt
receives memory but not unrelated conversation text. Content is capped per item and no UI, tool
arguments, tool results or execution internals are included.

The business router forwards this optional string to `RouteClassifier.classify`. The Kimi classifier
prompt labels it as untrusted conversation data and instructs the model to use it only to resolve
references in the current request and stable preferences/defaults in memory. Explicit current values
win over older values, and all hotel candidates still pass through authorization-aware resolution.

## Continuation detection

Code-owned detection covers concise Chinese continuation forms such as `继续`, `接着查`, `再试一次`,
`按刚才的条件`, `用之前的酒店` and `那昨天呢`. A self-contained new request receives no routing
context, reducing accidental inheritance and classifier token cost.

## Failure and cancellation boundary

User messages are persisted before model execution, including when routing itself later fails. A
subsequent continuation therefore has the original user text available. The new Run reclassifies and
resolves slots from persisted text; it never resumes hidden chain-of-thought, partial output, tool
stack or an in-flight external call. Cancellation semantics remain unchanged.
