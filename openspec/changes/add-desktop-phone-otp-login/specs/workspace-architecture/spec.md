# workspace-architecture Specification Delta

## MODIFIED Requirements

### Requirement: Desktop and administrator identity remain separated

The server SHALL use PostgreSQL Better Auth models for management administrators, RMS MySQL for desktop employee profiles, and a separate PostgreSQL desktop-session table containing no employee profile copy.

#### Scenario: Desktop authenticates

- **WHEN** an active RMS employee completes phone OTP login
- **THEN** PostgreSQL stores only the desktop session's token digest, RMS employee ID, and lifecycle timestamps
- **AND** administrator Better Auth tables are not used or modified for desktop identity

#### Scenario: Desktop calls the server

- **WHEN** renderer requests login or session operations
- **THEN** renderer uses preload IPC, main uses the shared typed tRPC client over HTTPS, and credentials stay in the main-process Electron session

