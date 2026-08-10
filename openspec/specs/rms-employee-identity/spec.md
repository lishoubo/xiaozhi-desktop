# rms-employee-identity Specification

## Purpose

Define the safe, read-only employee identity boundary used by desktop after phone OTP while keeping management-backend administrator identity in PostgreSQL.

## Requirements
### Requirement: RMS employee is the desktop identity source

The system SHALL issue a desktop session only after phone OTP acceptance resolves an active RMS employee and SHALL re-resolve that active employee from RMS when restoring a session. It SHALL NOT maintain a PostgreSQL desktop-user profile copy.

#### Scenario: Login an active employee

- **WHEN** the temporary OTP gateway accepts a six-digit code and the phone belongs to an active RMS employee
- **THEN** the server issues a revocable desktop session and returns only the employee's safe identity

#### Scenario: Phone is unavailable

- **WHEN** the phone does not belong to an active RMS employee
- **THEN** login fails with the generic unauthenticated response
- **AND** no desktop session is issued

#### Scenario: Restore an active employee session

- **WHEN** an unexpired desktop session references an employee that remains active in RMS
- **THEN** current-session returns the current safe RMS employee identity

#### Scenario: Employee becomes unavailable

- **WHEN** a desktop session references a missing or disabled RMS employee
- **THEN** the session is revoked and current-session returns no identity

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

### Requirement: Desktop session is opaque and revocable

The server SHALL generate a cryptographically random desktop session token, store only its SHA-256 digest with the RMS employee ID and expiry in PostgreSQL, and support server-side validation and logout revocation.

#### Scenario: Issue a session

- **WHEN** desktop login succeeds
- **THEN** the raw token is returned only as a Secure, HttpOnly, SameSite=Strict host cookie
- **AND** PostgreSQL contains only the token digest

#### Scenario: Session expires or is revoked

- **WHEN** a cookie references an expired, missing, or logged-out session
- **THEN** current-session returns no identity and clears the cookie

### Requirement: Renderer cannot access the session credential

The desktop SHALL keep the server session cookie in a dedicated persistent Electron session partition and SHALL expose only safe employee identity through preload IPC.

#### Scenario: Persist login across restart

- **WHEN** desktop restarts with a valid API-session cookie
- **THEN** main validates it with the server and renderer receives the safe employee identity
- **AND** renderer cannot read the opaque cookie value

#### Scenario: Logout while server is unavailable

- **WHEN** the user logs out and remote revocation fails
- **THEN** desktop still removes the local API-session cookie
- **AND** OTA account sessions remain unchanged

### Requirement: Administrator identity remains separate

The management backend SHALL continue to authenticate administrators from PostgreSQL through the existing Better Auth administrator models.

#### Scenario: Administrator signs in after desktop identity migration

- **WHEN** an administrator signs into the management backend
- **THEN** the existing PostgreSQL-backed administrator authentication remains available
- **AND** no RMS employee record is required for administrator access
