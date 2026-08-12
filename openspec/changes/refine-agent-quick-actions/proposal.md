# Proposal: Refine Agent quick actions

## Why

The Agent currently exposes three weather shortcuts, which makes the testing surface repetitive and does not demonstrate the hotel's core operating-data MCP capability.

## Change

- Keep one representative weather shortcut.
- Add one hotel operating-data shortcut, available only when the `hotel_data` MCP capability is configured.
- Keep shortcut prompts server-owned so clicking the entry cannot bypass MCP availability checks.

## Success criteria

- The catalog contains only one weather shortcut.
- A configured DMS hotel-data MCP adds a clearly labeled operating-data shortcut.
- Clicking the new shortcut starts a Run whose prompt requires the hotel-data MCP and asks for missing hotel/date context.
