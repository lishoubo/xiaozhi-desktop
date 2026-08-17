# Hotel Agent runtime delta

## MODIFIED Requirements

### Requirement: Explicit conversation selection

The desktop SHALL let navigation and server execution have independent lifecycles. Selecting a new
or historical conversation SHALL NOT cancel Runs in other conversations; only an explicit Stop action
SHALL request Run cancellation.

#### Scenario: Switch away from an active conversation

- **WHEN** an employee selects another conversation while the current conversation has a running Run
- **THEN** the Run continues on the server and its events remain associated with its own conversation
- **AND** no cancellation request is sent

#### Scenario: Return to an active conversation

- **WHEN** an employee returns to a conversation whose Run is still active
- **THEN** the desktop restores persisted partial text, generative UI and execution progress
- **AND** reconnects from the last persisted event cursor to receive later output without a gap

#### Scenario: Leave the Agent page

- **WHEN** the Agent renderer unmounts while a Run is active
- **THEN** it removes only its local listener
- **AND** the server Run remains active until completion, failure or explicit cancellation

### Requirement: Recoverable streaming

Persisted Run events SHALL provide both a replay stream and an active-Run draft projection so a new
renderer instance can recover in-progress output.

#### Scenario: Recover an active Run after renderer recreation

- **WHEN** a conversation is loaded with an active Run
- **THEN** its response includes the partial text, latest UI specification and last persisted event ID
- **AND** Electron main replaces or starts the corresponding SSE subscription after that event ID
