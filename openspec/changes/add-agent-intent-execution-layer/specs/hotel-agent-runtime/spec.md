## ADDED Requirements

### Requirement: Business execution projection

Conversation responses SHALL expose business executions separately from per-Run execution traces and
SHALL associate their messages and Runs through nullable business execution identifiers.

#### Scenario: Load a conversation with completed business tasks
- **WHEN** an employee opens an owned conversation
- **THEN** messages remain in chronological order and completed business executions can be grouped with their triggering messages
- **AND** existing Run execution traces remain available independently

#### Scenario: Load a waiting business task
- **WHEN** the conversation has an owned execution waiting for clarification
- **THEN** the response contains one active business-execution projection and its pending interaction

#### Scenario: Load a legacy conversation
- **WHEN** stored messages and Runs predate business-execution support
- **THEN** they remain readable with null business execution associations

### Requirement: Replayable business interaction events

Business execution and clarification updates SHALL use the existing tracked tRPC SSE transport and
SHALL remain recoverable from persisted conversation state.

#### Scenario: Receive a live clarification
- **WHEN** a Run transitions its business execution to waiting for clarification
- **THEN** the server persists the update before notifying SSE subscribers
- **AND** the Run reaches a terminal status rather than holding the subscription open for human input

#### Scenario: Reconnect after an interaction event
- **WHEN** the client reconnects after its last event ID
- **THEN** later persisted events are replayed without duplicate delivery in that subscription
- **AND** a fresh conversation query remains authoritative for the current pending interaction

### Requirement: Owned clarification API

The shared Agent contract SHALL provide strict, owner-checked mutations for submitting or cancelling
the current business interaction without accepting owner fields from the client.

#### Scenario: Submit card answers
- **WHEN** the desktop submits an execution ID, interaction ID, expected version and schema-valid answers
- **THEN** the server derives ownership from the session and returns the resumed Run identity

#### Scenario: Submit malformed fields
- **WHEN** a client submits unknown answer fields, invalid field shapes or both structured and incompatible input modes
- **THEN** strict input validation rejects the request before state mutation

## MODIFIED Requirements

### Requirement: Controlled extensibility

MCP tools SHALL load only from server-side configuration, business Skills SHALL be supplied through a
Skill provider that may be empty, and the Hotel Agent SHALL expose only read-capable business tools
regardless of an operator write-tool setting.

#### Scenario: No MCP or Skill is configured
- **WHEN** the Agent starts without configured MCP servers or Skills
- **THEN** normal Kimi conversation and local memory/UI tools remain available

#### Scenario: Load MCP tools
- **WHEN** MCP servers are configured
- **THEN** remote URLs use HTTPS except loopback development
- **AND** write-like tools remain unavailable to the Hotel Agent even if configuration or a remote catalog advertises them
- **AND** independent server tool catalogs initialize concurrently and retain configuration order

#### Scenario: Query hotel operating data
- **WHEN** the Agent uses the configured DMS MCP
- **THEN** the provider exposes only the current workflow's approved read tools, constrains arguments before the call and compacts oversized results afterward

#### Scenario: Ground a hotel-specific business answer
- **WHEN** an answer depends on a specific hotel's current or historical operating facts
- **THEN** the Agent executes the registered read workflow and validates its evidence before answering
- **AND** general hospitality concepts may still be answered without an unnecessary lookup
- **AND** the read-only Agent never claims that a requested business write operation was executed
