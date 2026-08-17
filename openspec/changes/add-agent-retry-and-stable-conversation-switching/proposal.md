# Proposal: Add Agent retry and stable conversation switching

## Why

Retryable Run failures currently reach the desktop, but the employee must reconstruct and resubmit
the request. Replaying message text would lose resolved slots and validated evidence, and could
repeat successful MCP work. Conversation switching also selects an uncached conversation before its
snapshot arrives, briefly replacing the current content with an empty view. Finally, a grounded
weather answer can ask to render UI twice, extending the post-MCP model phase by more than a minute.

## What Changes

- Persist a bounded retry checkpoint when a business execution fails at a recoverable phase.
- Add an owned, idempotent retry operation that restores the same business execution, creates a new
  Run attempt and resumes the existing executor from the checkpoint.
- Preserve the existing conversation surface until an uncached target snapshot has loaded, while
  keeping selection intent and failure feedback explicit.
- Strengthen the answer-only runtime so one successful generated UI is the hard maximum and a
  duplicate render request terminates with the first valid UI rather than invoking the tool twice.
- Make the bundled DMS MCP endpoint server-configurable, update its default endpoint and remove a
  credential accidentally committed to the production example.
- Expose a retry action only for retryable failures; non-retryable validation and configuration
  failures remain explanatory only.
- Converge server startup on checked-in development and production Docker Compose stacks, with
  environment-specific root npm commands, local server image builds and public Docker Hub base
  images instead of a private image registry.

## Success Criteria

- Retrying an MCP failure reuses resolved input; retrying an answer failure reuses validated
  evidence and does not call MCP again.
- Duplicate retry submissions create at most one new Run and preserve the original failed Run.
- Switching to an uncached conversation does not blank or remount the current conversation surface.
- A grounded answer emits at most one `render_hotel_ui` tool lifecycle pair.
- Existing start, clarification, cancellation, deterministic collection and generic-Agent paths
  retain their behavior.
- Development and production Compose configuration can be validated and started through explicit
  root npm commands; production no longer requires an Alibaba Cloud image registry.

## Non-goals

- Resuming LangChain internal stacks, partial model streams or in-flight MCP connections.
- Automatically retrying without employee action.
- Adding a third-party state-machine library.
- Retrying non-business general conversation Runs in this iteration.
