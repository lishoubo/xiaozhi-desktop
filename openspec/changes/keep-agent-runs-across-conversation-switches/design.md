# Design

## State boundary

The renderer will store a `ConversationViewState` per conversation instead of one global message,
execution and streaming draft state. Stream events are routed by `conversationId`, so background
events cannot mutate whichever conversation happens to be selected.

The currently selected conversation ID remains navigation state. A separate transient state covers
only a Run-start request that has not returned yet.

## Recovery snapshot

PostgreSQL remains authoritative. Conversation responses expose the newest active Run's persisted
draft projection:

- concatenated `text_delta` content;
- latest `ui_spec`;
- last persisted event ID.

Conversation summaries expose the active Run ID so the desktop can discover background work without
opening every historical conversation. When the desktop loads or reopens an active conversation, it
hydrates from the database snapshot and asks Electron main to resubscribe after that event ID.

## Subscription ownership

Electron main continues to own SSE subscriptions. A new internal IPC capability reconnects a known
owned Run from a supplied tracked event cursor. Reconnection replaces any existing local subscription
for that Run, preventing a gap between the database snapshot and live events while retaining server
replay semantics.

Renderer teardown removes only the renderer event listener. It does not call cancellation. Explicit
Stop remains the only renderer action that invokes `cancelRun`.

## Safety and lifecycle

- Delete and clear controls are disabled while their scope contains an active Run.
- Terminal events clear only the matching conversation's active draft.
- Transport errors are recorded against the matching conversation.
- Server and desktop logs identify conversation ID, Run ID and reconnect cursor at lifecycle points.
