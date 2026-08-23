# Workspace architecture

## Purpose

Define repository ownership, shared contract boundaries and trust boundaries between the desktop application, server application and reusable packages.
## Requirements
### Requirement: Workspace ownership

The repository SHALL use npm workspaces with deployable applications in `apps/*` and reusable packages in `packages/*`, with the root `package-lock.json` as the only npm lockfile. `packages/api` SHALL expose serializable cross-process schemas, DTOs, events and the type-only tRPC client projection. Server persistence ports, identity workflows, request-context construction and application endpoint implementations SHALL remain owned by `apps/server`; a shared tRPC transport declaration, including its context interface and thin procedures, MAY exist behind an explicit server-only package subpath when required to preserve tRPC type inference.

#### Scenario: Place application and shared code

- **WHEN** code is specific to the Electron application
- **THEN** it is owned by `apps/desktop`
- **WHEN** code is specific to SvelteKit SSR, authentication, remote persistence or server endpoints
- **THEN** it is owned by `apps/server`
- **WHEN** code defines a serializable schema, DTO, event or type-only tRPC projection shared by server and desktop
- **THEN** it is owned by the default `packages/api` entry point

#### Scenario: Desktop imports the shared contract

- **WHEN** desktop validates or sends a tRPC/IPC value
- **THEN** it imports a Zod schema, DTO, event or type-only router projection from `@hotel-butler/api`
- **AND** it does not import server request context, logger, repository, identity directory or session port types

#### Scenario: Server handles an authenticated procedure

- **WHEN** a tRPC procedure verifies an employee, issues a session or resolves an Agent principal
- **THEN** the workflow is implemented in `apps/server`
- **AND** the shared transport declaration only validates transport data and calls one request-scoped endpoint module method

### Requirement: Desktop-to-server trust boundary

Desktop-to-server communication SHALL use tRPC over `/api/trpc`, and the desktop tRPC client SHALL run in Electron main while renderer code accesses trusted capabilities only through preload and IPC.

#### Scenario: Desktop calls the server

- **WHEN** desktop needs a server capability
- **THEN** Electron main uses the shared tRPC contract
- **AND** renderer does not import or call the server implementation directly

#### Scenario: Desktop streams Agent events

- **WHEN** desktop runs a long-lived Agent task
- **THEN** Electron main uses the shared tRPC SSE subscription over HTTPS
- **AND** preload forwards validated events to renderer without exposing the server credential

#### Scenario: Desktop performs authentication operations

- **WHEN** renderer requests login or session operations
- **THEN** renderer uses preload IPC, main uses the shared typed tRPC client over HTTPS, and credentials stay in the main-process Electron session

### Requirement: Local development uses HTTPS

Local desktop and server development endpoints SHALL use the host-trusted mkcert certificate prepared by the repository HTTPS setup command.

#### Scenario: Start desktop development

- **WHEN** a developer starts the desktop application through the repository npm entry point
- **THEN** certificate setup runs before Electron Forge starts
- **AND** Electron loads the renderer from `https://localhost:5174`
- **AND** the desktop main process connects to the local server at `https://localhost:5173` by default

#### Scenario: Start the local server

- **WHEN** a developer starts the server through either the host development command or local Docker Compose
- **THEN** the server is available to the desktop at `https://localhost:5173` by default
- **AND** local Docker Compose may override the host port through `SERVER_HTTPS_PORT`

### Requirement: Local data remains explicit

Desktop-local browser sessions, cookies, automation state and local SQLite data SHALL NOT be implicitly synchronized to the server.

#### Scenario: Store desktop-local state

- **WHEN** desktop records browser, cookie, automation or local SQLite state
- **THEN** the state remains local unless a specific shared contract explicitly synchronizes it

### Requirement: Server implementations remain private

Server persistence, identity workflow and request-context implementations SHALL NOT be imported by desktop or the default shared API package entry point.

#### Scenario: Implement a shared contract

- **WHEN** a tRPC contract requires database or identity access
- **THEN** `packages/api` exposes only the serializable input/output contract and client type projection
- **AND** `apps/server` owns the endpoint module and injected persistence implementation

### Requirement: Database identity boundaries

The server SHALL use PostgreSQL Better Auth models for management administrators, RMS MySQL for desktop employee profiles, and a separate PostgreSQL desktop-session table containing no employee profile copy.

#### Scenario: Resolve identities for each application surface

- **WHEN** the management backend authenticates an administrator
- **THEN** it uses the PostgreSQL-backed Better Auth administrator models

- **WHEN** desktop resolves an authenticated employee after phone OTP
- **THEN** it reads the active employee identity from RMS MySQL

#### Scenario: Desktop authenticates

- **WHEN** an active RMS employee completes phone OTP login
- **THEN** PostgreSQL stores only the desktop session's token digest, RMS employee ID, and lifecycle timestamps
- **AND** administrator Better Auth tables are not used or modified for desktop identity
