# Design: Complete desktop phone OTP login

## Context

`packages/api` owns the shared tRPC contract. `apps/server` connects to PostgreSQL for system-owned data and to read-only RMS MySQL for employee identity. `apps/desktop` already has a main-process tRPC client, but its renderer login is a fixed mock and the client is not composed into the application.

The server's administrator authentication remains a separate Better Auth model backed by PostgreSQL. Desktop employee identity must continue to come from RMS without a PostgreSQL profile copy.

## Decisions

### 1. Keep OTP provider-neutral and explicitly temporary

The existing procedures remain:

- `auth.requestPhoneCode({ phone }) -> { accepted: true, expiresInSeconds }`
- `auth.loginWithPhoneCode({ phone, code }) -> EmployeeIdentity`

The injected temporary gateway accepts every schema-valid six-digit code and reports a five-minute lifetime. `requestPhoneCode` does not disclose employee existence. Login verifies the OTP shape first and then requires an active RMS employee. Missing and disabled employees use the same unauthenticated response.

### 2. Use a server-side opaque session

Successful login creates 32 random bytes encoded as base64url. The raw token exists only in the response cookie. PostgreSQL stores a `desktop_session` row containing:

- random session ID;
- SHA-256 token digest with a unique constraint;
- RMS employee ID as a decimal string, without a PostgreSQL employee foreign key;
- creation and expiry timestamps.

Sessions expire after seven days. Validation hashes the presented token, loads an unexpired row, then queries RMS by employee ID and active status. A missing/disabled RMS employee invalidates and deletes the session. This preserves RMS as the identity source while allowing server-side expiry and revocation.

The shared context exposes a transport-neutral `DesktopSessionGateway`; provider, SQL, cookie parsing, and response-header details stay in `apps/server`.

### 3. Use a hardened host cookie

The server sets:

`__Host-xiaozhi_desktop_session=<opaque>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`

The `__Host-` prefix forbids a `Domain` attribute and scopes the cookie to the HTTPS API host. Logout deletes the server row and returns the same cookie with `Max-Age=0`. Invalid or expired tokens are also cleared. Authentication inputs and cookie values are never logged.

The tRPC router adds:

- `auth.currentSession -> EmployeeIdentity | null`
- `auth.logout -> { success: true }`

`loginWithPhoneCode` still returns only the safe employee identity; session issuance is a context side effect expressed through the gateway.

### 4. Keep credentials out of renderer storage

Desktop creates a dedicated persistent Electron partition for the server API. Its `Session.fetch` implementation is injected into the typed tRPC client with `credentials: 'include'`, so Chromium handles `Set-Cookie` and subsequent cookie attachment. The existing Electron fuse enabling cookie encryption remains the at-rest protection.

Renderer calls only a narrow preload API:

- `auth.requestPhoneCode(phone)`
- `auth.loginWithPhoneCode(phone, code)`
- `auth.currentSession()`
- `auth.logout()`

IPC validates inputs and outputs at both boundaries. The preload returns safe employee identity only. Renderer no longer reads or writes `hotel-butler.auth-session` and cannot access the cookie token.

The main process reads the API origin from `HOTEL_BUTLER_SERVER_URL`, defaulting to the local HTTPS server origin for development. The value must be HTTPS and packaged production launches must provide the production origin in their environment.

### 5. Restore and logout behavior

At application startup, renderer asks main for `currentSession`. It shows a bounded loading state until validation finishes, then renders either the application shell or login page. Network/server failure is not treated as an authenticated session; the user sees a retryable login error.

Request-code and login buttons remain disabled while their requests are in flight. The countdown begins from the server-provided lifetime only after the request succeeds. Login errors use fixed user-facing messages and do not surface raw transport details.

Logout first attempts server revocation and always clears the dedicated Electron API cookie locally in a `finally` path. OTA partitions are deliberately untouched because app identity and OTA identity have independent lifecycles.

### 6. Seed one local RMS experience employee

The checked-in `apps/server/rms-schema.sql` adds one active employee row after the `employee` table definition. It uses deterministic non-production data:

- phone: `13800138000`;
- username: `desktop-demo`;
- full name: `桌面体验员工`;
- role: `FRONT_DESK`;
- organization ID: `42`.

The password hash is an unused placeholder because phone OTP never reads it. The desktop experience hint shows this phone and states that any six-digit code is accepted during the temporary-provider phase. Server E2E uses the schema-provided row instead of inserting a separate fixture.

### 7. TDD and migration

Observable changes follow focused Red → Green cycles across shared contract, server session store/gateway, desktop IPC/preload/renderer, and RMS bootstrap tests. A forward Drizzle migration creates only `desktop_session`; it does not modify Better Auth administrator tables.

After verification, merge deltas into `rms-employee-identity`, `local-rms-schema-bootstrap`, and `workspace-architecture` stable capabilities before archiving.

## Risks and mitigations

- Any six-digit code currently succeeds: clearly labeled temporary behavior, isolated behind `PhoneOtpGateway`, and not presented as production OTP security.
- Stolen raw session tokens grant access until expiry: raw tokens are never stored server-side or exposed to renderer; cookie is Secure/HttpOnly/Strict and Electron cookie encryption is enabled.
- RMS becomes unavailable during validation: fail closed and keep the server error generic.
- A packaged build points at the wrong origin: validate HTTPS at application startup and require the production build variable in packaging/release documentation.
- Logout cannot reach the server: delete the local cookie regardless; the unreachable server-side row expires naturally.

## Rollback

Rollback can stop desktop from using the new procedures and remove the application code, but the additive `desktop_session` table may remain safely. Do not restore renderer self-asserted localStorage authentication as a production fallback.
