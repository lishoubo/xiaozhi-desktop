## Purpose

Define how the Hotel Agent converts natural-language requests into safe, recoverable business reads
with deterministic clarification, bounded workflows and evidence-grounded answers.

## ADDED Requirements

### Requirement: Layered request routing

The system SHALL route server-owned quick actions deterministically and SHALL treat a model-produced
free-text route as an untrusted proposal validated against server-owned categories and intents.

#### Scenario: Route a registered quick action
- **WHEN** an employee starts an available quick action
- **THEN** the server selects its registered intent without asking the model to invent a workflow

#### Scenario: Route a general knowledge question
- **WHEN** the request asks for hospitality knowledge without current hotel facts or a business effect
- **THEN** the system may answer without an MCP business-data call
- **AND** does not claim that any live hotel data or operation was used

#### Scenario: Route an unknown safe read
- **WHEN** a request requires hotel data, is read-only and matches no dedicated intent
- **THEN** the system routes it to the constrained generic hotel-data workflow
- **AND** does not reject it merely because the wording or metric was not anticipated

#### Scenario: Routing remains unclear
- **WHEN** structured routing cannot distinguish a safe read, knowledge request or requested effect
- **THEN** the system asks one focused clarification before exposing a business tool

### Requirement: Complete write denial

The Hotel Agent SHALL reject requested business writes and SHALL NOT load or call a write-capable MCP
tool in this phase.

#### Scenario: User requests a write
- **WHEN** the user asks to create, change, publish, cancel, refund, pay or otherwise mutate business data
- **THEN** the execution returns an unsupported-write explanation before MCP execution
- **AND** may offer a read-only current-state query or recommendation

#### Scenario: Configuration enables write tools
- **WHEN** an operator setting or MCP catalog advertises write-capable tools
- **THEN** the Hotel Agent execution layer still excludes those tools

### Requirement: Typed slot resolution

Each registered intent SHALL declare required slots and the server SHALL resolve extracted text into
missing, candidate, blocked, ambiguous, invalid or resolved slot states before workflow execution.

#### Scenario: Required context is complete
- **WHEN** every required slot has one valid resolved value
- **THEN** the server constructs an immutable resolved business request
- **AND** the workflow receives identifiers and normalized values rather than unvalidated user text

#### Scenario: A hotel reference has several candidates
- **WHEN** the available read-only hotel resolver returns multiple acceptable matches
- **THEN** the hotel slot becomes ambiguous and no business-data workflow starts

#### Scenario: Relative dates are resolved
- **WHEN** the user supplies a supported relative date expression
- **THEN** the server records the absolute date range, timezone source and original expression
- **AND** exposes the normalized date scope to the user

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
- **WHEN** a conversation containing an unexpired waiting execution is reopened after a server or renderer restart
- **THEN** the same pending clarification is reconstructed from PostgreSQL

#### Scenario: Submit a stale clarification
- **WHEN** an answer uses an expired, superseded or stale interaction version
- **THEN** the server does not change execution state or start an MCP call

### Requirement: Registered read workflow boundary

Every business read SHALL execute through a server-registered workflow with an MCP capability,
allowed tools, normalized input, call budget, timeout and evidence requirements.

#### Scenario: Execute a dedicated workflow
- **WHEN** a registered intent has complete slots and its MCP capability is available
- **THEN** the server exposes only that workflow's allowed read tools and bounded query scope

#### Scenario: Execute a generic read workflow
- **WHEN** a long-tail hotel-data question has normalized hotel/date/metric context
- **THEN** the workflow may perform bounded schema discovery and a read query
- **AND** cannot request an unfiltered data dump or a write

#### Scenario: Capability is unavailable
- **WHEN** the selected workflow's required MCP capability is not configured or cannot initialize
- **THEN** the execution ends with a friendly unavailable-data response and no fabricated result

### Requirement: Evidence-gated answering

The system SHALL normalize business tool results into bounded evidence envelopes and SHALL assess
scope, period, required metric coverage, filtering and available freshness metadata before answering.

#### Scenario: Evidence is sufficient
- **WHEN** the evidence matches the resolved request and satisfies workflow requirements
- **THEN** answer generation receives the validated evidence and material limitations
- **AND** the answer identifies data scope and source

#### Scenario: Evidence needs one bounded follow-up
- **WHEN** a missing requirement can be resolved by the workflow's allowed follow-up query
- **THEN** the system performs at most one follow-up and validates the combined evidence again

#### Scenario: Evidence remains inconclusive
- **WHEN** data is empty, mismatched, stale for the workflow or still incomplete after the follow-up
- **THEN** the system states what cannot be concluded and why
- **AND** does not convert correlation or incomplete data into a causal claim

#### Scenario: Evidence is rejected
- **WHEN** evidence violates scope, safety or credential-isolation rules
- **THEN** it is not passed to answer or generated-UI production

### Requirement: Persistent and isolated business execution

Business execution state SHALL be stored independently from individual Runs, scoped to the
authenticated employee and conversation, and updated with versioned compare-and-set transitions.

#### Scenario: Clarification spans several Runs
- **WHEN** an initial Run asks for clarification and a later Run consumes the answer
- **THEN** both Runs and their messages remain associated with one business execution

#### Scenario: Duplicate response races
- **WHEN** two clients submit the same interaction version
- **THEN** at most one transition succeeds and at most one resumed workflow starts

#### Scenario: Access another employee's execution
- **WHEN** an employee supplies an execution or interaction ID owned by another employee
- **THEN** the server returns no resource data and does not update that execution

#### Scenario: Start another task while clarification is pending
- **WHEN** a conversation already has a non-terminal business execution
- **THEN** the system requires that execution to complete or be explicitly cancelled before starting an unrelated task

### Requirement: Deterministic clarification presentation

The desktop SHALL render pending clarification from the shared structured contract using product-owned
components and SHALL keep it separate from model-generated result UI.

#### Scenario: Restore a clarification card
- **WHEN** conversation hydration contains a pending clarification anchored to a message
- **THEN** the desktop renders the corresponding fixed choice, date, range, number or text controls

#### Scenario: Resolve or cancel a clarification
- **WHEN** the interaction reaches a resolved, expired or cancelled state
- **THEN** its card becomes non-submittable and remains as readable conversation history

#### Scenario: Generated UI attempts to resume a task
- **WHEN** a model-generated UI spec contains presentation components
- **THEN** it cannot submit clarification or change business execution state
