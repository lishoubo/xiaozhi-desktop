## MODIFIED Requirements

### Requirement: Authenticated single-Agent execution

The server SHALL run one Kimi-backed hotel Agent per run, SHALL NOT delegate to sub-Agents and SHALL
allow an authenticated employee to cancel an owned active run.

#### Scenario: Cancel an active run

- **WHEN** an employee stops an owned active run
- **THEN** the server aborts model and tool execution and persists `cancelled` as the terminal status
- **AND** the run cannot subsequently persist an assistant answer or become completed

#### Scenario: Cancel another employee's run

- **WHEN** an employee requests cancellation of a run they do not own
- **THEN** the server returns no resource data and does not affect that run

#### Scenario: Repeat cancellation

- **WHEN** cancellation is requested for an already terminal owned run
- **THEN** the server returns its existing terminal status without publishing a duplicate event

### Requirement: Recoverable streaming

Agent progress and cancellation SHALL be delivered through a tRPC v11 SSE subscription using tracked
event IDs. Persisted lifecycle events SHALL project to an SDK-neutral execution trace.

#### Scenario: Observe cancellation

- **WHEN** a run is cancelled
- **THEN** a replayable `run_cancelled` terminal event is persisted and delivered
- **AND** reopening the conversation presents the run as cancelled rather than failed

### Requirement: Server-owned conversation context

The server SHALL reconstruct every new model invocation from the selected conversation's persisted
messages and summary. It SHALL NOT rely on client history or an earlier Run's in-memory state.

#### Scenario: Continue after cancellation

- **WHEN** an employee submits new text such as `继续` after cancellation
- **THEN** the server creates a distinct Run under the same conversation
- **AND** prepares it from persisted conversation context without restoring the cancelled Run's hidden
  state, partial draft or tool stack
