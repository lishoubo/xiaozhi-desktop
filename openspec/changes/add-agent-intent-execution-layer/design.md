## Context

See [proposal.md](proposal.md) for motivation. The current server persists conversations, messages,
Runs and replayable Run events, while `LangChainAgentRuntime` receives all loaded read tools and lets
the model choose the call sequence. `AgentExecutionTrace` is already a read model for one Run's UI
timeline; it is not a durable multi-turn business task.

The current data boundary also matters: authenticated employees share the scope of the configured
DMS token. The server has no trusted hotel directory, hotel-specific timezone or per-hotel Agent
authorization source today. This design must not invent one or imply stronger isolation than exists.

## Goals / Non-Goals

**Goals:**

- Put deterministic policy around model-assisted routing, slot extraction, tool use and evidence.
- Preserve useful long-tail read questions through a generic hotel-data workflow.
- Pause and resume clarification across messages and process restarts.
- Keep the implementation proportional to the current single-Agent, PostgreSQL and tRPC/SSE stack.
- Make the boundary replaceable when a trusted RMS hotel directory becomes available.

**Non-Goals:**

- Business writes, approval UI, compensating transactions or write-capable MCP tools.
- Sub-Agents, dynamic workflow definitions, XState or LangGraph checkpoint persistence.
- Per-hotel employee authorization beyond the current shared DMS-token scope.
- Persisting model chain-of-thought, raw MCP payloads, prompts or credentials.
- Resuming an MCP network call in place after process failure; only durable workflow boundaries and
  human-wait states are recoverable.

## Decisions

### 1. Add a business execution above individual Runs

Use `AgentBusinessExecution` for the durable user task and retain `AgentRun` for one bounded period
of model/tool activity. The existing `AgentExecutionTrace` name remains the UI projection of a Run.

```text
Conversation
  ├─ Messages
  └─ BusinessExecution
       ├─ triggering and clarification Messages
       └─ one or more Runs
```

Most requests have one execution and one Run. Clarification creates additional messages and a later
Run under the same execution. Every conversation is limited to one non-terminal business execution
in this phase, which removes reply-target ambiguity without preventing completed tasks from
remaining visible in history.

The server creates a business execution in `routing` with the first user message and Run in one
transaction. General conversation also passes through this short execution path and completes after
one Run; this keeps linking and recovery uniform instead of deciding too late whether an execution
was needed.

### 2. Use a small code-owned state machine

The persisted states are:

```text
routing → resolving_slots → ready → executing → validating_evidence → answering → completed
              │                         ↑                │
              └→ awaiting_clarification ┘                └→ executing (one follow-up)

Any non-terminal state → failed | cancelled
```

State and event schemas are strict discriminated unions. A pure `transition(state, event)` function
rejects illegal transitions; an orchestrator persists the compare-and-set transition before running
the next state's side effect. Model calls, MCP calls, database writes and SSE publishing never occur
inside the transition function.

This is deliberately not a home-grown generic state-machine framework. It is a small set of domain
types and transition functions. XState adds snapshot adaptation but not owner checks or durable
business semantics. LangGraph interrupts are useful later for many pause/approval points, but adding
its checkpointer now would create a second persistence authority beside existing Run/event storage.

### 3. Route with deterministic fast paths and model-assisted structured output

Routing has three stages:

1. Server-owned quick-action IDs map directly to registered intents.
2. Free text is classified once into a strict route proposal:

```ts
type RouteProposal = {
  category:
    | 'general_conversation'
    | 'hotel_knowledge'
    | 'business_read'
    | 'business_write'
    | 'unclear';
  intentCandidate?: string;
  requestedEffect: 'explain' | 'read' | 'write' | 'unclear';
  confidence: number;
  slots: Record<string, { raw: string }>;
};
```

3. Code validates the proposal against the intent registry, available capabilities and write-deny
   policy. The model cannot name tools, SQL, workflow IDs, hotel IDs or permissions.

Invalid structured output gets one schema-constrained retry. A second failure becomes `unclear`, not
a guessed business route. Explicit write requests are rejected before slot resolution or MCP tool
loading. An ambiguous read/write request asks a focused clarification without calling a tool.
Questions that merely explain how a business concept or operation works may use the knowledge route;
they must not claim an operation was performed.

### 4. Keep the initial registry intentionally small

The first registry contains:

| Intent | Required capability | Purpose |
|---|---|---|
| `weather_operations_advice` | `weather` | Existing current-weather quick action plus hotel operations advice |
| `hotel_operating_summary` | `hotel_data` | Existing operating-data quick action with a hotel and date period |
| `public_hotel_rates` | `hotel_rates` | Existing public rate lookup with stay parameters |
| `generic_hotel_data_query` | `hotel_data` | Safe long-tail read queries not matched by a dedicated intent |

