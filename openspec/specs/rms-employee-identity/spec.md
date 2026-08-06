# rms-employee-identity Specification

## Purpose

Define the safe, read-only employee identity boundary used by desktop after phone OTP while keeping management-backend administrator identity in PostgreSQL.

## Requirements
### Requirement: RMS employee is the desktop identity source

The system SHALL resolve desktop user identity from the RMS `employee` table after the phone OTP gateway accepts the login and SHALL NOT maintain a PostgreSQL desktop-user copy.

#### Scenario: Resolve an active employee after OTP

- **WHEN** the OTP gateway accepts a phone and six-digit code belonging to an active RMS employee
- **THEN** the phone-code login mutation returns that employee's safe identity fields

#### Scenario: OTP or employee is unavailable

- **WHEN** the OTP gateway rejects the code, or the phone does not belong to an active RMS employee
- **THEN** the phone-code login mutation fails with the same unauthenticated response

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

### Requirement: Phone OTP uses a replaceable gateway

The shared API SHALL expose provider-neutral phone-code request and login mutations, and the server SHALL inject SMS delivery and verification through a gateway that does not expose provider SDK types in the shared contract.

#### Scenario: Request a phone code

- **WHEN** a caller requests a code for a schema-valid phone
- **THEN** the API returns the same accepted response regardless of employee existence
- **AND** it does not return the verification code

#### Scenario: Use the temporary gateway before provider selection

- **WHEN** no SMS provider has been selected
- **THEN** the server's explicitly temporary gateway accepts every schema-valid six-digit code
- **AND** replacing that gateway does not require changing the shared tRPC procedures

### Requirement: Employee lookup cannot bypass OTP

The public tRPC router SHALL NOT expose a direct employee-by-phone lookup.

#### Scenario: Resolve desktop identity

- **WHEN** a desktop caller needs an employee identity
- **THEN** it uses the phone-code login mutation
- **AND** identity lookup occurs only after the OTP gateway accepts the input

### Requirement: Administrator identity remains separate

The management backend SHALL continue to authenticate administrators from PostgreSQL through the existing Better Auth administrator models.

#### Scenario: Administrator signs in after desktop identity migration

- **WHEN** an administrator signs into the management backend
- **THEN** the existing PostgreSQL-backed administrator authentication remains available
- **AND** no RMS employee record is required for administrator access
