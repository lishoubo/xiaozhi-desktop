# Server container deployment delta

## MODIFIED Requirements

### Requirement: Private-CA HTTPS termination

The production server SHALL expose HTTPS at `https://121.199.29.74:35443` using a read-only mounted
leaf certificate and private key issued by the deployment private CA. The leaf certificate SAN
SHALL contain IP address `121.199.29.74`.

#### Scenario: Package the production desktop
- **WHEN** an operator runs the production desktop packaging command with the generated certificate
  set present
- **THEN** the desktop build embeds `https://121.199.29.74:35443` as its server origin
- **AND** it packages only the public private-CA certificate
- **AND** certificate validation is scoped to that exact backend address

#### Scenario: Certificate material is unsafe or inconsistent
- **WHEN** the certificate is expired, has the wrong SAN, does not chain to the expected CA, does not
  match its private key or includes unexpected private material in desktop resources
- **THEN** production packaging fails before Electron Forge runs

### Requirement: Production network ports and generated database credentials

The production Compose stack SHALL publish the HTTPS API on host TCP port 35443 and PostgreSQL on
host TCP port 35432 for operator GUI access. The repository SHALL provide a
guarded command that generates an ignored production environment file containing a high-entropy
database password.

#### Scenario: Prepare production environment
- **WHEN** the operator runs the production environment setup command and no environment file exists
- **THEN** `.env.production` is created with mode `0600`
- **AND** API address `121.199.29.74:35443`, PostgreSQL internal address `db:35432`, database name,
  username and a random password are populated
- **AND** the password is not printed to command output

#### Scenario: Protect an existing production environment
- **WHEN** `.env.production` already exists
- **THEN** the setup command fails without changing it

### Requirement: Production source distribution and host layout

The repository SHALL create a commit-addressed server source archive and SHA-256 checksum from a
clean Git revision using an explicit server-only allowlist. The archive SHALL exclude runtime
environment files, TLS material, private keys, desktop sources and generated artifacts. A separate
idempotent command SHALL prepare the application, TLS and PostgreSQL data directories on a new host
without starting services or changing firewall rules.

#### Scenario: Package committed server source
- **WHEN** the worktree is clean and an operator runs the production source packaging command
- **THEN** a tarball and checksum are written under ignored `output/deploy/`
- **AND** unsafe or incomplete archive content fails before publication

#### Scenario: Prepare a new production host
- **WHEN** an authorized operator runs the host preparation command with valid deploy identities
- **THEN** application, TLS, PostgreSQL persistence and server log directories are created with explicit modes
  and container-readable ownership
- **AND** existing runtime file permissions and the dedicated logrotate rule are normalized
- **AND** no service, firewall or remote system is changed

### Requirement: Single-upload sensitive deployment bundle

The repository SHALL retain a credential-free source archive and SHALL additionally provide an
explicit production deployment bundle containing the clean committed server source, the ignored
production environment and only the server runtime certificate, key and public CA. The sensitive
bundle SHALL be mode `0600` and SHALL exclude the CA signing key and desktop source.

#### Scenario: Package a runnable production release
- **WHEN** the operator runs the production deployment packaging command
- **THEN** placeholder configuration, unsafe private-file permissions or invalid IP TLS material fail
  before an artifact is published
- **AND** the resulting bundle and checksum can be transferred without separate environment or TLS uploads

### Requirement: Production server observability

The server SHALL emit structured logs for every outbound RMS HTTP request and SHALL retain production
JSON logs in a host-mounted directory. Logs SHALL include request correlation, operation, status,
outcome and duration while excluding credentials, response bodies and returned identity data.

#### Scenario: Diagnose an RMS identity lookup
- **WHEN** the server calls the RMS `/api/v1/me` endpoint
- **THEN** start and completion or failure events carry the incoming request ID and elapsed time
- **AND** production logs are available at `/var/log/hotel-butler/server/server.jsonl` by default
- **AND** the Bearer credential and RMS identity response are absent from the records
