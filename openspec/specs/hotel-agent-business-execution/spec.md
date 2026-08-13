# Hotel Agent business execution

## Purpose

Define how the Hotel Agent converts natural-language requests into safe, recoverable business reads
with deterministic clarification, bounded workflows and evidence-grounded answers.

## Requirements

### Requirement: Layered request routing

The system SHALL route server-owned quick actions deterministically and SHALL treat a model-produced
free-text route as an untrusted proposal validated against server-owned categories and intents.
Unknown safe hotel-data reads SHALL use the constrained generic workflow. Unclear requests SHALL be
clarified before exposing a business tool.

#### Scenario: Route an unknown safe read
- **WHEN** a request requires hotel data, is read-only and matches no dedicated intent
- **THEN** the system routes it to the constrained generic hotel-data workflow
- **AND** does not reject it merely because the wording or metric was not anticipated

### Requirement: Complete write denial

The Hotel Agent SHALL reject requested business writes and SHALL NOT load or call a write-capable MCP
tool in this phase.

#### Scenario: User requests a write
- **WHEN** the user asks to create, change, publish, cancel, refund, pay or mutate business data
- **THEN** the execution returns an unsupported-write explanation before MCP execution
- **AND** may offer a read-only current-state query or recommendation

### Requirement: Typed slot resolution

Each registered intent SHALL declare required slots and the server SHALL resolve extracted text into
missing, candidate, blocked, ambiguous, invalid or resolved slot states before workflow execution.

#### Scenario: Required context is complete
- **WHEN** every required slot has one valid resolved value
- **THEN** the server constructs an immutable resolved business request
- **AND** the workflow receives identifiers and normalized values rather than unvalidated user text

#### Scenario: Relative dates are resolved
- **WHEN** the user supplies a supported relative date expression
- **THEN** the server records the absolute date range, timezone source and original expression

### Requirement: Durable clarification

An execution that cannot safely resolve required slots SHALL persist a structured clarification and
SHALL resume only from a valid owned response to the current interaction version.

#### Scenario: Ask for missing or ambiguous slots
- **WHEN** required slots remain missing, invalid or ambiguous
- **THEN** the server persists `awaiting_clarification` with bounded fields and valid choices
- **AND** completes the current Run without keeping a model or MCP call open

#### Scenario: Resume from a structured answer
- **WHEN** the employee submits answers for the current owned interaction and expected version
- **THEN** the server merges only requested slots and returns to slot resolution
- **AND** rejects candidate values outside the offered choices

#### Scenario: Resume after process restart
- **WHEN** a conversation containing an unexpired waiting execution is reopened
- **THEN** the same pending clarification is reconstructed from PostgreSQL

### Requirement: Registered read workflow boundary

Every business read SHALL execute through a server-registered workflow with an MCP capability,
allowed tools, normalized input, call budget, timeout and evidence requirements.

#### Scenario: Execute a generic read workflow
- **WHEN** a long-tail hotel-data question has normalized hotel/date/metric context
- **THEN** the workflow may perform bounded schema discovery and a read query
- **AND** cannot request an unfiltered data dump or a write

### Requirement: Evidence-gated answering

The system SHALL normalize business tool results into bounded evidence envelopes and SHALL assess
scope, period, required metric coverage, filtering and available freshness metadata before answering.

#### Scenario: Evidence is sufficient
- **WHEN** evidence matches the resolved request and satisfies workflow requirements
- **THEN** answer generation receives only the validated evidence and material limitations
- **AND** has no access to MCP data tools in the answer phase

#### Scenario: Evidence remains inconclusive
- **WHEN** data is empty, mismatched or still incomplete after one bounded follow-up
- **THEN** the system states what cannot be concluded and why
- **AND** does not fabricate a business conclusion or generated result UI

### Requirement: Persistent and isolated business execution

Business execution state SHALL be stored independently from individual Runs, scoped to the
authenticated employee and conversation, and updated with versioned compare-and-set transitions.

#### Scenario: Clarification spans several Runs
- **WHEN** an initial Run asks for clarification and a later Run consumes the answer
- **THEN** both Runs and their messages remain associated with one business execution

#### Scenario: Start another task while clarification is pending
- **WHEN** a conversation already has a non-terminal business execution
- **THEN** the system requires that execution to complete or be explicitly cancelled first

#### Scenario: Recover after a server restart
- **WHEN** a Run was left active by process termination
- **THEN** it becomes a retryable failure on the next Agent request
- **AND** its unknown tool stack is not replayed

### Requirement: Deterministic clarification presentation

The desktop SHALL render pending clarification from the shared structured contract using
product-owned components separate from model-generated result UI.

#### Scenario: Restore a clarification card
- **WHEN** conversation hydration contains a pending clarification anchored to a message
- **THEN** the desktop renders fixed choice, date, range, number or text controls
- **AND** routes composer text to that interaction until it is resolved or cancelled

#### Scenario: Generated UI attempts to resume a task
- **WHEN** a model-generated UI spec contains presentation components
- **THEN** it cannot submit clarification or change business execution state
