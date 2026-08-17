# Keep Agent runs across conversation switches

## Why

The Agent page currently treats navigation as cancellation: selecting another conversation, starting a
new conversation, or leaving the page cancels the selected Run. That couples UI navigation to server
execution and makes background work disappear from the employee's perspective.

## Goal

- Conversation switching never cancels a Run.
- Every conversation keeps an independent renderer view state.
- Returning to a running conversation restores its persisted draft and continues receiving events.
- Only the explicit stop action cancels a Run.
- Running conversations are identifiable in the history list and cannot be deleted mid-run.

## Non-goals

- Pausing and resuming the model's internal execution stack.
- Resuming a cancelled Run; continuing after cancellation still creates a new Run.
- Supporting multiple simultaneous Runs inside one conversation.

## Success criteria

- A Run started in conversation A remains active after switching to conversation B.
- Events for A update A's state without being rendered under B.
- Switching back to A shows persisted partial text/UI and subsequent live output in the correct place.
- Page teardown does not cancel server execution.
- Explicit stop still cancels the selected conversation's active Run.
