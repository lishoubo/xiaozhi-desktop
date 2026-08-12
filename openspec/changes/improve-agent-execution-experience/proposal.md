# Proposal: Improve Agent execution experience

## Why

Agent SSE events currently render only a transient tool list. The list disappears when a run
completes and cannot be recovered when a historical conversation is reopened. The conversation
surface and history rail also transition abruptly, while server logs expose too little run context
for diagnosing model, context and tool failures.

## What changes

- Project persisted run events into an SDK-neutral execution trace returned with a conversation.
- Keep the active and completed execution flow expandable beside the corresponding answer.
- Apply the desktop motion primitives to messages, streaming output and execution steps.
- Reduce and refine the history rail typography and selected state.
- Render ordinary assistant text as sanitized Markdown while preserving the generative-UI path.
- Add client/server structured lifecycle logs for run acceptance, context preparation, tool
  activity, completion, replay and failure without logging prompts, model output or credentials.

## Success criteria

- A completed execution flow remains clickable until the conversation is left and after it is
  reopened from history.
- New event/message surfaces animate smoothly and respect reduced-motion behavior.
- History entries are visually quieter and remain keyboard accessible.
- Assistant headings, lists, tables, links and code render structurally without executable markup.
- Client and server logs identify run, conversation, lifecycle phase, duration and safe failures.

## Non-goals

- Migrating the transport contract to AG-UI in this change.
- Adding model-generated planning events that the runtime does not currently emit.
- Changing model, MCP or conversation-compression behavior.
