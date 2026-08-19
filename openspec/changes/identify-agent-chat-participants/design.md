# Design: Identify Agent chat participants

`AgentPage` reads the existing reactive greeting identity, which is populated by `App.svelte` for
both phone and staff authentication. The display name uses full name when available and username as
the fallback. Current identity contracts expose no avatar URL, so a small default user-avatar
component renders the standard person icon and is ready to accept an image source later without
changing message layout.

Assistant rows render the existing `AgentAvatar` followed by a content column headed
`小智酒店AI`. User rows render the content column, right-aligned display name and default avatar.
Names are presentation metadata only and are not persisted into conversation text.

Within an assistant content column the order is: participant name, execution timeline, answer
Markdown, generated UI, clarification controls. The in-flight draft uses the same order. A terminal
trace without an assistant message remains in its own assistant-owned row, with the Agent avatar/name
above the trace. Moving the component does not change trace association or persistence.
