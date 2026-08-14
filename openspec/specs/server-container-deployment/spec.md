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
issued by the deployment's private CA. The certificate SAN SHALL match the configured server DNS
name or IP address.

#### Scenario: Electron connects to production
- **WHEN** `HOTEL_BUTLER_SERVER_URL` targets the production HTTPS domain
- **THEN** Electron validates the leaf chain against its packaged public CA certificate for that
  exact backend origin
- **AND** no CA private key, server private key or disabled certificate validation is packaged

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
