## MODIFIED Requirements

### Requirement: Recoverable streaming

Agent progress SHALL be delivered through a tRPC v11 SSE subscription using tracked event IDs.
Persisted lifecycle events SHALL also be projected into an SDK-neutral execution trace returned
with the owning conversation.

#### Scenario: Reopen a completed conversation

- **WHEN** an employee reopens an owned historical conversation
- **THEN** completed run tool steps are reconstructed from persisted events
- **AND** the corresponding answer retains a toggleable execution-flow control

### Requirement: Observable Agent execution

The client and server SHALL emit structured logs for safe Agent lifecycle facts and SHALL NOT log
conversation content, model output, tool arguments/results, memories or credentials.

#### Scenario: Diagnose a failed run

- **WHEN** context preparation, model execution or a tool call fails
- **THEN** logs identify the run, conversation, lifecycle phase, error type and safe failure class
- **AND** no prompt or business-data payload is included

### Requirement: Accessible execution-flow presentation

The desktop SHALL render live and completed execution traces with an accessible expandable control,
smooth reduced-motion-aware transitions and compact history navigation.

#### Scenario: Inspect a completed run

- **WHEN** a run has completed and its answer is visible
- **THEN** the employee can collapse and reopen that run's execution flow
- **AND** the control exposes its expanded state to assistive technology

### Requirement: Safe Markdown presentation

The desktop SHALL render ordinary assistant text as Markdown after sanitizing executable and
interactive markup. User messages SHALL remain plain text and generative UI SHALL retain its
separate constrained renderer.

#### Scenario: Render a structured assistant answer

- **WHEN** an ordinary assistant answer contains headings, lists, tables, links or code
- **THEN** the desktop presents their Markdown structure within the conversation hierarchy

#### Scenario: Reject dangerous assistant markup

- **WHEN** assistant text contains scripts, event attributes, unsafe URLs or form controls
- **THEN** the desktop removes those constructs before inserting the rendered result into the DOM