`general_conversation`, `hotel_knowledge`, `unclear` and `business_write` are routes, not workflows.
The generic route accepts normalized requested metrics and dimensions and is deliberately more
conservative than a dedicated workflow. A repeated generic query pattern can later graduate into a
dedicated definition without changing the router contract.

Each intent definition owns required slots, safe defaults, capability, workflow, call budget and
evidence requirements. User wording is not enumerated in code.

### 5. Resolve slots as typed states, not trusted model values

The model extracts raw language candidates. Resolvers produce:

```ts
type SlotState<T> =
  | { status: 'missing' }
  | { status: 'candidate'; raw: string }
  | { status: 'blocked'; dependsOn: readonly string[] }
  | { status: 'ambiguous'; candidates: readonly T[] }
  | { status: 'invalid'; reasonCode: string }
  | { status: 'resolved'; value: T; source: SlotSource };
```

Resolution precedence is explicit structured UI input, current execution values, current message,
recent same-execution clarification messages, trusted business context and safe intent defaults.
Already resolved values are not silently overwritten by a later model extraction.

The initial project has no authoritative hotel directory. A narrow `HotelReferenceResolver` port is
introduced, with an initial read-only DMS discovery adapter when DMS exposes suitable hotel fields.
Its candidates inherit the current shared-token access scope; it does not claim employee-level hotel
authorization. If discovery is unavailable or returns no unique exact match, the system asks for an
exact hotel name/identifier and later verifies that returned evidence matches it. A future RMS hotel
directory can replace this adapter without changing slot or workflow contracts.

Dates remain date-level business periods. Relative Chinese dates use an injected clock with the
explicit application default `Asia/Shanghai`; their source records that default and the normalized
absolute dates are shown in the clarification or final query scope. Trusted hotel timezone metadata,
when a future context provider supplies it, takes precedence. This phase does not model a
hotel-specific business-day cutoff; sub-day questions without a reliable cutoff return a limitation
instead of silently inventing one.

### 6. Clarification is a durable product interaction

When required slots remain missing, invalid or ambiguous, the orchestrator builds a deterministic
`PendingClarification` from slot definitions and persists `awaiting_clarification`. It then writes a
short assistant message, emits the structured interaction and completes the current Run. No SSE
connection or model invocation remains open while waiting for the user.

Supported initial fields are `single_choice`, `date`, `date_range`, `number` and bounded `text`.
Structured card submission includes business execution ID, interaction ID, expected version and
answers. Free-text clarification uses the same interaction ID and a scoped extractor that may update
only requested slots. The server validates candidates, ownership, expiry and compare-and-set version
before resuming `resolving_slots`.

The desktop renders this product-owned interaction below its anchor message. It is separate from
`render_hotel_ui`: generated result UI cannot submit clarification, resume an execution or carry
approval authority. Resolved, expired and cancelled cards remain as read-only history.

### 7. Execute registered, bounded read workflows

The workflow registry exposes application-level steps rather than the raw global tool catalog. A
workflow receives a `ResolvedBusinessRequest`; the model may help form a natural-language query or a
read-only SQL candidate only inside that workflow's existing MCP guards.

Initial budgets are intentionally small:

- at most four business MCP calls per execution attempt;
- at most one table-list/description discovery branch;
- at most one evidence-driven follow-up query;
- existing 45-second tool timeout, 50-row and result-size limits remain;
- no write-like tool is loaded or callable, regardless of `AI_MCP_ALLOW_WRITE_TOOLS`.

The environment flag remains readable for backward configuration compatibility but is ignored by
the Hotel Agent execution layer and should be removed in a later cleanup after deployment configs no
longer set it. This avoids a configuration-only path that can bypass the product's unsupported-write
boundary.

Dedicated workflows request known scopes. `generic_hotel_data_query` may use schema discovery but
must normalize a hotel/date/metric question first; it cannot run an unfiltered exploratory dump or
answer a causal diagnosis from one aggregate.

### 8. Validate an evidence envelope before answering

Every successful business tool result becomes a normalized envelope:

```ts
type EvidenceEnvelope = {
  evidenceId: string;
  source: 'aliyun_dms_mcp' | 'weather_mcp' | 'hotel_rates_mcp';
  toolName: string;
  queryFingerprint: string;
  scope: { hotelReference?: string; period?: DateRange };
  metrics: readonly string[];
  observedAt: string | null;
  filtered: boolean;
  data: unknown;
};
```

The envelope is strict, size-bounded and credential-redacted. Validation checks tool success,
requested scope, required metrics, period coverage, empty/partial data, filtering and freshness
metadata where the workflow requires it. It returns `sufficient`, `needs_more_data`, `inconclusive`
or `rejected`.

