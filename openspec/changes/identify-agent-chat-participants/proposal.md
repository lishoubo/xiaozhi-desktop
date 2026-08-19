# Proposal: Identify Agent chat participants

## Why

Conversation rows do not consistently identify who is speaking: assistant rows show only an icon,
user rows have neither a name nor avatar, and execution plans appear below completed answer content.
This makes longer conversations harder to scan and visually detaches the plan from the reasoning
process that produced the answer.

## Change

- Label assistant messages as `小智酒店AI` and keep the existing project Agent icon.
- Label user messages with the current authenticated display name and show a default user avatar when
  no avatar is available.
- Place each assistant execution plan above its answer text and generated UI, both while running and
  after completion.
- Keep failed/cancelled plans visible in an assistant-owned row when no assistant answer exists.

## Success criteria

- Every displayed user and assistant message has a visible name and avatar.
- Both authentication variants resolve the same user display-name source.
- The execution plan precedes answer text/UI and stays attached to the corresponding Agent row.
- Existing execution visibility rules for meaningful/failed/cancelled traces remain unchanged.

## Non-goals

- Adding profile-avatar upload or changing authentication contracts.
- Changing execution trace contents or server events.
