# Desktop production runtime delta

## Requirement: Authentication failures remain user-safe and operator-diagnosable

The packaged desktop SHALL show stable user-friendly authentication failures while its main-process
file log retains the original error type, message, stack and bounded cause chain after redaction.

### Scenario: Phone authentication operation fails

- **WHEN** a capability preflight or remote phone authentication call fails
- **THEN** the renderer shows a friendly Chinese message without internal details
- **AND** the active profile's `main.log` records the operation and redacted original error chain
- **AND** phone numbers, verification codes, credentials and session values are absent

