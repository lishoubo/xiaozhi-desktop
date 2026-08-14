# Verification: Production IP HTTPS

## Result

The production certificate, Compose configuration, generated environment and macOS arm64 desktop
package were verified. Static checks, lint, all unit tests and all non-live-dependency E2E tests
passed. Two live integration tests remain red because their external model/MCP dependencies returned
`unavailable`; neither failure involved TLS, ports, packaging or Compose configuration.

## Certificate and package evidence

- `npm run https:setup:production` generated a private CA and leaf certificate under ignored
  `output/production-tls/121.199.29.74/`.
- `openssl verify` returned `cert.pem: OK`; `openssl x509 -checkip 121.199.29.74` returned a match.
- Leaf validity: 2026-08-14 07:58:12 UTC through 2028-11-16 07:58:12 UTC.
- `npm run package:desktop:production` succeeded for `darwin-arm64`.
- The packaged ASAR contains `https://121.199.29.74:35443` and not the localhost default.
- The package resources contain only `private-ca.pem`; it is byte-identical to the generated public
  CA. No `.key` or additional `.pem` file was found in the package resources.

## Environment and port evidence

- `apps/server/.env.production` is Git-ignored and has mode `0600`.
- Safe-field inspection confirmed API origin `https://121.199.29.74:35443`, host port `35443`,
  PostgreSQL Compose port `35432`, and a `DATABASE_URL` targeting `db:35432`. The generated password
  was not printed.
- `npm run compose:prod:config` passed with the generated environment.
- Production Compose publishes the API on host TCP 35443 and PostgreSQL on host TCP 35432 for
  operator GUI access; the deployment firewall must restrict database source addresses.
- Resolved Compose inspection showed PostgreSQL command `postgres -p 35432`, database mapping
  `0.0.0.0:35432 -> 35432/tcp`, and server mapping `0.0.0.0:35443 -> 3443/tcp`.

## Automated checks

- `npm run verify`:
  - desktop/server Svelte checks and all TypeScript checks passed with zero diagnostics;
  - all workspace lint commands passed;
  - unit tests passed: desktop 503, server 151, shared API 24 (678 total);
  - desktop E2E: 8 passed, 1 failed because live model operation `classify_route` returned
    `AgentUpstreamError` / `unavailable` before the stop button could be asserted.
- Targeted retry of `opens the AI concierge from the icon sidebar`: failed with the same live model
  `classify_route` unavailable result; retries stopped per the test retry guard.
- `npm run test:e2e:server`: 7 passed, 1 failed because live DMS MCP operation
  `load_tool_catalog` returned `AgentUpstreamError` / `unavailable`.

The live-dependency failures are recorded as external verification limitations, not as passing
tests. No remote deployment, firewall mutation, release or publish command was executed.

## Code review pass

The separate code-review pass found no blocking issue. It confirmed that generated secrets and
private keys are ignored, the packaging wrapper copies only the public CA, generation refuses to
overwrite existing material, certificate checks fail closed, and the configured IP/ports are
consistent across the desktop build, environment template, Compose stack and stable specification.
`git diff --check` passed.

## Production distribution extension

- Added `npm run package:server:source`. It requires a clean worktree, archives only committed root
  npm files, `.dockerignore`, `apps/server/` and `packages/api/`, scans entries/content, and emits a
  SHA-256 sidecar under ignored `output/deploy/`.
- Git export inspection confirmed tracked `apps/server/.env` is excluded while
  `.env.production.example` remains available as a placeholder template.
- The packaging command refused the current dirty worktree as designed; no production archive was
  published before these changes are committed.
- Added the idempotent `prepare-production-host.sh`; `bash -n` passed and the file is executable.
  It was not run because it requires root and would create production host directories. `shellcheck`
  was unavailable in this environment.
- Focused archive/environment policy verification: 2 files, 6 tests passed.
- Server check and lint passed. Full server unit verification initially encountered sandbox
  `listen EPERM`; the permitted rerun passed 36 files and 154 tests.
- Environment audit compared key names only. Every production example key is consumed by production
  Compose, and development-only keys are consumed by local Compose, direct development startup or
  DMS configuration. No redundant setting was removed.
- A separate review moved archive staging under `output/deploy/` so final artifact renames remain
  atomic even when the operating-system temporary directory is on another filesystem.

## Production observability and single-upload bundle extension

- Server RMS identity lookup now emits `rms.http.request.started`, `.completed` and `.failed` with
  request ID, safe origin/path, operation, status/outcome and monotonic duration. Focused tests cover
  success, 401 and transport failure and prove Bearer values and identity fields are absent.
- Desktop auth and authenticated business fetch boundaries emit the same stable event family per
  HTTP attempt. A 401 retry shares one request ID and uses attempts 1 and 2; tests prove access tokens,
  login names and passwords are absent.
- Production Pino output is dual-written to stdout and
  `/var/log/hotel-butler/server/server.jsonl`. Compose uses Docker `local` rotation at 20 MiB × 5;
  host preparation installs a daily/50 MiB, 14-file compressed logrotate rule when available.
- Packaged desktop logs resolve through Electron's native logs path under `staff/` or `phone/`, use
  `main.log`, retain the existing 10 MiB `main.old.log` rotation and log the resolved file path.
- `npm run package:server:production` is the explicit sensitive bundle entry. Policy tests verify
  that it accepts only `.env.production`, server `ca.pem`, `cert.pem` and `key.pem` in addition to the
  allowlisted source, and rejects placeholders, missing required values and unexpected private files.
- The runtime bundle itself was not emitted: the worktree is intentionally dirty until these changes
  are committed, and the current ignored `.env.production` still has a placeholder
  `XIAOZHI_RMS_SERVER_URL`. Both conditions are fail-closed guards, not reported as passing.
- Latest verification: server check and desktop check passed with zero diagnostics; both workspace
  lint commands passed; server unit tests passed 36 files / 159 tests on the permitted rerun; desktop
  unit tests passed 87 files / 506 tests; Compose config parsing, Bash syntax, focused Prettier and
  `git diff --check` passed.

## Latest code-review pass

The separate review found no blocking issue. It confirmed that remote-call logs contain only
allow-listed operational metadata, desktop paths are delegated to Electron rather than hard-coded,
the two auth profiles cannot share a log file, server file logs remain available independently of
Docker logs, and the sensitive bundle excludes the CA signing key. It also corrected time measurement
to a monotonic clock and uses logrotate `maxsize` alongside `daily` so both thresholds are effective.
