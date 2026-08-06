## 1. Contract and RMS identity query (TDD)

- [x] 1.1 Extend focused `packages/api` router tests first to require validated phone input, safe employee output, active employee lookup, and `null` for unavailable identity; confirm Red.
- [x] 1.2 Add a focused server unit test first for parameterized active-employee lookup and safe row mapping; confirm Red.
- [x] 1.3 Implement shared `EmployeeIdentity` schemas/context port and the server RMS employee directory; inject it into the SvelteKit tRPC handler and make focused tests Green.

## 2. Local RMS schema bootstrap (TDD / integration)

- [x] 2.1 Add a focused compose/config assertion that local RMS mounts `rms-schema.sql` into MySQL's initialization directory while production Compose does not.
- [x] 2.2 Update local Compose and E2E MySQL setup to initialize from the same dump only on a fresh data directory, then seed one active employee fixture for API verification.
- [x] 2.3 Add a focused API E2E scenario proving the employee query returns the safe RMS identity and never returns `password_hash`.

## 3. Remove PostgreSQL desktop-user management

- [x] 3.1 Remove `desktop_user` from the Drizzle schema and generate a forward migration that drops only that table.
- [x] 3.2 Remove the desktop-user query/status service, admin route, navigation entry, user-centric Dashboard loader/view, and obsolete tests.
- [x] 3.3 Replace the Dashboard with a non-user management landing page while preserving administrator authentication and sign-out.

## 4. Focused verification during implementation

- [x] 4.1 Run the smallest affected API, server, desktop and Svelte checks after each Red/Green step; do not run full suites during iteration.
- [x] 4.2 Run Svelte autofixer on every changed `.svelte` file until it reports no issues or suggestions.
- [x] 4.3 Validate the OpenSpec change strictly and run migration/schema consistency checks.

## 5. Completion gates

- [x] 5.1 Run the repository completion-scope verification once and record exact commands/results in `verification.md`.
- [x] 5.2 Perform a separate verification pass covering fresh-vs-existing RMS initialization, API privacy, migration scope and administrator login preservation; record evidence.
- [x] 5.3 Perform a separate code-review pass covering architecture, security, TypeScript, Svelte accessibility and regressions; record findings.
- [x] 5.4 Merge the verified delta into `openspec/specs/` and archive the completed change only after all gates pass.
