# Proposal: Implement Agent run cancellation

## Why

The desktop stop control currently unsubscribes from SSE but leaves model and tool execution running
on the server. Users can type again, yet the stopped run may still persist a result, consume model
capacity and conflict with the status shown in the client.

## What changes

- Add an authenticated, idempotent server mutation that cancels an owned running Agent run.
- Propagate cancellation through the runtime `AbortSignal`, persist an explicit cancelled terminal
  state and publish a replayable cancellation event.
- Carry cancellation through the shared contract, desktop service, IPC and preload boundaries.
- Keep the composer locked while cancellation is being acknowledged, then allow a new prompt.
- Treat a later `继续` prompt as a new Run built from persisted conversation messages and summary.

## Success criteria

- Stop aborts active model/tool execution rather than only disconnecting event delivery.
- A cancelled run cannot later persist an assistant result or become completed.
- Cancellation is employee-scoped, idempotent and observable after reopening the conversation.
- After cancellation, any new input creates a distinct Run in the same conversation.

## Non-goals

- Restoring model hidden state, tool stack or an SDK checkpoint.
- Persisting partial streamed assistant text as a completed answer.
- Automatically interpreting words other than the user's normal prompt through a special resume API.
