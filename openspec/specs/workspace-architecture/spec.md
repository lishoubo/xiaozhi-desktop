# Workspace architecture

## Purpose

Define repository ownership, shared contract boundaries and trust boundaries between the desktop application, server application and reusable packages.
## Requirements
### Requirement: Workspace ownership

The repository SHALL use npm workspaces with deployable applications in `apps/*` and reusable packages in `packages/*`, with the root `package-lock.json` as the only npm lockfile.

#### Scenario: Place application and shared code

- **WHEN** code is specific to the Electron application
- **THEN** it is owned by `apps/desktop`
- **WHEN** code is specific to SvelteKit SSR, authentication, remote persistence or server endpoints
- **THEN** it is owned by `apps/server`
- **WHEN** code defines the type-safe tRPC contract shared by server and desktop
- **THEN** it is owned by `packages/api`

### Requirement: Desktop-to-server trust boundary

Desktop-to-server communication SHALL use tRPC over `/api/trpc`, and the desktop tRPC client SHALL run in Electron main while renderer code accesses trusted capabilities only through preload and IPC.

#### Scenario: Desktop calls the server

- **WHEN** desktop needs a server capability
- **THEN** Electron main uses the shared tRPC contract
- **AND** renderer does not import or call the server implementation directly

### Requirement: Local data remains explicit

Desktop-local browser sessions, cookies, automation state and local SQLite data SHALL NOT be implicitly synchronized to the server.

#### Scenario: Store desktop-local state

- **WHEN** desktop records browser, cookie, automation or local SQLite state
- **THEN** the state remains local unless a specific shared contract explicitly synchronizes it

### Requirement: Server implementations remain private

Server persistence implementations SHALL NOT be imported by desktop or the shared API package.

#### Scenario: Implement a shared contract

- **WHEN** a tRPC contract requires database access
- **THEN** `packages/api` exposes types or a context port
- **AND** `apps/server` owns and injects the persistence implementation

### Requirement: Database identity boundaries

The server SHALL use PostgreSQL for management-backend administrator identity and system-owned data, while desktop employee identity SHALL be read from the external RMS MySQL `employee` table without a PostgreSQL user copy.

#### Scenario: Resolve identities for each application surface

- **WHEN** the management backend authenticates an administrator
- **THEN** it uses the PostgreSQL-backed Better Auth administrator models

- **WHEN** desktop resolves an authenticated employee after phone OTP
- **THEN** it reads the active employee identity from RMS MySQL
