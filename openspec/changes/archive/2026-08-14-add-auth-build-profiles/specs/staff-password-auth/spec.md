## MODIFIED Requirements

### Requirement: Server authentication interfaces are capability-based

The server SHALL register staff Bearer authentication and phone authentication interfaces
concurrently, SHALL create an RMS MySQL connection pool only when `RMS_DATABASE_URL` is configured,
and SHALL NOT fail startup when it is absent.

#### Scenario: Start without an RMS database URL
- **WHEN** the server starts without `RMS_DATABASE_URL`
- **THEN** startup succeeds without creating an RMS MySQL pool
- **AND** staff Bearer authentication remains available
- **AND** phone routes remain registered
- **AND** a phone identity lookup returns an actionable service-unavailable response

#### Scenario: Start with an RMS database URL
- **WHEN** the server starts with `RMS_DATABASE_URL`
- **THEN** exactly one RMS connection pool is created
- **AND** staff and phone clients can use the same server instance

### Requirement: Desktop authentication builds use named profiles

The repository SHALL expose validated `staff` and `phone` desktop build profiles while retaining
compile-time authentication selection.

#### Scenario: Package a phone desktop application
- **WHEN** an operator runs the named phone package or make command
- **THEN** the phone variant is injected into all Electron Vite bundles
- **AND** the artifact identity and output location identify it as the phone build
