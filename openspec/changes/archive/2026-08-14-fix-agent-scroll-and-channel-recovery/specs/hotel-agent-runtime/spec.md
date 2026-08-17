## ADDED Requirements

### Requirement: Agent conversation follows the latest visible content

The desktop SHALL position an opened conversation at its latest visible content and SHALL continue following newly rendered messages and execution updates while the employee remains near the bottom.

#### Scenario: Open historical conversation

- **WHEN** an employee opens a historical Agent conversation
- **THEN** the conversation viewport is positioned at the latest visible content after rendering

#### Scenario: Follow an active conversation

- **WHEN** new messages, streamed content, execution events, or clarification UI are rendered while the viewport is near the bottom
- **THEN** the viewport continues to show the latest content
- **AND** manually scrolling upward pauses forced following until the employee returns near the bottom

### Requirement: Failed runs release the conversation execution lock

Every terminal Run failure SHALL transition its associated non-terminal business execution to a failed terminal state.

#### Scenario: Protocol failure during a channel comparison

- **WHEN** a channel comparison Run fails after schema discovery or SQL generation
- **THEN** its business execution is persisted as failed
- **AND** a subsequent quick action is not rejected as an awaiting-clarification conflict

### Requirement: Channel comparison reaches verified DMS evidence

The channel comparison workflow SHALL reserve enough allowed tool calls to inspect required schema, generate read-only SQL, and execute that SQL.

#### Scenario: Compare a resolved hotel across channels

- **WHEN** the hotel and fixed seven-complete-day date range are resolved
- **THEN** the workflow may inspect the minimum necessary tables and schema
- **AND** SQL generation must be followed by SQL execution
- **AND** only executed query results are eligible for evidence validation and the final answer
