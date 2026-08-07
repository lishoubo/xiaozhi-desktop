# Verification: Complete desktop phone OTP login

Date: 2026-08-07

## Completion evidence

- `npm run verify`
  - workspace checks passed: desktop TypeScript and Svelte reported 0 errors/0 warnings; server Svelte reported 0 errors/0 warnings; API TypeScript passed.
  - the first completion run stopped at desktop lint because the legacy import resolver did not understand the new workspace subpath and one Playwright fixture used an empty pattern. Both static issues were corrected before tests continued.
- `npm run lint --workspace @hotel-butler/desktop`: passed after the corrections. Server and API lint had already passed in the workspace lint run.
- `npm run test:all`
  - desktop unit: 49 files, 247 tests passed.
  - API unit: 1 file, 10 tests passed.
  - server assertions passed, but the sandbox denied Vitest's `::1` listener with `EPERM`; the server stage was rerun outside that network sandbox only.
- `npm run test:unit:server`: 14 files, 33 tests passed.
- `npm run test:component`: 12 files, 46 tests passed.
- `npm run test:e2e`: desktop 8 tests passed against the real HTTPS server and isolated PostgreSQL/MySQL containers; server 5 tests passed.

## Authentication and cookie evidence

- Desktop E2E logged in through renderer → preload → trusted IPC → main tRPC client → server using `13800138000` and a six-digit code.
- Electron's dedicated persistent API partition contained exactly one `__Host-xiaozhi_desktop_session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and persistent expiry; renderer restored the safe RMS employee identity through `currentSession`.
- Server E2E verified `Path=/`, no `Domain`, `Max-Age=604800`, current-session restoration, logout clearing with `Max-Age=0`, and rejection of the revoked session.
- Unit tests verified SHA-256 digest-only persistence, expiry, malformed/missing cookies, RMS-disabled employees, local-cookie cleanup after failed remote logout, and absence of raw token persistence.

## Independent review

Reviewed auth bypass, token disclosure, cookie scope, fail-open behavior, RMS read-only access, migration isolation, and renderer isolation. The review found and corrected one preload boundary defect: runtime schemas now come from `@hotel-butler/api/contracts`, so preload no longer evaluates or bundles the server router. No unresolved high- or medium-severity findings remain.
