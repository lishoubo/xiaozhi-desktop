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

The capability SHALL expose only approved read tools and SHALL constrain SQL to one `SELECT` or CTE with at most 50 returned rows.

#### Scenario: Model attempts an unsafe query

- **WHEN** SQL contains a write operation, multiple statements, comments, file access, locks or a blocked function
- **THEN** the server rejects the tool call before it reaches DMS

### Requirement: Shared initial data access

All authenticated employees SHALL initially share the query scope granted to the configured DMS token.

#### Scenario: Employee starts a data query

- **WHEN** any authenticated employee asks an operating-data question
- **THEN** no local hotel-scope filter is added
- **AND** DMS token permissions define the available data

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

### Requirement: Honest hotel resolution scope

Hotel-name resolution SHALL first query active hotels in the authenticated employee's RMS
organization. When that directory has no match, candidate discovery MAY fall back to the bounded
hotel IDs visible to the configured DMS token, and data queries SHALL retain the shared access scope
granted by that token.

#### Scenario: Resolve a hotel through the RMS directory
- **WHEN** an active hotel name or short name matches inside the authenticated organization
- **THEN** the execution resolves it to the RMS hotel ID with a parameterized read query
- **AND** does not query another organization's hotel directory

#### Scenario: Fall back to shared DMS hotel IDs
- **WHEN** the authenticated organization's RMS hotel directory has no matching hotel
- **THEN** the execution retrieves a bounded distinct hotel-ID list from DMS
- **AND** presents multiple IDs as explicit clarification choices rather than guessing from the name
- **AND** does not represent them as employee-specific hotel authorization
