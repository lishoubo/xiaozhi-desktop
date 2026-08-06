## ADDED Requirements

### Requirement: RMS employee is the desktop identity source

The system SHALL resolve desktop user identity from the RMS `employee` table and SHALL NOT maintain a PostgreSQL desktop-user copy.

#### Scenario: Resolve an active employee

- **WHEN** phone OTP has passed and the caller requests identity for a phone belonging to an employee whose RMS status is active
- **THEN** the system returns that employee's safe identity fields

#### Scenario: Employee is unavailable

- **WHEN** the phone does not belong to an RMS employee or the matching employee is disabled
- **THEN** the system returns no identity

### Requirement: Employee identity response is safe

The system SHALL return only identity fields required by desktop and MUST NOT return password hashes or other credentials. RMS bigint identifiers SHALL be represented as decimal strings.

#### Scenario: Return employee information

- **WHEN** an active employee identity is returned
- **THEN** the response contains string `id`, string `orgId`, `username`, nullable `fullName`, `phone`, and `roleCode`
- **AND** the response does not contain `password_hash` or password-derived data

### Requirement: RMS access remains read-only

The server SHALL resolve employee identity using a parameterized read query and SHALL NOT insert, update, or delete RMS employee data.

#### Scenario: Query by phone

- **WHEN** the server looks up an employee phone
- **THEN** the phone is bound as a SQL parameter and the query filters for active status

### Requirement: Administrator identity remains separate

The management backend SHALL continue to authenticate administrators from PostgreSQL through the existing Better Auth administrator models.

#### Scenario: Administrator signs in after desktop identity migration

- **WHEN** an administrator signs into the management backend
- **THEN** the existing PostgreSQL-backed administrator authentication remains available
- **AND** no RMS employee record is required for administrator access
