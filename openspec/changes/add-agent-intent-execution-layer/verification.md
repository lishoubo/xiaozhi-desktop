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

## 2026-08-18 dev post-merge verification

This pass revalidated the merged `dev` branch and the later corrections without repeating the
completion-state full suite.

- `npm run verify` was run once. All workspace checks and lint tasks passed. Unit results were
  desktop 652/653, server 40 files / 205 tests and API 2 files / 25 tests. The sole desktop failure
  was a stale assertion that still expected the intentionally configured temporary `online` RMS
  origin to be absent; the suite stopped before E2E.
- After aligning that assertion with the documented environment profile,
  `apps/desktop/tests/unit/main/app-env.test.ts` passed 13/13.
- The desktop E2E completion run passed 6/9. The three failures were stale cross-month calendar and
  single-managed-hotel clarification expectations, plus a real follow-latest regression after a
  cancelled Run reloaded the conversation. After correction, all three failed paths passed targeted
  reruns (calendar 1/1, quick action 1/1 and conversation scrolling 1/1).
- `TRUST_STORES=nss npm run test:e2e:server` passed 8/8, including real RMS authentication, Agent
  ownership/retry/cancellation and the credential-backed seven-day DMS/model quick-action flow.
- Focused regression suites passed for the retained failure boundary: API contract 6/6, server
  execution trace 6/6 and desktop conversation state 4/4.
- Final `npm run check:desktop` passed with 0 Svelte errors and 0 warnings; final
  `npm run lint:desktop` and `git diff --check` passed.
- Strict OpenSpec validation passed for `hotel-data-agent`, `hotel-agent-business-execution`,
  `hotel-agent-runtime` and `desktop-build-environments`.

Findings fixed during this pass:

1. When optional upstream analysis streamed partial text and then failed, the live renderer retained
   the incomplete model text even though restored conversation state correctly retained only the
   validated deterministic result. The active-run contract now carries an explicit retained-content
   boundary and live/restored failure behavior is consistent.
2. Conversation reload after cancellation could disable follow-latest while content height changed,
   leaving the user above the newest message. Reload now preserves the user's pre-reload follow state.
3. Desktop E2E expectations and the build-environment test/spec had drifted from the merged
   single-managed-hotel and temporary `online` environment behavior.

The verification pass found no remaining blocking correctness or security issue in the merged scope.

## 2026-08-18 dev post-merge code-review pass

Reviewed the final diff separately after verification. The new active-Run field is represented
consistently in the strict shared schema, server event projection and desktop live/hydrated state.
The failure boundary is captured once at the first upstream-analysis event, so later partial deltas
cannot replace validated content. The cancellation scroll correction restores follow-latest only
when the user was already following and therefore does not pull a user away from history reading.
Managed-hotel authorization remains server-derived and the updated E2E coverage no longer encodes
the obsolete clarification behavior. No remaining blocking review finding was identified.

## Limitations

- The 2026-08-18 full `npm run verify` was not repeated after its stale desktop unit assertion, in
  accordance with the repository rule to run the completion-state full suite once. The failing unit
  path, all three failing desktop E2E paths, the complete server E2E suite, final desktop static
  checks, affected specifications and whitespace checks were run after their fixes as recorded above.
