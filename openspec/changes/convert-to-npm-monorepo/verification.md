# Verification

Date: 2026-08-05

## Passed

- `npm install --ignore-scripts`: generated one root workspace lockfile.
- `npm ls --workspaces --depth=0`: resolved desktop, server, and API workspaces.
- `npm run check`: desktop TypeScript/Svelte, server SvelteKit, and API TypeScript passed.
- `npm run lint`: all three workspaces passed.
- `npm run db:validate`: desktop calendar database tests passed (4 tests).
- API unit tests passed (1 test); desktop unit tests passed (178 tests).
- Server unit tests passed (2 tests); server Playwright E2E passed (2 tests).
- Desktop E2E build completed for renderer, main, and preload; 6 of 7 E2E tests passed.
- `npm run package:desktop`: Electron arm64 macOS packaging passed after rerunning outside the network-restricted sandbox.
- `git diff --check`: passed.
- Exactly one non-`node_modules` `package-lock.json` exists at the repository root.

## Existing failing gates

- Desktop component suite: `BrowserWorkspace.test.ts` has 7 failures and 6 passes. A focused rerun reproduced dialog cleanup leaving `body` with `pointer-events: none`; the component and test were moved without content changes.
- Desktop E2E: the localized calendar test expects `2026年8月`, while the rendered mini-calendar reports `2026年9月`; the other 6 E2E tests pass.
- Desktop format check reports 27 pre-existing files that do not match the existing Prettier configuration. New files were formatted; unrelated source files were not rewritten.

No failing check was hidden or reported as passing.
