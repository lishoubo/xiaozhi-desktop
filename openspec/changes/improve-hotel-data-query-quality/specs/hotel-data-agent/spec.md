# Hotel data Agent delta

## ADDED Requirements

### Requirement: Semantic hotel-data planning

The server SHALL maintain a machine-readable semantic catalog for supported RMS hotel-data objects
and SHALL use it to plan domains, grains, time fields, units, aggregate filters, joins, freshness and
sensitive-field handling without requiring live schema discovery on every request.

#### Scenario: Answer a cross-domain question

- **WHEN** a user asks for metrics spanning multiple recognized hotel business domains
- **THEN** the execution derives the required domain coverage before querying
- **AND** stops only after those domains have evidence or explicit limitations
- **AND** treats SQL call limits as convergence guards rather than dimension limits

### Requirement: Relation-level hotel isolation

Every hotel-scoped base relation in complex SQL SHALL be directly constrained to the employee's
allowed hotel IDs or transitively connected to a constrained relation by hotel-ID equality.

#### Scenario: Join two hotel fact tables only by date

- **WHEN** one table is hotel-filtered but another hotel-scoped table is joined only by date
- **THEN** the server rejects the SQL before DMS execution

### Requirement: Evidence provenance and complete presentation

Hotel SQL evidence SHALL carry safe table and semantic provenance, and answer generation SHALL
receive all validated result sets required by the request.

#### Scenario: Several SQL queries answer one request

- **WHEN** multiple successful SQL result sets cover different required domains
- **THEN** evidence assessment validates their combined coverage
- **AND** the final answer and deterministic result presentation do not silently discard earlier sets

### Requirement: Robust metadata discovery

Optional DMS table discovery SHALL request table GUIDs and SHALL treat an empty successful table list
as unavailable metadata rather than completed discovery.

#### Scenario: DMS returns success with zero tables

- **WHEN** table listing reports success but contains no table candidates
- **THEN** the collector does not attempt table descriptions from that result
- **AND** uses the verified semantic catalog or returns an explicit discovery limitation

### Requirement: Healthy bounded collection

The server SHALL only cache a hotel-data MCP catalog when the required SQL query tool is present and
SHALL bound total collection duration independently of individual boundary timeouts.

#### Scenario: MCP discovery transiently returns no tools

- **WHEN** hotel-data MCP returns an empty or incomplete tool catalog
- **THEN** the server refreshes it at most once and does not cache the unhealthy result
- **AND** fails explicitly if the SQL tool remains unavailable

### Requirement: Truthful scope and private evidence

Hotel-data evidence SHALL distinguish requested scope from observed scope, and SQL SHALL reject
default-sensitive fields and raw fallback payloads before execution.

#### Scenario: Result omits its requested date

- **WHEN** a date-bound request returns data that cannot prove the effective date range
- **THEN** the evidence is not marked sufficient solely from request slots

#### Scenario: Model projects sensitive detail

- **WHEN** SQL selects a catalog-sensitive field, `SELECT *` from a sensitive table, or raw JSON
- **THEN** the server rejects it before DMS execution

### Requirement: Metric and freshness evidence

Recognized requested metric families SHALL be backed by returned fields, and vague current analysis
SHALL establish a latest complete business date and a bounded comparison baseline when applicable.

#### Scenario: Traffic analysis only returns exposure

- **WHEN** the user explicitly asks for exposure, visits, conversion and trade
- **THEN** exposure-only evidence is incomplete and triggers one focused follow-up

### Requirement: Recoverable complete presentation

Persisted evidence SHALL survive retry and multiple result sets SHALL retain semantic identity under
the display row limit.

#### Scenario: Follow-up resumes after interruption

- **WHEN** retry resumes with prior SQL evidence
- **THEN** prior evidence participates in assessment without duplicate display rows
