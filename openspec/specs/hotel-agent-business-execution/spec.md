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

### Requirement: MCP-backed hotel reference resolution

Until a server-owned hotel directory is available, the server SHALL resolve hotel names from a
bounded, read-only MCP name-to-ID projection. Internal workflow inputs MAY use `hotel_id`, but any
clarification choice SHALL present a recognizable hotel name rather than a bare ID.

#### Scenario: Resolve or clarify an MCP hotel name
- **WHEN** the user supplies a hotel name for a hotel-data request
- **THEN** the server compares it with the bounded MCP hotel-name projection in application code
- **AND** proceeds automatically when one internal hotel ID matches
- **AND** presents named choices when more than one internal hotel ID matches
- **AND** does not offer unrelated bare IDs when no name matches

### Requirement: Registered read workflow boundary

Every business read SHALL execute through a server-registered workflow with an MCP capability,
allowed tools, normalized input, call budget, timeout and evidence requirements.

#### Scenario: Execute a generic read workflow
- **WHEN** a long-tail hotel-data question has normalized hotel/date/metric context
- **THEN** the workflow may perform bounded schema discovery and a read query
- **AND** cannot request an unfiltered data dump or a write

### Requirement: Program-controlled DMS database scope

The server SHALL resolve the DMS database before exposing downstream hotel-data tools. When a pinned
numeric ID is configured, it SHALL be the fallback query boundary and `searchDatabase` SHALL provide
an additional identity check when available. Without a pinned ID, discovery SHALL return one unique
exact numeric DatabaseId. The discovery tool SHALL not be exposed to the model.

#### Scenario: Validate the configured database
- **WHEN** the DMS tool catalog is initialized with schema name `rms_data`
- **THEN** the server attempts `searchDatabase` and validates an exact `rms_data` result when returned
- **AND** overwrites database IDs for table listing, SQL generation and SQL execution with that ID
- **AND** restricts table-detail GUIDs to the same schema

#### Scenario: Discovery is unavailable
- **WHEN** `searchDatabase` is unavailable, fails, or returns no exact schema match
- **AND** a pinned numeric database ID is configured
- **THEN** every downstream hotel-data intent continues with the pinned ID
- **AND** the server records a structured fallback warning

#### Scenario: Package the production server
- **WHEN** a production deployment bundle is validated
- **THEN** the private production environment includes the reviewed pinned DMS database ID
- **AND** packaging fails before upload when that ID is absent

#### Scenario: Database identity conflicts
- **WHEN** discovery returns exact-schema IDs that do not include the pinned ID
- **THEN** hotel-data tools fail closed before any business query is executed

#### Scenario: No pinned database is configured
- **WHEN** discovery is unavailable or does not return one unique exact numeric ID
- **AND** no pinned database ID is configured
- **THEN** hotel-data tools fail closed before any business query is executed

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

### Requirement: Deterministic dedicated collection

Registered dedicated read workflows SHALL call a compatible read-only MCP tool without a
model-driven collection loop. A generic workflow or incompatible third-party tool SHALL use the
constrained Agent collector rather than guessing a tool input.

#### Scenario: Dedicated tool is compatible
- **WHEN** the resolved dedicated intent has an allowed tool and a server-owned argument shape
  accepted by its runtime schema
- **THEN** the server calls that tool directly and captures its result as evidence
- **AND** performs no collection model call before or after the MCP request

#### Scenario: Dedicated tool is incompatible
- **WHEN** no server-owned argument shape satisfies the available tool schema
- **THEN** the server uses the bounded read-only Agent collector
- **AND** does not invoke the incompatible tool speculatively

### Requirement: Compatible MCP evidence representations

The evidence boundary SHALL accept structured MCP results, JSON text, known adapter formats and
bounded unstructured text without assuming a tool message contains a JavaScript object. The
envelope SHALL record the representation parse quality before evidence assessment.

#### Scenario: MCP returns structured content
- **WHEN** a tool result contains JSON-compatible `structuredContent`
- **THEN** the normalizer prefers it over display content and records structured parse quality

#### Scenario: MCP returns prose
- **WHEN** no structured, JSON or known adapter representation is available
- **THEN** the normalizer preserves bounded credential-redacted text as unstructured evidence
- **AND** scope and freshness requirements still determine whether answering is allowed

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

#### Scenario: Continue a multi-round clarification
- **WHEN** the employee submits one clarification and slot resolution asks for another
- **THEN** the submitted card immediately becomes non-interactive and its persisted user answer remains visible
- **AND** exactly one new card is rendered under the latest assistant clarification message

#### Scenario: Cancel a pending clarification
- **WHEN** the employee cancels an owned waiting execution
- **THEN** the execution and a user cancellation message plus assistant acknowledgement are persisted atomically
- **AND** reopening the conversation explains why the task stopped without restoring an interactive card

#### Scenario: Generated UI attempts to resume a task
- **WHEN** a model-generated UI spec contains presentation components
- **THEN** it cannot submit clarification or change business execution state

### Requirement: Server-owned operating shortcuts

The server SHALL expose only shortcuts backed by configured read-only capabilities and SHALL own
their prompts, intent mapping, fixed date windows and metric markers.

#### Scenario: Run a common operating shortcut
- **WHEN** an employee selects yesterday review, seven-day trend, month-to-date progress, channel
  comparison or operating overview
- **THEN** the server maps it to the registered hotel-data workflow without model routing
- **AND** still requires hotel resolution, constrained MCP evidence and evidence-gated answering

#### Scenario: Complete a channel comparison tool chain
- **WHEN** a resolved channel comparison needs table discovery and schema inspection
- **THEN** its bounded tool budget permits the minimum required schema reads, SQL generation and SQL execution
- **AND** generated SQL is never treated as evidence before the constrained query tool executes it

### Requirement: Checkpointed manual retry

A retryable business execution failure SHALL persist a bounded server-owned checkpoint. An owned
manual retry SHALL restore the same business execution through an explicit state transition and
create a distinct Run attempt linked to the failed Run.

#### Scenario: Retry evidence collection
- **WHEN** collection fails after slots were resolved and the employee chooses retry
- **THEN** the immutable resolved request is restored without asking for the same parameters again
- **AND** the new Run records the failed Run as its predecessor

#### Scenario: Retry grounded answering
- **WHEN** answer generation fails after evidence validation
- **THEN** the retry reuses the validated evidence and invokes only answer generation
- **AND** it does not call MCP data tools again

#### Scenario: Reject an obsolete retry
- **WHEN** the requested failed Run is not the latest attempt or has no safe checkpoint
- **THEN** the server rejects the retry without changing execution state
