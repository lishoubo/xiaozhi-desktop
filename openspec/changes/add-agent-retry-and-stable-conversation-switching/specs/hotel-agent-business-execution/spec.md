# Delta: Hotel Agent business execution

## ADDED Requirements

### Requirement: Recoverable retry checkpoints

A retryable business execution failure SHALL persist a bounded server-owned checkpoint and SHALL
restore the same execution through a new Run attempt without replaying completed work.

#### Scenario: Retry collection failure
- **WHEN** an MCP or collection model fails after slots are resolved
- **THEN** retry restores the immutable request at `executing`
- **AND** does not rerun routing or ask again for resolved slots

#### Scenario: Retry answer failure
- **WHEN** answer generation fails after evidence was validated
- **THEN** retry restores grounded `answering` with the validated evidence
- **AND** does not call a data MCP again

#### Scenario: Reject unsafe retry
- **WHEN** a failure is non-retryable, unowned, stale or has no valid checkpoint
- **THEN** the server refuses the retry without modifying the execution or creating a Run

### Requirement: Retry attempt lineage

Each employee-requested retry SHALL create a distinct idempotent Run linked to the failed Run while
retaining one business execution and all prior attempt history.

#### Scenario: Retry is submitted twice
- **WHEN** the same retry request is delivered more than once
- **THEN** at most one new Run is created for its employee-scoped client request ID
- **AND** the original failed Run remains failed and auditable
