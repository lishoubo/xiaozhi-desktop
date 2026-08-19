# Proposal: Widen Agent generative UI

## Why

Generated tables and charts are currently constrained by both the conversation's 3xl content width
and the message bubble's 82% maximum width. The resulting visualization is too narrow to scan and
chart labels become crowded.

## Change

- Give the conversation stream a wider desktop content column.
- Allow assistant messages containing generated UI to use the full available stream width.
- Preserve a readable text width for ordinary Markdown and keep user messages compact.
- Retain horizontal table containment and responsive behavior in narrow windows.

## Success criteria

- Generated UI can use materially more horizontal space than a normal assistant text message.
- Ordinary text and user messages retain their current readable proportions.
- Tables remain contained and horizontally scrollable rather than overflowing the conversation.

## Non-goals

- Changing chart data, chart types or server-generated UI specifications.
- Making every chat message full width.
