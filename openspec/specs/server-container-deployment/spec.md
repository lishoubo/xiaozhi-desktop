# Server container deployment

## Purpose

Define the supported container startup and HTTPS boundary for local development and production.

## Requirements

### Requirement: Environment-specific Compose startup

The repository SHALL provide root npm commands to validate, start, inspect and stop development and
production server Compose stacks. Development SHALL include PostgreSQL, the RMS fixture, database
initialization and the mkcert-backed HTTPS server. Production SHALL include PostgreSQL, database
initialization and the locally built direct-HTTPS server image.

#### Scenario: Start development services
- **WHEN** a developer runs `npm run compose:dev:up`
- **THEN** the local server stack is built and started after local HTTPS setup
- **AND** `compose:dev:config`, `compose:dev:logs` and `compose:dev:down` operate on the same stack

#### Scenario: Start production services
- **WHEN** an operator supplies the ignored `apps/server/.env.production` and runs
  `npm run compose:prod:up`
- **THEN** the server production image is built locally and the production stack starts
- **AND** no private container registry is required

### Requirement: Private-CA HTTPS termination

The server container SHALL expose HTTPS using a read-only mounted leaf certificate and private key
issued by the deployment's private CA. The production endpoint SHALL be
`https://121.199.29.74:35443`, and its certificate SAN SHALL contain IP address `121.199.29.74`.

#### Scenario: Electron connects to production
- **WHEN** the production desktop is packaged for `https://121.199.29.74:35443`
- **THEN** Electron validates the leaf chain against its packaged public CA certificate for that
  exact backend origin
- **AND** no CA private key, server private key or disabled certificate validation is packaged

#### Scenario: Production certificate material is invalid
- **WHEN** the certificate is expired, has the wrong IP SAN, does not chain to the expected CA or
  does not match its private key
- **THEN** production desktop packaging fails before Electron Forge runs

#### Scenario: Another host presents an untrusted certificate
- **WHEN** any non-backend host fails Chromium certificate validation
- **THEN** the packaged private CA exception is not applied
- **AND** the connection remains rejected

### Requirement: Minimal production configuration

The production environment template SHALL contain deployment-time credentials, external endpoints,
host storage paths and provider secrets. Stable image choices and safe application defaults SHALL
remain in checked-in Compose or application configuration.

#### Scenario: Prepare production configuration
- **WHEN** an operator copies `.env.production.example`
- **THEN** only environment-specific values require replacement
- **AND** the real `.env.production` remains ignored by Git

#### Scenario: Deploy without the optional RMS phone identity source
- **WHEN** the production Compose stack starts
- **THEN** it requires the RMS HTTPS API endpoint used for staff Bearer identity validation
- **AND** it does not require `RMS_DATABASE_URL`
- **AND** it passes `RMS_DATABASE_URL` through when an operator explicitly adds it later
- **AND** the same server image supports both desktop authentication interfaces

### Requirement: Production network boundary

The production API SHALL be published at `121.199.29.74:35443`. PostgreSQL SHALL publish host port
35432 for operator GUI access and SHALL require source restriction at the cloud or host firewall.
The repository SHALL provide a guarded
setup command that generates a mode-`0600`, ignored `.env.production` with a high-entropy database
password and refuses to overwrite existing operator configuration.

#### Scenario: Generate initial production configuration
- **WHEN** no `.env.production` exists and the operator runs `npm run env:setup:production`
- **THEN** the fixed API origin and ports are populated
- **AND** database name, username and random password are written without printing the password

### Requirement: Production source distribution and host preparation

The repository SHALL package production server source from a clean committed revision using an
explicit server-only allowlist. The archive SHALL exclude runtime environments, TLS material,
private keys, desktop sources and generated artifacts and SHALL include a SHA-256 checksum. A
separate idempotent command SHALL prepare the application, TLS and PostgreSQL persistence directories
on a new host without starting services or modifying firewall rules.

#### Scenario: Build and stage production source
- **WHEN** an operator packages a clean revision and prepares a new host
- **THEN** the source archive contains all Docker build inputs and no deployment secrets
- **AND** the host has the directories required by production Compose mounts
- **AND** `.env.production` and TLS files are transferred separately

#### Scenario: Build a single-upload production deployment bundle
- **WHEN** an operator explicitly runs the sensitive production packaging command
- **THEN** the clean committed source, ignored `.env.production`, server `cert.pem`, `key.pem` and
  `ca.pem` are placed in one mode-`0600` archive with a checksum
- **AND** placeholder settings, permissive private-file modes, invalid IP TLS material, the CA signing
  key, desktop source and unrelated private keys are rejected before publication

### Requirement: Production server observability

The server SHALL emit structured start and completion or failure events for every outbound RMS HTTP
request. Events SHALL include incoming request correlation, operation, safe endpoint origin/path,
HTTP status when available, outcome and elapsed time, and SHALL exclude credentials, request/response
bodies and returned business identity data. Production Compose SHALL retain the JSON logs through a
host bind mount whose default directory is `/var/log/hotel-butler/server`, while preserving stdout
for normal Docker log inspection.

#### Scenario: Diagnose an RMS identity lookup
- **WHEN** the server calls the RMS `/api/v1/me` endpoint
- **THEN** the call emits a correlated start event followed by a completion or failure event
- **AND** the default host log file is `/var/log/hotel-butler/server/server.jsonl`
- **AND** the Bearer credential and RMS identity response are absent from the records
