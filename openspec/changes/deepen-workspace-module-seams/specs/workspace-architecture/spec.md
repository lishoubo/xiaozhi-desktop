## MODIFIED Requirements

### Requirement: Workspace ownership

The repository SHALL use npm workspaces with deployable applications in `apps/*` and reusable packages in `packages/*`, with the root `package-lock.json` as the only npm lockfile. `packages/api` SHALL expose serializable cross-process schemas, DTOs, events and the type-only tRPC client projection. Server persistence ports, identity workflows, request-context construction and application endpoint implementations SHALL remain owned by `apps/server`; a shared tRPC transport declaration, including its context interface and thin procedures, MAY exist behind an explicit server-only package subpath when required to preserve tRPC type inference.

#### Scenario: Desktop imports the shared contract

- **WHEN** desktop validates or sends a tRPC/IPC value
- **THEN** it imports a Zod schema, DTO, event or type-only router projection from `@hotel-butler/api`
- **AND** it does not import server request context, logger, repository, identity directory or session port types

#### Scenario: Server handles an authenticated procedure

- **WHEN** a tRPC procedure verifies an employee, issues a session or resolves an Agent principal
- **THEN** the workflow is implemented in `apps/server`
- **AND** the shared transport declaration only validates transport data and calls one request-scoped endpoint module method

### Requirement: Server implementations remain private

Server persistence, identity workflow and request-context implementations SHALL NOT be imported by desktop or the default shared API package entry point.

#### Scenario: Implement a shared contract

- **WHEN** a tRPC contract requires database or identity access
- **THEN** `packages/api` exposes only the serializable input/output contract and client type projection
- **AND** `apps/server` owns the endpoint module and injected persistence implementation
