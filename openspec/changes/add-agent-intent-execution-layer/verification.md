# Verification

## Scope

Verified the shared Agent contract, PostgreSQL migration, persisted business-execution state machine,
routing and slot policies, constrained MCP workflow, evidence gate, tRPC/SSE projection, Electron
IPC/preload bridge and deterministic clarification UI.

## Automated evidence

- `npm run verify` reached and passed all workspace checks, all workspace lint tasks and all unit
  suites: desktop 76 files / 423 tests, server 29 files / 106 tests, API 2 files / 22 tests.
- That completion run initially stopped before desktop E2E because restart recovery performed a
  PostgreSQL query while SvelteKit was building and the E2E database was not yet listening. The
  recovery was moved to a single lazy Gateway operation; no build-time database I/O remains.
- After the fix, `npm run build:server` passed without an available E2E PostgreSQL connection.
- `npm run test:e2e:server -- src/routes/api/trpc/trpc.e2e.ts` passed 4/4, including migration-backed
  conversation loading, owned cancellation, repeated cancellation and starting a later Run after
  the cancelled business execution releases the one-active constraint.
- `npm run test:e2e --workspace @hotel-butler/desktop -- --grep "opens the AI concierge"` passed
  1/1, covering the Agent page, desktop bridge, conversation persistence, cancellation and later Run.
- Focused new/changed suites passed for contract schemas, router policy, state transitions, choice
  membership, date normalization, evidence assessment, workflow allowlists, MCP filtering, Agent
  service/preload and renderer hydration.
- `openspec validate add-agent-intent-execution-layer --strict --no-interactive` passed.
- The synchronized stable specs `hotel-agent-business-execution`, `hotel-agent-runtime` and
  `hotel-data-agent` each passed strict validation. A repository-wide `openspec validate --all`
  still reports 11 pre-existing unrelated invalid changes/specs; this change and its three affected
  stable specs are not among them.
- Svelte autofixer ran on `AgentPage.svelte` and `AgentClarificationCard.svelte` with no reported
  issues or suggestions.
- `git diff --check` passed.

## Independent verification pass

The following behaviors were reviewed separately from the implementation pass:

- ownership is derived from session principal; execution and interaction mutations accept no owner;
- clarification uses interaction ID, expected CAS version, expiry and server-owned field/choice checks;
- one conversation has at most one non-terminal execution;
- cancelling or failing a Run terminates the linked execution in the same transaction;
- waiting clarification survives renderer/server restart, while an orphaned active Run becomes a
  retryable failure and its unknown tool stack is not replayed;
- explicit write wording is denied before MCP and write-like MCP tools cannot be enabled by config;
- unknown safe business reads route to the generic registered workflow;
- business data collection and final answering are separate runtime phases: the collection phase
  streams no model text/UI, evidence is validated, and the answer phase has no MCP data tools;
- product clarification cards are independent from generative UI and restore from conversation state.

Findings fixed during this pass:

1. Run cancellation originally left the linked execution active and blocked the next request.
2. restart recovery originally performed database I/O at build time.
3. structured hotel/date-range clarification originally returned to candidate state and could loop.
4. workflow text originally existed before evidence assessment; the runtime is now split into
   collection and post-validation answer phases.

No remaining blocking correctness or security finding was identified in the reviewed scope.

## Code-review pass

Reviewed contract strictness, cross-workspace boundaries, state transition legality, transaction and
CAS consistency, log privacy, tool allowlists/budgets, evidence/UI separation, Svelte accessibility
labels and legacy nullable associations. The implementation keeps server details out of
`packages/api`, keeps renderer access behind preload and removes the obsolete write-tool toggle.

## Limitations

- The credential-dependent natural-language `data-agent.e2e.ts` was not run because this environment
  does not provide real Kimi and Aliyun DMS credentials. Therefore live model structured-output
  compatibility and real external MCP response shapes remain deployment-environment verification.
- The original full `npm run verify` was not repeated after its E2E startup failure, in accordance
  with the repository rule to run the completion-state full suite once. The directly affected server
  and desktop E2E paths, build, checks, lint, unit tests, OpenSpec validation and diff check were run
  after the fix as recorded above.
