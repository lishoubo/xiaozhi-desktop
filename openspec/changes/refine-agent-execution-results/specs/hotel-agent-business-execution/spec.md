## MODIFIED Requirements

### Requirement: Execution presentation is proportional to work performed

Every Run MAY remain represented by the persisted execution state machine, but the desktop SHALL hide
completed execution traces that contain no tool steps. Failed or cancelled traces remain visible.

#### Scenario: General capability question

- **WHEN** a user asks what the Agent can do and the Run completes without tools
- **THEN** the user sees the natural-language answer without an empty business execution plan

### Requirement: DMS database scope is discovered before querying

The server SHALL call `searchDatabase` using the configured exact schema name before exposing DMS data
tools, and SHALL bind downstream table and SQL calls to the one distinct discovered DatabaseId.

#### Scenario: Discovery returns duplicated representations

- **WHEN** one database is present in both MCP text and structured content
- **THEN** the server de-duplicates it by DatabaseId and accepts the unique exact match

#### Scenario: Discovery is unsafe

- **WHEN** the exact schema name maps to zero or multiple distinct IDs, or conflicts with the optional pinned ID
- **THEN** the provider fails closed before a business query runs
