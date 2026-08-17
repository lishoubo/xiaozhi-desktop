## 1. Shared contracts and persistence schema

- [ ] 1.1 Add failing API contract tests, then define strict schemas for business-execution status,
  slot summaries, clarification fields, pending interaction, conversation projection and replayable
  business-execution events; keep the existing Run execution trace as a separate type.
- [ ] 1.2 Add failing contract tests, then define strict structured/free-text clarification submission
  and waiting-execution cancellation inputs without client-supplied owner fields.
- [ ] 1.3 Add Drizzle schema and migration for `agent_business_execution`, its append-only event table,
  the one-active-execution constraint and nullable business-execution links on messages and Runs.
- [ ] 1.4 Add repository tests first, then implement transactional creation, owned reads, versioned
  compare-and-set transitions, event append, conversation projection and cascade behavior, including
  legacy rows with null associations.

## 2. Domain state machine

- [ ] 2.1 Add focused Red tests for every allowed transition and representative illegal transitions,
  then implement strict execution state/event unions and pure per-state transition functions.
- [ ] 2.2 Add tests for duplicate/stale versions, expiry, cancellation and the one-active-execution
  rule, then implement the orchestration shell that persists a transition before scheduling effects.
- [ ] 2.3 Add restart-recovery tests proving waiting clarification is restored while an orphaned
  executing Run becomes a safe retryable failure instead of replaying an unknown tool call.

## 3. Routing and intent registry

- [ ] 3.1 Add classifier adapter tests for valid output, one schema retry and safe `unclear` fallback,
  then implement the structured route proposal without exposing workflow/tool/SQL identifiers.
- [ ] 3.2 Add registry tests, then register `weather_operations_advice`,
  `hotel_operating_summary`, `public_hotel_rates` and `generic_hotel_data_query` with their slots,
  capabilities, workflows, budgets and evidence requirements.
- [ ] 3.3 Add policy tests proving quick-action fast paths, model-validated free-text routing,
  knowledge answers, unknown safe-read fallback and focused clarification for unclear requests.
- [ ] 3.4 Add security regression tests proving explicit or tool-discovered business writes are denied
  before MCP execution even when legacy configuration enables write tools; retain safe explanatory
  knowledge answers without claiming execution.

## 4. Slot resolution and clarification

- [ ] 4.1 Add resolver tests for missing, candidate, blocked, ambiguous, invalid and resolved states,
  source precedence and protection of already resolved values; implement the typed slot pipeline.
- [ ] 4.2 Add deterministic date tests with a fake clock, then implement date-level normalization using
  the explicit `Asia/Shanghai` application default and source metadata, without server-local-time
  dependence or an invented hotel business-day cutoff.
- [ ] 4.3 Add a narrow hotel-reference resolver port and tests for unique, multiple, absent and
  unavailable candidates; implement the initial bounded DMS discovery adapter and label its shared
  token scope honestly.
- [ ] 4.4 Add clarification builder/merge tests, then implement bounded product-owned fields,
  candidate membership checks, scoped free-text extraction, expiry and immutable resolved request
  construction.

## 5. Read workflows and evidence

- [ ] 5.1 Add workflow-policy tests, then make MCP tool selection execution-scoped and enforce per-
  workflow allowlists, four-call budget, one schema-discovery branch, one follow-up and existing
  timeout/row/size limits.
- [ ] 5.2 Add generic-query tests for normalized long-tail metrics/dimensions, incomplete context,
  unavailable capability and rejection of unfiltered exploration or causal overreach.
- [ ] 5.3 Add evidence-envelope tests for redaction, size bounds, query fingerprint, scope, period,
  metrics, observation metadata and filtering, then implement normalization for DMS, weather and
  hotel-rate results.
- [ ] 5.4 Add evidence-assessment tests for `sufficient`, `needs_more_data`, `inconclusive` and
  `rejected`, then implement the validator and single bounded follow-up transition.
- [ ] 5.5 Add answer adapter tests proving it receives only resolved request plus validated evidence,
  includes scope/source/material limitations and cannot emit generated UI from rejected evidence.

## 6. Gateway, Runs and recoverable transport

- [ ] 6.1 Add gateway tests first, then route new requests through business-execution creation while
  linking the initial user message and Run transactionally and preserving idempotent client request
  behavior.
- [ ] 6.2 Implement clarification pause/resume so the asking Run terminates, structured or scoped
  free-text answers create a later linked Run, and stale/foreign interaction submissions do no work.
- [ ] 6.3 Extend persisted Run events and the existing listener-before-replay SSE subscription with
  business-execution/clarification updates; add replay and de-duplication tests.
- [ ] 6.4 Extend conversation loading with completed execution summaries and one active pending
  interaction, and add compatibility tests for existing conversations, Run traces, cancellation and
  context preparation.
- [ ] 6.5 Add structured lifecycle logging at routing, clarification, workflow, evidence and terminal
  boundaries, with tests proving prompts, answers, slot raw text, tool payloads and credentials are
  absent.

## 7. Desktop interaction UI

- [ ] 7.1 Update desktop main/preload schemas and Agent service calls for execution hydration,
  clarification submission/cancellation and new SSE events, with focused IPC/service tests.
- [ ] 7.2 Using the required Svelte skills, add `PendingInteractionRenderer` and a deterministic
  clarification card with single-choice, date, date-range, number and bounded-text fields, including
  loading, validation, resolved, expired and cancelled presentation.
- [ ] 7.3 Anchor interaction cards to their persisted message while preserving chronological messages,
  existing Run timelines and generated result UI; keep the composer tied to the pending interaction
  until explicit task cancellation.
- [ ] 7.4 Add component/E2E coverage for initial live clarification, structured submission, free-text
  submission, renderer reload recovery, stale response, cancellation and final answer; run the Svelte
  autofixer on every changed component until it reports no issues or suggestions.

## 8. Migration and documentation

- [ ] 8.1 Verify the additive migration against an existing database and prove old messages/Runs load
  with null business-execution links; document the non-destructive rollback path.
- [ ] 8.2 Update the Agent integration guide and architecture diagram after implementation to show
  routing, slot resolution, persistent clarification, constrained workflows and evidence validation,
  without duplicating normative OpenSpec requirements.
- [ ] 8.3 Update deployment examples to remove or deprecate `AI_MCP_ALLOW_WRITE_TOOLS` only after the
  execution layer ignores it everywhere, and verify no write-capable Hotel Agent path remains.

## 9. Verification and review

- [ ] 9.1 During implementation run only the directly affected unit, component or E2E file for each
  Red/Green cycle and stop for root-cause analysis after approximately three repeated failures.
- [ ] 9.2 Run one completion-state full verification for the affected monorepo scope, including API,
  server, desktop, migration, tRPC/SSE and critical Agent E2E coverage; record exact evidence and any
  credential-dependent limitation in `verification.md`.
- [ ] 9.3 Run `openspec validate add-agent-intent-execution-layer --strict --no-interactive` and
  `git diff --check`, recording exact results in `verification.md`.
- [ ] 9.4 Perform an independent verification pass covering ownership, restart recovery, stale-version
  idempotency, write denial, generic fallback, MCP bounds, evidence limitations and clarification UI;
  record findings separately from implementation claims.
- [ ] 9.5 Perform a separate code-review pass for contract boundaries, state-machine legality,
  transaction consistency, sensitive-data handling, accessibility and regressions; resolve blocking
  findings and record the final review result.
- [ ] 9.6 After acceptance, merge the three delta specs into stable capabilities through OpenSpec
  archive and confirm the stable Agent architecture/spec facts match the implemented behavior.
