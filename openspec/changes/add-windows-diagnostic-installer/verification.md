# Verification

## Focused checks

- `node --test scripts/tests/windows-install-diagnostic.test.mjs`: 2 passed locally, 1 Windows-only smoke test skipped on macOS. This tests generation beside an unchanged Setup.exe, the generated filename/content, and failure when Setup.exe is missing. The exact installer-name assertion was first observed failing against the wildcard implementation, then passed after the fix. The Windows workflow now runs the native CMD/PowerShell smoke test before packaging.
- `node --check scripts/desktop-make.mjs` and `node --check scripts/create-windows-install-diagnostic.mjs`: passed.
- `prettier --check` on the touched JavaScript and workflow files: passed.
- Ruby YAML parse of `.github/workflows/build-windows.yml`: passed.
- `openspec validate add-windows-diagnostic-installer --strict`: passed.
- `git diff --check`: passed.

## Completion check

- `npm run verify`: stopped during `@hotel-butler/server` `check`; `svelte-check` could not resolve `node-sql-parser/build/mysql.js` in `apps/server/src/lib/server/agent/hotel-data-sql-policy.ts`. Desktop type and Svelte checks had already passed (0 errors, 0 warnings). Because the command stopped there, it did not run root lint or `test:all`.

## Independent review

- A separate reviewer found that wildcard Setup.exe selection could run an installer for another environment, and that `cd /d` would fail for a UNC path. Both were fixed by deriving the exact Setup.exe path from the diagnostic script's filename and using `%~dp0` directly. The reviewer rechecked the updated files and found no remaining clear P1/P2 issue.

## Remaining runtime validation

- The Windows batch file and dialog have not been run on Windows in this macOS workspace. The next Windows workflow run will exercise CMD parsing and the bundled PowerShell/Windows Forms dependency, but a local Windows machine is still needed for one end-to-end smoke run of the `.cmd` beside Setup.exe, including a failed installation case.
- The existing 1.0.6 output directory now contains the regenerated `小智酒店管家-1.0.6-diagnostic-install.cmd` beside Setup.exe; `file` identified it as ASCII DOS batch text with CRLF endings. Setup.exe retained SHA-256 `fbdb7c7b0fc5d1dcbcd248490bba09f5567cbd3f464cdab74b5a040ea02f0270`.
