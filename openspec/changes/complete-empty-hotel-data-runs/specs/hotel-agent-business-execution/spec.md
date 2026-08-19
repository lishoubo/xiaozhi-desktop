# Hotel Agent business execution delta

## Added requirements

### Requirement: Empty hotel data is a normal outcome

The system SHALL distinguish a successful hotel-data query with zero matching rows from a tool or
data-service failure and SHALL complete the Run with a user-facing text response.

#### Scenario: Successful query has no rows

- **WHEN** the constrained hotel SQL tool succeeds with an empty collection or valid header-only table
- **THEN** the business execution completes normally without another collection or model call
- **AND** the assistant says that no matching hotel data was found for the requested period
- **AND** the response does not expose DMS, MCP, SQL or evidence terminology
- **AND** no generated result UI is attached

#### Scenario: Hotel data tool fails

- **WHEN** the hotel-data call fails by transport, authentication, protocol or query execution
- **THEN** the system keeps the existing failed-Run behavior
- **AND** does not misrepresent the failure as a confirmed empty result
