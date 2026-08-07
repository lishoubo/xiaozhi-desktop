# rms-employee-identity Specification Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

