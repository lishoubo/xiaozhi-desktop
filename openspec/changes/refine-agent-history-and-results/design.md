# Design

## History hierarchy

Keep the narrow rail and use the design-system caption size for conversation titles. The section
label remains micro-sized because it is navigation metadata. Replace the text `清空` control with a
small icon button and accessible label/title; deletion stays a secondary hover/focus action.

## Trend readability

Chart data remains unchanged. A shared presentation helper derives responsive tick density from
the number and display length of labels, compacts common Chinese/ISO date strings, and configures
LayerChart x-axis spacing. Tooltips retain the original labels, so axis compaction does not lose
precision. Generated tables receive horizontal overflow and non-wrapping headers/cells inside the
Agent result boundary.

## Perceived render latency

The server continues to validate and emit UI only through `render_hotel_ui`. When the normalized
`tool_started` event identifies that tool, the desktop displays a lightweight skeleton immediately.
The tool description and system guidance require prompt UI emission after data retrieval, avoiding
unnecessary narrative work before the view tool call. This improves feedback without creating an
unsafe client-side renderer or coupling the gateway to weather result formats.

## Execution ordering

The message list is the chronological source. A completed execution remains attached to its
assistant message. A failed or cancelled execution without an assistant message attaches to its
`userMessageId`. The separate end-of-list terminal execution block is removed. The active assistant
draft remains a transient row after persisted messages.
