## MODIFIED Requirements

### Requirement: Explicit conversation selection

The desktop SHALL start on a new-conversation state, allow the employee to continue owned historical
conversations, delete one owned conversation and clear all owned conversations after explicit
confirmation.

#### Scenario: Delete one historical conversation

- **WHEN** an employee confirms deletion of an owned conversation
- **THEN** the conversation, messages, runs and run events are deleted
- **AND** employee-scoped long-term memory remains unchanged

#### Scenario: Delete the active conversation

- **WHEN** an employee deletes the active completed conversation
- **THEN** the desktop returns to the new-conversation state
- **AND** deletion controls are disabled while a run is active

#### Scenario: Clear conversation history

- **WHEN** an employee confirms clearing all conversation history
- **THEN** every conversation owned by that employee and its dependent records are deleted
- **AND** no other employee's conversation or memory is affected

### Requirement: Session-derived ownership

Agent ownership SHALL be derived from the authenticated session and SHALL constrain deletion as well
as conversation, run, event and memory reads.

#### Scenario: Delete another employee's conversation

- **WHEN** an employee requests deletion of a conversation they do not own
- **THEN** the server returns no resource data and does not delete the conversation
