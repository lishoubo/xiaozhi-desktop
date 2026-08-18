# Hotel data Agent

## Purpose

Define how authenticated hotel employees query real operating data through the server-managed DMS MCP.

## Requirements

### Requirement: Server-managed hotel data MCP

The server SHALL provide the designated DMS MCP as a fixed hotel-data capability using a server-only bearer token.

#### Scenario: Query operating data

- **WHEN** an authenticated employee asks for real hotel operating data
- **THEN** the Agent queries DMS through the server-managed MCP
- **AND** does not use the local RMS database as the operating-data source

### Requirement: Read-only query boundary

The capability SHALL expose only approved read tools and SHALL constrain SQL to one `SELECT` or CTE with at most 75 returned rows.

#### Scenario: Model attempts an unsafe query

- **WHEN** SQL contains a write operation, multiple statements, comments, file access, locks or a blocked function
- **THEN** the server rejects the tool call before it reaches DMS

### Requirement: Employee-managed hotel data access

The server SHALL derive each authenticated employee's managed hotels from trusted RMS identity data
and SHALL constrain every DMS SQL execution to those hotel IDs. Client input and model-generated SQL
SHALL NOT broaden that scope.

#### Scenario: Employee starts a data query

- **WHEN** any authenticated employee asks an operating-data question
- **THEN** the server resolves the employee's current and accessible hotel IDs from RMS
- **AND** injects an execution-scoped `hotel_id` filter before the SQL reaches DMS
- **AND** rejects the query when the account has no managed hotels or the request names an
  unauthorized hotel

#### Scenario: Two employees query concurrently

- **WHEN** concurrent Agent Runs use different managed-hotel sets
- **THEN** each DMS call receives only its own Run's hotel scope
- **AND** one employee's scope cannot leak into another asynchronous execution

### Requirement: Safe result delivery

The Agent SHALL preserve business fields, hide system credentials, and reduce oversized results before returning them through the existing Agent event and generative-UI flow.

#### Scenario: Result is too large for the conversation UI

- **WHEN** a DMS result exceeds the row or size limit
- **THEN** the server retains a bounded subset
- **AND** the Agent tells the user that the displayed result was filtered

#### Scenario: Query fails

- **WHEN** the model or DMS query cannot complete
- **THEN** the user receives a friendly retryable message without internal SQL, endpoint or credential details

### Requirement: Real data-agent regression coverage

The server E2E suite SHALL include a natural-language test that uses the real LLM and DMS MCP.

#### Scenario: Run the full server E2E suite

- **WHEN** valid Kimi and DMS credentials are configured
- **THEN** the suite verifies login, Agent run completion, restricted SQL tool completion and a business answer containing hotel and GMV information

### Requirement: Execution-scoped hotel data evidence

Hotel-data tools SHALL be selected by the current registered read workflow. Results SHALL become
credential-redacted, bounded evidence with query fingerprint, requested scope, period, metrics,
filtering state and available observation metadata before answer generation.

#### Scenario: Result scope does not match
- **WHEN** returned hotel metadata conflicts with the resolved request
- **THEN** the evidence is rejected and is not passed to answer or generated-UI production

#### Scenario: Result was compacted
- **WHEN** the provider omits rows, hides credential fields or truncates values
- **THEN** the evidence records filtering and the final answer discloses the material limitation

### Requirement: Authenticated hotel resolution scope

Hotel-name resolution SHALL use the active hotels explicitly available to the authenticated employee.
Clarification choices SHALL contain only those hotels, and resolved identifiers SHALL be checked
again immediately before workflow execution.

#### Scenario: Resolve a managed hotel
- **WHEN** an accessible hotel ID, full name or unambiguous short name matches the authenticated
  employee's RMS hotel list
- **THEN** the execution resolves it to that trusted RMS hotel ID
- **AND** does not query or offer another employee's hotels

#### Scenario: Resolve all managed hotels
- **WHEN** the employee explicitly requests all hotels
- **THEN** the execution resolves the request to the complete authenticated managed-hotel ID list
- **AND** the DMS execution scope remains the same bounded list
