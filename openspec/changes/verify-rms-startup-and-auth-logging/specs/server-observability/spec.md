# Server observability delta

## Requirement: RMS startup diagnostics are safe and actionable

The server SHALL emit structured RMS connection verification events during authentication-resource
initialization without recording database URLs, credentials, SQL messages, query results or personal
data.

### Scenario: Verification succeeds

- **WHEN** the configured RMS pool completes its read-only startup check
- **THEN** an `rms.connection.verified` info event records its duration

### Scenario: Verification fails

- **WHEN** RMS URL parsing, connection, authentication or query execution fails
- **THEN** an `rms.connection.failed` error event records duration, safe error type and an allow-listed
  driver error code
- **AND** no connection URL, username, password or raw driver message is logged

