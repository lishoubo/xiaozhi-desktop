# Design

## Contract and ownership

The shared Agent gateway gains `deleteConversation(principal, conversationId)` and
`clearConversations(principal)`. Both mutations return a validated deleted-count result. The server
repository includes the authenticated employee predicate in every delete; a single-conversation
delete returns the existing not-found behavior when the conversation is not owned.

Deleting an `agent_conversation` relies on existing PostgreSQL cascade foreign keys to delete its
messages, runs and run events. `agent_memory` has no conversation foreign key and is deliberately
not included. Clearing history issues one employee-scoped conversation delete, allowing the same
cascades to clean dependent records.

## Desktop boundary

The two mutations pass through tRPC client, `AgentService`, one-call IPC handlers and schema-validating
preload methods. Client logs record only operation type, conversation ID where applicable, count and
duration; conversation titles and content are omitted.

## Interaction

Each history row exposes a small delete control on hover/focus. A compact clear-history control is
shown beside the section label only when conversations exist. Both open an accessible alert dialog.
The dialog names the target and states that deletion cannot be undone.

After successful deletion, renderer state is updated without a redundant list reload. If the active,
completed conversation is deleted, the page resets to its default new-conversation state. Destructive
controls are disabled while a run is active so deletion cannot race persisted run state. Failure keeps
the dialog/context intact and displays a concise page error.

## Dependency cleanup

`deepagents` is removed because no source imports it and the current runtime is the SDK-neutral
`AgentRuntime` port backed by `LangChainAgentRuntime`.
