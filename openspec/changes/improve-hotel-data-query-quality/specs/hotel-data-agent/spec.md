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
