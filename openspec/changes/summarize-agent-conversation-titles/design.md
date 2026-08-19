# Design: summarize Agent conversation titles

## Decision

Use a hybrid title flow:

1. A deterministic helper writes an immediate fallback at the existing first-run title assignment point.
2. The configured `AI_KIMI_FAST_MODEL` generates a semantic title in parallel with the main task.
3. A compare-and-set update replaces only the unchanged fallback title. Failure or cancellation leaves the fallback intact.

The title promise is deliberately not awaited by run completion, so title generation adds no serial model stage to the response path.

## Rules

- Normalize whitespace.
- Remove common Chinese request prefixes such as `请帮我` and `麻烦帮我`.
- Prefer the first meaningful clause.
- Bound the title to 24 visible characters and append an ellipsis only when truncated.
- Preserve any title other than the default `新对话`.

## Model and latency

- Only the fast Kimi tier is allowed; the default is Kimi K2.6 with thinking disabled.
- The request is limited to the first 2,000 prompt characters and 40 output tokens.
- The desktop refreshes the sidebar at completion and once shortly afterward to pick up a parallel title update.
- The extra title inference has a small token cost, but does not extend the main AI call chain.
