# Verification

Date: 2026-08-06

## Completion result

The affected API, server, RMS bootstrap, migration and management-backend scopes are verified. The repository-wide completion command did not finish cleanly because two unrelated desktop Electron E2E scenarios failed; all checks, lint scopes, unit/component suites and the complete server E2E suite have evidence below.

## TDD and focused evidence

- `npm run test:unit --workspace @hotel-butler/api -- src/router.test.ts`
  - Red: 2 tests failed because `identity.employeeByPhone` did not exist.
  - Green: 3 tests passed.
- `npm run test:unit --workspace @hotel-butler/server -- src/lib/server/employee-identity-directory.test.ts`
  - Red: 2 tests failed with the intentional “not implemented” result.
  - Green: 2 tests passed.
- `npm run test:unit --workspace @hotel-butler/server -- src/lib/server/local-rms-schema-bootstrap.test.ts`
  - Red: local Compose did not contain the initialization mount.
  - Green: 1 test passed.
- `TRUST_STORES=nss npm run test:e2e --workspace @hotel-butler/server -- src/routes/admin/dashboard-page.svelte.e2e.ts`
  - Red: the “桌面用户管理” link still existed.
  - Green: 1 test passed after removal.
- `TRUST_STORES=nss npm run test:e2e --workspace @hotel-butler/server -- src/routes/api/trpc/trpc.e2e.ts`
  - Initial test-harness failures exposed POST/query wire-format mistakes and a stale `rms_test` webServer database name. Root-cause analysis changed the test to the actual tRPC v11 GET encoding and aligned the webServer with the fresh `rms` schema.
  - Final focused result: 2 tests passed, including safe employee identity from a MySQL container initialized with `rms-schema.sql`.
- `npm run check:server`: 0 errors and 0 warnings.
- Svelte autofixer on `src/routes/admin/+layout.svelte` and `src/routes/admin/+page.svelte`: 0 issues and 0 suggestions for both files.

## Completion-scope evidence

- `TRUST_STORES=nss npm run verify`
  - All workspace type/Svelte checks passed.
  - Desktop and server lint passed.
  - API lint stopped the command on a type-only interface parameter `no-unused-vars` error before tests began.
- After adding the same documented type-contract lint exemption already used by the logger contract, `npm run lint --workspace @hotel-butler/api` passed.
- `TRUST_STORES=nss npm run test:all`
  - Desktop unit: 37 files, 187 tests passed.
  - Server unit: 12 files, 23 tests passed.
  - API unit: 1 file, 3 tests passed.
  - Desktop component: 12 files, 52 tests passed.
  - Desktop E2E: 5 passed, 2 failed. The unrelated failures were:
    - `opens the localized calendar with the seeded holiday group`: expected the 2026-08-15 complementary schedule panel, but it was not found.
    - `navigates between the browser workspace and settings`: timed out waiting to click “导入 Cookie”.
  - Because desktop E2E failed, the root script did not reach server E2E.
- `TRUST_STORES=nss npm run test:e2e:server`
  - Complete server E2E: 5 tests passed.
  - Covered administrator login/dashboard, absence of desktop-user management, HTTPS request correlation, fresh RMS employee identity query and isolated PostgreSQL/MySQL connectivity.

## Independent verification pass

- `openspec validate use-rms-employee-identity --strict`: valid.
- `git diff --check`: no whitespace errors.
- Local Compose contains only the read-only mount `./rms-schema.sql:/docker-entrypoint-initdb.d/001-rms-schema.sql:ro`; production Compose contains neither `rms-schema.sql` nor `/docker-entrypoint-initdb.d`.
- Migration `0003_curved_wendigo.sql` contains only `DROP TABLE "desktop_user";`; code review removed Drizzle's generated `CASCADE` so unexpected external dependencies fail explicitly instead of being deleted.
- Snapshot `0003_snapshot.json` contains no `desktop_user` and retains `admin_user`, `admin_session`, `admin_account` and `admin_verification`.
- Production employee lookup selects only `id`, `org_id`, `username`, `full_name`, `phone`, and `role_code`; no production API/server source selects or returns `password_hash`.
- Employee IDs and org IDs are validated and transported as decimal strings; the real E2E fixture confirms MySQL bigint string mapping.

## Known limitation

`identity.employeeByPhone` is temporarily public because phone OTP/session validation is not implemented and the requirement treats OTP as passed. It returns only safe fields and returns `null` for missing or disabled employees. Before production desktop authentication uses this route, OTP proof or an authenticated desktop context must guard the lookup.

## Independent code-review pass

Reviewed separately after verification for scope, architecture, privacy, SQL safety, migration blast radius, Better Auth preservation, Svelte accessibility and regression coverage.

- Fixed one migration safety finding: replaced generated `DROP TABLE "desktop_user" CASCADE` with `DROP TABLE "desktop_user"` so unexpected dependencies stop the migration.
- Confirmed shared API code depends only on the `EmployeeIdentityDirectory` port; MySQL implementation remains in server and desktop does not import server implementation.
- Confirmed the RMS query is parameterized, read-only, active-only, deterministic for duplicate phone data and excludes password fields.
- Confirmed PostgreSQL administrator models and layout-level administrator guard remain intact.
- Confirmed production Compose has no RMS initialization service or dump mount.
- Confirmed removed management routes/services have no runtime references; the sole remaining `desktop_user` runtime check is the Compose assertion that the table is absent.
- Confirmed changed Svelte pages have semantic headings/section labels, preserve sign-out and mobile navigation, and passed Svelte autofixer.
- No unresolved high- or medium-severity review findings remain. The temporary public-OTP limitation is explicitly accepted for this iteration and documented above.
