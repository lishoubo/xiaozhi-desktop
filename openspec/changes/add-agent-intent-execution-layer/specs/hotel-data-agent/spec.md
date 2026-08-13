## ADDED Requirements

### Requirement: Execution-scoped hotel data tools

Hotel-data MCP tools SHALL be selected by the current registered read workflow rather than exposed as
an unrestricted global business tool catalog.

#### Scenario: Start an operating-data workflow
- **WHEN** slot resolution produces a complete operating-data request
- **THEN** only the workflow's approved hotel-data read tools are available
- **AND** existing SQL, row, size and timeout restrictions remain in force

#### Scenario: Attempt to escape the workflow
- **WHEN** model or tool output requests another tool, wider scope or a write operation
- **THEN** the provider rejects the attempt before it reaches DMS

### Requirement: Normalized hotel data evidence

Hotel-data results SHALL be converted into credential-redacted, bounded evidence with query scope,
source, filtering state and available observation metadata before answer generation.

#### Scenario: Result matches requested scope
- **WHEN** DMS returns data for the requested hotel, period and metrics
- **THEN** the evidence is eligible for workflow-specific sufficiency validation

#### Scenario: Result scope cannot be verified
- **WHEN** the result lacks enough hotel, period or metric metadata to verify the request
- **THEN** it is marked incomplete or rejected rather than treated as sufficient by default

#### Scenario: Result was compacted
- **WHEN** the provider omits rows, hides credential fields or truncates values
- **THEN** the evidence records that filtering and the final answer discloses any material limitation

### Requirement: Honest shared hotel scope

Until a trusted hotel directory and per-hotel authorization source are introduced, hotel candidate
discovery and data queries SHALL retain the shared access scope granted by the configured DMS token.

#### Scenario: Resolve a hotel candidate through DMS
- **WHEN** the execution uses DMS to find hotel-name candidates
- **THEN** it labels the candidates as shared-token results
- **AND** does not represent them as employee-specific hotel authorization
