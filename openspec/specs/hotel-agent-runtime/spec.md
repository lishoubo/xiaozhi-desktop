# Hotel Agent runtime

## Purpose

Define the single-Agent execution, streaming, persistence and user-isolation contract shared by the desktop and server applications.

## Requirements

### Requirement: Authenticated single-Agent execution

The server SHALL run one Kimi-backed hotel Agent per run and SHALL NOT delegate to sub-Agents.

#### Scenario: Start a run

- **WHEN** an authenticated desktop employee starts an Agent run
- **THEN** the server persists the user message and run before model execution
- **AND** returns an idempotent run ID keyed by employee and client request ID

### Requirement: Session-derived ownership

Agent ownership SHALL be derived from the authenticated phone cookie or validated staff Bearer session and SHALL NOT be accepted from client input.

#### Scenario: Access another employee conversation

- **WHEN** an employee requests a conversation, run, event stream or memory not owned by that employee
- **THEN** the server returns no resource data
- **AND** persistence queries retain the authenticated employee owner predicate

### Requirement: Recoverable streaming

Agent progress SHALL be delivered through a tRPC v11 SSE subscription using tracked event IDs.

#### Scenario: Reconnect a run

- **WHEN** the SSE client reconnects with its last tracked event ID
- **THEN** the server replays later persisted events in order
- **AND** does not emit an event twice within that subscription

### Requirement: Persistent conversations and memory

Conversation messages SHALL survive process restarts, and employee-scoped long-term memory SHALL be available across that employee's conversations.

#### Scenario: Start another conversation

- **WHEN** the same employee creates a later conversation
- **THEN** the Agent may read that employee's stored long-term memories
- **AND** cannot read another employee's memories

### Requirement: Controlled extensibility

MCP tools SHALL load only from server-side configuration, and business Skills SHALL be supplied through a Skill provider that may be empty.

#### Scenario: No MCP or Skill is configured

- **WHEN** the Agent starts without configured MCP servers or Skills
- **THEN** normal Kimi conversation and local memory/UI tools remain available

#### Scenario: Load MCP tools

- **WHEN** MCP servers are configured
- **THEN** remote URLs use HTTPS except loopback development
- **AND** write-like tools remain disabled unless the operator explicitly enables them

### Requirement: Constrained generative UI

The model SHALL generate UI only through the server-side `render_hotel_ui` tool and the desktop SHALL render it with the established json-render registry.

#### Scenario: Validate generated UI

- **WHEN** the model submits a UI spec
- **THEN** the server validates component names, references, size and link protocols
- **AND** rejects arbitrary code or unregistered components
