# Verification

## Feature evidence

- Svelte autofixer: `AgentPage.svelte` reported no issues or suggestions.
- Type checks: API, desktop and server passed; Svelte reported 0 errors and 0 warnings.
- Lint: API, desktop and server passed.
- Focused unit tests passed:
  - active Run event projection: 3 tests;
  - desktop conversation state isolation/recovery: 2 tests;
  - Electron Agent subscription replacement/recovery: 2 tests;
  - API contract/router: 16 tests.
- Focused desktop E2E passed: a Run remained marked `运行中` after switching to a new
  conversation, became selectable again, and stopped only after the explicit Stop action.
- Focused server conversation-contract E2E passed.

## Full repository gate

`TRUST_STORES=nss npm run verify` was run once as the completion gate.

- checks and lint passed;
- desktop unit tests: 76 files / 421 tests passed;
- server unit tests: 25 files / 89 tests passed;
- API unit tests: 1 file / 16 tests passed;
- desktop E2E: 8 tests passed, including Agent switching and calendar coverage;
- server E2E: 7 tests passed and 1 real-model test failed.

The remaining failure is `data-agent.e2e.ts`: the external model returned a completed answer without
calling the SQL MCP tool required by that test, leaving both tool-event lists empty. Two focused
retries explored model-side tool forcing; the final retry reached LangChain's recursion limit. The
experimental routing changes were removed, and the retry fuse was observed. This failure is outside
the conversation-switch lifecycle and does not invalidate its focused evidence, but the repository's
full gate is not green.
