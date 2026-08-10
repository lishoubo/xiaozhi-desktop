# Tasks: Complete desktop phone OTP login

## 1. Contract and session behavior (TDD)

- [x] 1.1 Add focused router tests for session issuance after active RMS login, current-session identity/null, logout revocation, and generic dependency failures; confirm Red.
- [x] 1.2 Add the transport-neutral desktop session port and `currentSession`/`logout` procedures; make focused API tests Green.
- [x] 1.3 Export only the shared schemas and safe identity/session response types needed by server and desktop.

## 2. Server persistence and HTTP session adapter (TDD)

- [x] 2.1 Add focused tests for token hashing, seven-day expiry, revocation, malformed/missing cookies, RMS-disabled employees, cookie attributes, and absence of credential logging; confirm Red.
- [x] 2.2 Add the Drizzle `desktop_session` table and forward migration without modifying Better Auth administrator tables.
- [x] 2.3 Implement the PostgreSQL session repository and request-scoped HTTP cookie gateway, then inject it through the fetch adapter context; make focused tests Green.
- [x] 2.4 Extend the RMS identity directory with a parameterized active-employee lookup by ID for session restoration.

## 3. Local RMS experience employee (TDD)

- [x] 3.1 Add a bootstrap test that requires the deterministic active experience employee in `rms-schema.sql`; confirm Red.
- [x] 3.2 Add the employee row to the checked-in schema dump and remove the duplicate E2E setup insert; make focused bootstrap/server E2E tests Green.

## 4. Desktop main/preload integration (TDD)

- [x] 4.1 Add tests for HTTPS server-origin configuration, dedicated persistent API session fetch with credentials, auth IPC validation, session restoration, login, and logout local-cookie cleanup; confirm Red.
- [x] 4.2 Compose the typed tRPC client and dedicated Electron API session in main, register auth IPC handlers, and preserve generic safe errors.
- [x] 4.3 Extend preload/shared schemas with the narrow auth API; ensure no raw token can cross into renderer.

## 5. Desktop renderer integration (TDD)

- [x] 5.1 Update component tests for async request-code/login, arbitrary six-digit codes, startup session restoration, failed login, logout, and the experience-account hint; confirm Red.
- [x] 5.2 Replace the fixed mock and localStorage session with preload auth calls and server-returned employee identity; make focused tests Green.
- [x] 5.3 Run the Svelte autofixer on every changed `.svelte` file until it reports no issues or suggestions.

## 6. Verification, specifications, and review

- [x] 6.1 During iteration run only directly affected API, server, and desktop tests/checks.
- [x] 6.2 Run the completion-scope full monorepo verification once, including server and desktop E2E.
- [x] 6.3 Perform a separate verification pass and replace `verification.md` with exact command/result evidence.
- [x] 6.4 Perform a separate code-review pass focused on auth bypass, token disclosure, cookie scope, fail-open behavior, RMS read-only access, migration safety, and renderer isolation.
- [x] 6.5 Merge verified deltas into `openspec/specs/rms-employee-identity`, `local-rms-schema-bootstrap`, and `workspace-architecture`; archive only after user acceptance.
