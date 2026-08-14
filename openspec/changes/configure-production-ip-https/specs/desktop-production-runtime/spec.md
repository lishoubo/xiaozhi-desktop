# Desktop production runtime delta

## ADDED Requirements

### Requirement: Platform-native desktop log storage

The packaged desktop SHALL write redacted logs to Electron's platform-native per-user logs directory
under an authentication-profile-specific subdirectory. The file transport SHALL retain bounded
rotation and SHALL NOT depend on a hard-coded home directory or platform-specific environment
variable in application code.

#### Scenario: Locate production desktop logs
- **WHEN** a packaged staff or phone desktop starts
- **THEN** Electron creates or resolves its native application logs directory
- **AND** the current file is `<logs>/<profile>/main.log`
- **AND** staff and phone packages never append to the same file

#### Scenario: A log file reaches its size limit
- **WHEN** `main.log` exceeds 10 MiB
- **THEN** electron-log archives it as `main.old.log` and continues with a fresh `main.log`

### Requirement: Operational path documentation

The root README SHALL document production server and desktop log locations, persisted data,
configuration, TLS material and the commands used to inspect logs.

#### Scenario: An operator diagnoses production
- **WHEN** the operator consults the root README
- **THEN** the default Linux server paths and macOS, Windows and Linux desktop paths are listed
- **AND** credential-bearing files are clearly distinguished from safe public certificate material

### Requirement: Desktop RMS boundary logging

Every desktop RMS HTTP attempt SHALL record safe structured start and completion or failure events
with request correlation, attempt, operation, status and duration, without credentials or payloads.

#### Scenario: Retry an RMS request
- **WHEN** an authenticated RMS call retries after a 401 response
- **THEN** both attempts can be correlated without exposing either access token
