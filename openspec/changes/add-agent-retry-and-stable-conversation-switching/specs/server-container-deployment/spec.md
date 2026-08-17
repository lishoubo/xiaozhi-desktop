# Server container deployment delta

## ADDED Requirements

### Requirement: Environment-specific Compose startup

The repository SHALL provide explicit development and production Docker Compose startup paths for
the server and its managed PostgreSQL dependency, exposed through root npm commands.

#### Scenario: Start development services
- **WHEN** a developer runs the development Compose startup command
- **THEN** PostgreSQL, the local RMS fixture, database initialization and the HTTPS server start
  from checked-in configuration
- **AND** the existing mkcert trust setup runs before Compose startup

#### Scenario: Start production services
- **WHEN** an operator supplies the production environment file and runs the production startup
  command
- **THEN** Compose builds the server image locally and starts PostgreSQL, initialization, server
  and direct HTTPS server
- **AND** no private container registry is required

### Requirement: Private-CA HTTPS termination

The production server container SHALL terminate HTTPS using a read-only mounted server certificate
and private key issued by the deployment's private CA.

#### Scenario: Serve the Electron API
- **WHEN** the server certificate contains the configured DNS name or IP in its SAN
- **THEN** the server exposes the API directly over HTTPS
- **AND** the Electron client accepts it only through the packaged public CA trust anchor
