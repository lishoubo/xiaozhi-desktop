## MODIFIED Requirements

### Requirement: Recoverable streaming

Persisted execution traces SHALL remain associated with the message that originated or completed
the Run, including after cancellation and later Runs in the same conversation.

#### Scenario: Continue after a cancelled Run

- **WHEN** a cancelled Run is followed by new user input and a new Run
- **THEN** the cancelled trace is shown next to its original user message
- **AND** the new execution and answer remain next to the new user message in chronological order

### Requirement: Constrained generative UI

Generated charts and tables SHALL remain readable within the conversation width and SHALL provide
immediate preparation feedback before a validated UI spec arrives.

#### Scenario: Render a date trend

- **WHEN** a generated trend contains more x-axis labels than fit without collision
- **THEN** the desktop displays a bounded, compact label set while retaining exact tooltip values

#### Scenario: Prepare generated UI

- **WHEN** the runtime starts `render_hotel_ui`
- **THEN** the desktop immediately indicates that the result view is being prepared
- **AND** only a server-validated spec is rendered as final generative UI
