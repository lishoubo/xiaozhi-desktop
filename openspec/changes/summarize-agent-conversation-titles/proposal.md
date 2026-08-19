# Proposal: summarize Agent conversation titles

## Why

The Agent sidebar currently copies the first user prompt into the conversation title. Long request-like text is hard to scan and does not behave like a compact topic label.

## Goal

Show a short local topic label immediately, then improve it with the configured lightweight Kimi model without placing that call on the main response's critical path.

## Success criteria

- A new conversation receives a concise topic label derived from its first prompt.
- Common request boilerplate and excess whitespace are removed.
- The fast Kimi title request runs in parallel with the main task and never blocks or fails the task.
- Existing explicitly named conversations keep their title.
- Empty or punctuation-only input falls back to `新对话`.
