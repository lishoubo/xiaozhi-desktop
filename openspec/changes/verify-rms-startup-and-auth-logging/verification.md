# Verification

## Static and unit validation

- `npm run check --workspace @hotel-butler/server`: passed with 0 errors and 0 warnings.
- `npm run check:types --workspace @hotel-butler/desktop`: passed.
- Server and desktop lint passed with no findings.
- Targeted server resource/runtime tests: 5 passed across 2 files.
- Targeted desktop authentication and logging tests: 8 passed across 2 files.
- `git diff --check`: passed.

## Completion-state repository verification

The single repository-level `TRUST_STORES=nss npm run verify` run completed all workspace checks,
lint and unit suites:

- desktop unit: 93 files, 620 tests passed;
- server unit: 36 files, 170 tests passed;
- shared API unit: 2 files, 24 tests passed.

Its desktop E2E phase initially reported 8 failures after a common login helper could not request a
code. The new startup check ran before Playwright's MySQL fixture was ready, cached the transient
`ECONNREFUSED`, and kept health unavailable. This was a real lifecycle defect rather than an
unrelated flaky assertion. The full repository command stopped before server E2E, as expected.

After adding bounded retry and success caching:

- targeted desktop phone login E2E: 1 passed;
- server E2E: 8 passed;
- runtime recovery logs showed `rms.connection.failed` with `ECONNREFUSED`, followed by
  `rms.connection.verified`, successful `auth.requestPhoneCode`, and successful
  `auth.loginWithPhoneCode`;
- the remaining desktop E2E cases were not rerun because all eight initial failures shared the same
  verified login-helper root cause and repository rules prohibit repeating the full suite after a
  completion-state run.

## Production diagnosis

Read-only SSH inspection found:

- `/opt/hotel-butler/app/apps/server/.env.production`: `RMS_DATABASE_URL` missing;
- running server container environment: `RMS_DATABASE_URL` missing;
- running image: `hotel-butler-server:eda5fbe49047`, created on 2026-08-15;
- remote upload pointer: `hotel-butler-server-images-eda5fbe49047-linux-amd64.tar`;
- the later local production bundle containing the RMS configuration had not been uploaded.

The user confirmed that the local package step was followed by rerunning the remote deployment
without first running the upload script. Production remains unchanged pending explicit deployment
confirmation.

