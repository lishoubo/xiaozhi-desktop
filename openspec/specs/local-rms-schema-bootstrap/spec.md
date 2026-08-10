# local-rms-schema-bootstrap Specification

## Purpose

Define how local development creates RMS query tables from the checked-in MySQL dump without re-importing over an initialized data volume or affecting production.

## Requirements
### Requirement: Fresh local RMS initialization imports the development schema

The local development MySQL service SHALL execute `apps/server/rms-schema.sql` when its MySQL data directory is initialized for the first time.

#### Scenario: Start with a fresh RMS data volume

- **WHEN** the local RMS MySQL service starts with an uninitialized data directory
- **THEN** MySQL imports `rms-schema.sql` through its initialization directory
- **AND** the RMS tables including `employee` are available after startup

### Requirement: Existing local RMS data is preserved

The local development startup SHALL NOT re-import `rms-schema.sql` when the MySQL data directory has already been initialized.

#### Scenario: Restart an initialized RMS service

- **WHEN** the local RMS service starts with an existing initialized data volume
- **THEN** the initialization script is skipped
- **AND** existing tables and data are not replaced by the dump

### Requirement: Fresh local RMS includes a desktop experience employee

The checked-in RMS development schema SHALL create one deterministic active employee whose phone matches the desktop login hint.

#### Scenario: Initialize a fresh local RMS database

- **WHEN** MySQL imports `apps/server/rms-schema.sql`
- **THEN** active employee `desktop-demo` exists with phone `13800138000`, organization `42`, and role `FRONT_DESK`
- **AND** desktop displays `13800138000` as the experience phone

### Requirement: Production does not import the development dump

The production deployment SHALL NOT mount or execute `apps/server/rms-schema.sql`.

#### Scenario: Render production Compose configuration

- **WHEN** the production Compose project is configured or started
- **THEN** no RMS schema initialization mount or command is present
