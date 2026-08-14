# Desktop production runtime

## Requirements

### Requirement: Platform-native desktop log storage

The packaged desktop SHALL resolve logs through Electron's platform-native per-user application logs
directory and append the compile-time authentication profile (`staff` or `phone`). The active file
SHALL be `main.log`, SHALL contain `info` and above in packaged builds, SHALL redact sensitive data,
and SHALL rotate at 10 MiB to a bounded `main.old.log` archive.

#### Scenario: Locate production desktop logs
- **WHEN** a packaged desktop starts on macOS, Windows or Linux
- **THEN** its logs are stored at `<Electron logs>/<profile>/main.log`
- **AND** staff and phone packages do not append to the same file
- **AND** application code does not hard-code OS home directories

### Requirement: Operational path documentation

The root README SHALL map production server and desktop log locations, persisted data,
configuration, TLS material and diagnostic commands, and SHALL identify credential-bearing files.

#### Scenario: Diagnose a production incident
- **WHEN** an operator follows the repository README
- **THEN** the relevant server and desktop files can be located on every supported OS
- **AND** sensitive files are not mistaken for safe diagnostic attachments

### Requirement: Desktop RMS boundary logging

Every desktop HTTP attempt to RMS SHALL emit structured start and completion or failure records with
a request ID, attempt number, operation, safe origin/path, status when available and duration. Logs
SHALL exclude query strings, request/response bodies, usernames, passwords and tokens.

#### Scenario: Diagnose a retried RMS request
- **WHEN** a stale token causes one authenticated request retry
- **THEN** both attempts share one request ID and have distinct attempt numbers
- **AND** neither Bearer token is present in the file log