`needs_more_data` can schedule only the workflow's one allowed follow-up. `inconclusive` generates a
limited answer that identifies missing evidence. `rejected` never reaches answer generation. The
answer model receives the resolved request and validated envelopes, not unrestricted raw tool text,
and must include scope, source and material limitations. Causal wording is disabled unless a future
dedicated workflow defines evidence sufficient for causality.

### 9. Persist two execution-level tables and link existing rows

Add:

```text
agent_business_execution
  id, conversation_id, trigger_user_message_id
  owner_employee_id, owner_org_id
  route_kind, intent, status, state_json
  version, expires_at, created_at, updated_at, completed_at

agent_business_execution_event
  sequence, id, business_execution_id
  conversation_id, owner_employee_id
  type, payload, created_at
```

Add nullable `business_execution_id` to `agent_message` and `agent_run`. The execution row is the
current-state source of truth; the event table supplies audit and reconstruction facts across Runs.
Evidence events store bounded normalized envelopes or safe metadata, never credentials or unlimited
raw results.

All creation and transition writes include conversation and authenticated owner predicates. A
partial unique index permits at most one non-terminal execution per conversation. State updates use
`WHERE version = expectedVersion`; zero updated rows indicate stale or duplicate input.

Conversation deletion cascades to execution rows/events. Execution cancellation does not delete
messages. A process restart restores `awaiting_clarification`; a stale `executing` execution whose
Run cannot be resumed is deterministically failed with a retryable explanation rather than replaying
an unknown MCP side effect.

### 10. Extend, rather than replace, the existing tRPC/SSE path

`AgentConversation` gains business-execution summaries and one nullable active execution containing
its pending clarification. Messages and Run traces carry nullable `businessExecutionId` for display
grouping. The renderer still treats chronological messages as the primary order.

The existing tracked SSE stream gains normalized business-execution/clarification events. The
subscription continues to register its live listener before replaying stored events and uses the
persisted event ID for de-duplication. Conversation hydration is authoritative after renderer
recreation; SSE only reduces latency.

Card answers use a strict mutation such as `submitClarification`; cancellation while waiting uses a
separate owned-execution mutation. While a clarification is pending, the ordinary composer submits
free text against that interaction; starting an unrelated task requires cancelling the pending task
first. This explicit first-phase rule avoids guessing whether phrases such as “第二个” refer to an
old or new request.

### 11. Keep model and workflow adapters narrow

Split the current runtime responsibility into replaceable ports without creating speculative
abstractions:

- `RouteClassifier`: structured route proposal;
- `SlotCandidateExtractor`: scoped raw slot candidates;
- `AnswerGenerator`: text and optional result UI from validated evidence;
- `McpToolProvider`: still owns connection, allowlist, argument guards and compaction.

The business orchestrator depends on these ports and the registries. The first three may share the
same configured Kimi client in the LangChain adapter, but their inputs and outputs stay distinct.
This prevents the general Agent loop from regaining unrestricted workflow control.

## Risks / Trade-offs

- [Generic fallback is less predictable than a dedicated intent] → apply smaller budgets, read-only
  guards, explicit metric/date normalization and no causal claims; promote frequent patterns later.
- [No trusted hotel directory exists] → expose the current shared DMS-token scope honestly, use a
  replaceable resolver and never infer employee-level hotel authorization.
- [Application-default timezone can be wrong for a future non-China hotel] → tag the source, display
  normalized dates and let a future trusted hotel context override it.
- [State JSON can drift from TypeScript] → parse every database read with versioned Zod schemas and
  migrate old versions explicitly.
- [Run and business-execution events can diverge] → persist state transition and execution event in
  one transaction; derive UI recovery from PostgreSQL rather than the in-memory event bus.
- [One active execution limits multitasking] → keep the rule for the first phase; completed tasks are
  unlimited and the schema does not prevent a future explicit multi-task UI.
- [Evidence validation cannot mathematically verify every prose claim] → restrict the answer input to
  validated envelopes and deterministically append scope/source/limitations; do not market this as
  formal proof.

## Migration Plan

1. Apply additive PostgreSQL tables, indexes and nullable foreign keys before application rollout.
2. Release shared contract, server, desktop main/preload and renderer changes together because the
   existing contract schemas are strict.
3. Route all new requests through the execution layer; existing conversations and Runs remain valid
   with null business-execution associations.
4. On rollback, the previous application ignores the additive tables/columns. Do not drop them until
   the rollout is accepted; no destructive rollback is required.
5. After verification, merge the delta requirements into `hotel-agent-runtime`, `hotel-data-agent`
   and the new `hotel-agent-business-execution` stable capability during archive.
