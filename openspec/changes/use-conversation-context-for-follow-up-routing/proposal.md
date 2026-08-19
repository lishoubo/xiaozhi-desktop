# Proposal: Use conversation context for follow-up routing

## Why

Persisted conversation history is supplied to the answer model, but the business intent classifier
currently sees only the newest user message. After a previous Run fails—even during intent routing—a
natural-language follow-up such as “继续查询” loses the earlier hotel, date and metric context and
feels disconnected despite the original user message still being stored.

## Change

- Detect referential continuation prompts such as “继续查询”, “按刚才的条件” and “那昨天呢”.
- Give the route classifier a bounded, text-only view of employee memory plus the prepared
  conversation summary and recent persisted messages for referential prompts.
- Allow the classifier to recover intent and slot candidates from the relevant prior user request,
  while treating current explicit values as overrides.
- Keep the follow-up as a new Run; do not restore failed/cancelled hidden model or tool state.

## Success criteria

- A natural-language continuation after a failed Run can recover the previous hotel business intent,
  hotel, period and metrics from persisted conversation messages.
- A failure during the previous classifier call does not erase the triggering user message.
- Unrelated complete prompts do not inherit stale routing context.
- Context is bounded, excludes generated UI/tool payloads and is labeled as untrusted data.
- Stable employee memory can inform omitted preferences/defaults but cannot bypass hotel authorization.

## Non-goals

- Replaying an unknown failed tool operation.
- Automatically treating every new message as a continuation.
- Replacing the explicit retry command or its checkpoint semantics.
