# Design: Desktop phone OTP login API

## Context

`packages/api` owns the shared tRPC contract and currently injects `EmployeeIdentityDirectory` through `ApiContext`. `apps/server` owns the RMS implementation. The existing `identity.employeeByPhone` query returns safe fields, but it is public because the prior change deliberately deferred OTP and desktop sessions.

The SMS provider is unknown. Provider SDK types, credentials, error codes, and delivery receipts therefore must not enter the shared contract.

## Decisions

### 1. Model request and login as two mutations

The router adds:

- `auth.requestPhoneCode({ phone }) -> { accepted: true, expiresInSeconds }`
- `auth.loginWithPhoneCode({ phone, code }) -> EmployeeIdentity`

Both inputs use strict schemas. Phone numbers remain mainland-China 11-digit mobile numbers and codes are exactly six digits. Requesting a code is a mutation because it represents an external delivery side effect, even while the temporary implementation has no real side effect.

### 2. Inject a provider-neutral OTP gateway

`ApiContext` gains a `PhoneOtpGateway` port with `requestCode(phone)` and `verifyCode(phone, code)`. `packages/api` orchestrates validation, OTP verification, and identity lookup; `apps/server` injects the concrete implementation. The port returns only provider-neutral values needed by the contract.

The temporary server implementation returns a five-minute lifetime for every request and verifies every schema-valid six-digit code. It is named as temporary behavior and emits a warning without phone/code data when enabled rather than being disguised as real SMS delivery. Replacing it later changes only the server adapter and its configuration.

### 3. Do not reveal employee availability during code request

`requestPhoneCode` does not query RMS. The response is identical for every schema-valid phone. This avoids turning the delivery endpoint into an employee-directory oracle and keeps provider integration independent from employee lookup.

`loginWithPhoneCode` verifies OTP first, then reads the active RMS employee. A rejected code and a missing/disabled employee both throw `UNAUTHORIZED` with the same public message. The router does not log phone or code inputs.

Unexpected gateway or employee-directory failures are converted to fixed `INTERNAL_SERVER_ERROR` messages while retaining the original error as `cause` for server-side diagnostics. Provider/database messages are not returned as the public error message.

### 4. Remove the bypass query

`identity.employeeByPhone` is removed from the public router. The directory remains a context port used by the login mutation. This is an intentional shared API change: identity resolution becomes reachable only through the OTP-shaped flow.

### 5. Defer desktop sessions explicitly

Successful login returns `EmployeeIdentity`, matching the stable RMS identity boundary. No bearer token is issued because the repository has no agreed desktop authorization/session lifecycle yet. Pretending that a tokenless identity response is a durable server session would create a false security boundary. A later session change can consume the verified identity without changing SMS delivery.

## Alternatives considered

- Keep `identity.employeeByPhone` and add only a send endpoint: rejected because login could still bypass OTP.
- Hard-code `123456` in the router: rejected because provider replacement would require changing shared business logic and would preserve a test credential in production code.
- Add an OTP database table now: rejected because storage and verification semantics depend on the provider choice, and the user explicitly requested temporary success behavior.

## Risks and mitigations

- The temporary gateway permits any six-digit code, so login success can reveal whether an active employee phone exists and provides no authentication security. This explicitly accepted temporary behavior emits a warning and must be replaced before relying on OTP or releasing this flow as a production security control.
- No rate limiting is implemented before the provider is selected. The provider adapter or a provider-independent limiter must be designed before real SMS delivery to prevent cost abuse.
- No server desktop session exists. The returned identity proves only the result of this API call; follow-up protected APIs require a separate session/token design.

## Migration and rollback

There is no database migration. Deploy contract and server injection together. Rollback restores the prior router, but that also restores the public phone lookup and should be treated as a security regression.
