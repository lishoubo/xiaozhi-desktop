# Verification: Desktop phone OTP login API

## Outcome

The shared contract, server adapter, context injection, error-safety behavior, and HTTPS tRPC-to-RMS path are verified. Independent verification found no acceptance mismatch. Independent code review found three security concerns; raw dependency errors and missing auth-log assertions were fixed, while unconditional temporary-code acceptance remains an explicitly accepted product requirement and release risk.

## TDD evidence

- Shared contract Red: `npm run test:unit --workspace @hotel-butler/api -- src/router.test.ts`
  - Health remained Green; four new auth behaviors failed because the procedures did not exist.
- Temporary adapter Red: `npm run test:unit --workspace @hotel-butler/server -- src/lib/server/temporary-phone-otp-gateway.test.ts`
  - Failed because the adapter module did not exist.
- Initial focused Green:
  - API router: 5 tests passed.
  - Temporary adapter: 1 test passed.
- Review-hardening Red:
  - API test failed because a provider exception exposed its original message.
  - Adapter test failed because enabling the insecure temporary gateway emitted no warning.
- Review-hardening focused Green:
  - API router: 7 tests passed.
  - Temporary adapter: 1 test passed.

## Final automated verification

- `npm run check --workspace @hotel-butler/api`: passed.
- `npm run lint --workspace @hotel-butler/api`: passed.
- `npm run test:unit --workspace @hotel-butler/api`: 1 file, 7 tests passed.
- `npm run check --workspace @hotel-butler/server`: 0 errors and 0 warnings.
- `npm run lint --workspace @hotel-butler/server`: passed.
- `npm run test:unit --workspace @hotel-butler/server`: 13 files, 24 tests passed outside the sandbox.
  - The preceding sandboxed run executed 23 tests successfully but ended with a Vitest browser-helper `listen EPERM` and did not collect one file; it is recorded as an environment failure, not a passing suite.
- `npm run https:setup`: local HTTPS ready; certificate valid until 2028-11-06.
- `TRUST_STORES=nss npm run test:e2e --workspace @hotel-butler/server`: 5 tests passed.
  - The auth E2E requests a code, logs in with the arbitrary six-digit code `654321`, resolves the active RMS fixture, and confirms password/code data is absent from the response.
  - The production build/preview log contains the provider-free temporary-gateway warning and only allow-listed tRPC procedure metadata; it does not log phone or code inputs.
  - An earlier sandboxed attempt built successfully but could not bind `::1:4173` (`EPERM`) and never entered test execution; the same command was rerun outside the sandbox.
- `git diff --check`: passed after review hardening and specification merge.

## Behavior and security evidence

- Requesting a code does not query RMS and always returns `{ accepted: true, expiresInSeconds: 300 }` for schema-valid phones.
- OTP verification occurs before the employee lookup; a rejected OTP does not query RMS.
- Rejected OTP and unavailable/disabled employee use the same `UNAUTHORIZED` code and message.
- Gateway and employee-directory exceptions return fixed public server-error messages and preserve the original exception only as `cause`.
- Successful auth procedure log assertions prove phone and code inputs are absent.
- The direct public `identity.employeeByPhone` router is removed.
- No database migration is introduced; RMS access remains parameterized and read-only.

## Independent passes

- Verification: passed; no functional blocker or acceptance mismatch.
- Code review: raw dependency error exposure and missing auth-log coverage were fixed. The reviewer-confirmed remaining risk is the intentional always-pass gateway described below.

## Accepted temporary limitations

- No SMS is sent. Every schema-valid six-digit code succeeds.
- Because verification always succeeds, login outcomes can currently reveal whether a phone belongs to an active employee and must not be treated as production authentication.
- There is no rate limiting and no desktop access/refresh token or server-side desktop session.
- The desktop renderer still uses its existing local mock; desktop UI/preload/IPC integration is outside this server-interface change.
- Before production relies on this flow, replace the temporary gateway, add abuse controls, and design the desktop session/token lifecycle.
