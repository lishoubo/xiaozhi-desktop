# Proposal: Add Agent conversation deletion

## Why

Employees can reopen historical Agent conversations but cannot remove obsolete conversations or
clear their own history. This leaves the history rail permanently cumulative and gives users no
control over stored conversation content.

## What changes

- Remove the unused `deepagents` server dependency.
- Add authenticated procedures for deleting one owned conversation and clearing all conversations
  owned by the current employee.
- Carry those operations through the shared contract, desktop service, IPC and preload boundaries.
- Add compact destructive controls and confirmation dialogs to the Agent history rail.
- Keep employee-scoped long-term memory independent from conversation deletion.

## Success criteria

- An employee can delete one historical conversation and it disappears immediately.
- An employee can clear all owned conversations after explicit confirmation.
- Deletion cannot affect another employee's conversations.
- Deleting the active, completed conversation returns the page to a new-conversation state; deletion
  controls remain disabled while a run is active.
- Long-term memory remains untouched.

## Non-goals

- Deleting or managing long-term memory.
- Recovering deleted conversations or adding a trash bin.
- Changing conversation compression or Agent execution behavior.
