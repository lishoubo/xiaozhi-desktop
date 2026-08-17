# Verification

## Production profile gate

- `XIAOZHI_ALLOW_INSECURE_RMS=1 npm run check:desktop:production:phone` — passed; selected
  `phone` and validated the configured production backend, RMS origin, and packaged private CA.
- Running the same command without the override rejected the currently configured HTTP RMS origin as
  intended.
- No package, distribution artifact, upload, publish, or deployment command was run.

## Focused test

- `npm run test:unit --workspace @hotel-butler/desktop -- tests/unit/build/package-production.test.ts`
  — 1 file, 4 tests passed. Coverage includes the staff default, phone selection, Forge argument
  forwarding, invalid variants, duplicate variants, and invalid actions.

## Completion gate

- `TRUST_STORES=nss npm run verify` — passed.
- TypeScript and Svelte checks passed for desktop, server, and API; Svelte reported 0 errors and
  0 warnings in both applications.
- ESLint passed for desktop, server, and API.
- Unit tests: desktop 93 files / 618 tests, server 36 files / 169 tests, API 2 files / 24 tests.
- E2E: desktop 9 tests, server 8 tests. Phone-code login and the real LLM/DMS hotel-data test passed.

## Unavailable validation

- OpenSpec CLI validation was not run because `node_modules/.bin/openspec` is not installed in this
  repository. The required artifacts and delta spec were still created in the standard change path.
