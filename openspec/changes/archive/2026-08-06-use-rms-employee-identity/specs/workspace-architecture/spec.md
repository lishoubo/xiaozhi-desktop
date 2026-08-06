## ADDED Requirements

### Requirement: Database identity boundaries

The server SHALL use PostgreSQL for management-backend administrator identity and system-owned data, while desktop employee identity SHALL be read from the external RMS MySQL `employee` table without a PostgreSQL user copy.

#### Scenario: Resolve identities for each application surface

- **WHEN** the management backend authenticates an administrator
- **THEN** it uses the PostgreSQL-backed Better Auth administrator models

- **WHEN** desktop resolves an authenticated employee after phone OTP
- **THEN** it reads the active employee identity from RMS MySQL
