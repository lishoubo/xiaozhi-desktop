# Verification: Register Agent workflow handlers

## Scope

Verified the server-internal refactor from centralized intent conditionals to versioned workflow-ID
handler dispatch. No desktop contract, persistence schema, deployment configuration or external
service behavior changed.

## Implementation evidence

- `BusinessWorkflowRegistry` resolves every current intent through its declared `workflowId` and
  rejects missing, duplicate, mismatched and unreferenced handlers.
- Four handlers own the current operating-summary, generic hotel-data, public-rate and weather
  collection plans. They expose explicit evidence-assessment and deterministic-presentation
  methods.
- The collection executor retains capability filtering, MCP lifecycle events, timeouts, bounded
  stale-connection recovery and error conversion.
- `HotelAgentGateway` no longer imports the shared evidence assessor or intent-specific
  deterministic answer builders; it invokes the same resolved workflow boundary for validation and
  presentation.
- Structural search found no intent equality branch or direct deterministic answer-builder probe in
  the gateway or collection executor.

## Verification pass

- Focused workflow, gateway, evidence, routing and presentation tests: 7 files, 69 tests passed.
- Server completion unit gate: 47 files, 252 tests passed.
- `npm run lint --workspace @hotel-butler/server`: passed.
- `npm run check --workspace @hotel-butler/server`: passed with 0 errors and 0 warnings.
- `openspec validate register-agent-workflow-handlers --strict --no-interactive`: passed.
- `openspec validate hotel-agent-business-execution --strict --no-interactive`: passed after the
  stable specification was synchronized.
- `git diff --check` and Prettier checks for all changed code/specification files: passed.

## Code-review pass

No blocking findings.

- The registry validates complete one-to-one definition coverage during server composition.
- Workflow handlers cannot broaden the capability allowlist because tool loading remains in the
  shared executor and is derived from the server-owned intent definition.
- Existing direct SQL, generic Agent fallback, compatible public-rate selection and weather fallback
  behaviors remain covered by the pre-existing collector tests.
- Evidence normalization remains a shared security boundary; each workflow now owns the assessment
  entry point and may replace the default policy later.
- The gateway continues to own durable lifecycle, retry, cancellation and answer persistence, so no
  second state machine or framework was introduced.

## Operational note

No production packaging, deployment, restart or live DMS request was performed for this refactor.
