# local-rms-schema-bootstrap Specification Delta

## ADDED Requirements

### Requirement: Fresh local RMS includes a desktop experience employee

The checked-in RMS development schema SHALL create one deterministic active employee whose phone matches the desktop login hint.

#### Scenario: Initialize a fresh local RMS database

- **WHEN** MySQL imports `apps/server/rms-schema.sql`
- **THEN** active employee `desktop-demo` exists with phone `13800138000`, organization `42`, and role `FRONT_DESK`
- **AND** desktop displays `13800138000` as the experience phone

