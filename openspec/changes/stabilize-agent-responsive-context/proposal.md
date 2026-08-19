# Proposal: Stabilize Agent responsive layout and conversation continuity

## Why

Agent messages now share a bounded conversation lane, but terminal error banners and several nested
content types still bypass or can overflow that lane. General-conversation follow-ups containing
pronouns or omitted subjects can also reach routing without recent conversation context, making a
natural second question feel disconnected even though persisted history is available to the answer
model.

The production hotel review case must additionally preserve the distinction between a successful
empty DMS query and an actual MCP failure. Empty business data is a normal completed outcome; an MCP
transport or tool failure is not.

## Change

- Keep Agent status, error, clarification, Markdown and generated UI content inside the responsive
  conversation width and contain long unbroken content on narrow windows.
- Present terminal errors as concise, wrapping messages with retry controls that do not force the
  message wider than the conversation lane.
- Always provide bounded recent conversation context to routing instead of gating it with keyword
  detection, and explicitly instruct the general answer model to maintain conversational continuity.
- Preserve persisted successful and failed user/assistant text in model context without replaying
  hidden execution state.
- Keep successful empty hotel queries on the existing normal `no_data` completion path, while real
  MCP failures remain retryable technical failures.

## Success criteria

- Agent-visible errors and nested content adapt to the same responsive width as the chat transcript.
- Long error text, code, links, tables and clarification inputs do not expand the page horizontally.
- After asking what a hotel operations manager is, “他平时一般干些什么工作呢？” is routed and
  answered with the prior role as context.
- A successful empty DMS result completes with a hotel/date-aware no-data message and no failed Run.
- An MCP call marked failed is not mislabeled as empty business data.

## Non-goals

- Adding new MCP tools or enabling tools for general conversation.
- Replaying failed tool calls or hidden model state.
- Masking genuine DMS/MCP outages as normal no-data results.
