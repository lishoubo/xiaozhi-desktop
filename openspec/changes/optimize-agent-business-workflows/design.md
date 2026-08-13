# Design: Deterministic collection and compatible evidence parsing

## Execution split

`HotelAgentGateway` continues to own the persisted state machine. The collection step chooses one of
two server-owned strategies:

```text
ResolvedBusinessRequest
  ├─ dedicated + compatible → DeterministicWorkflowCollector → MCP tool
  └─ generic/incompatible   → AgentRuntime collection pass → bounded MCP tools

MCP result → EvidenceNormalizer → EvidenceAssessment → AnswerGenerator → text + optional UI
```

Weather prefers the pinned `get_weather_summary` tool with code-owned location/date arguments.
Operating summary prefers the guarded `query_hotel_operating_data` tool with a code-owned bounded
question. Public rates selects a read-only rate/price/availability tool and uses only an argument
shape accepted by that tool's runtime schema. If no compatible shape is accepted, collection falls
back before invoking a tool; a failed external read does not trigger a second speculative call.

The generic hotel-data workflow keeps the constrained Agent because table discovery and read-query
formation are intentionally exploratory. The existing tool allowlist, call budget, timeout, SQL
guards and single follow-up remain authoritative in both paths.

## MCP result compatibility hierarchy

The normalizer accepts `unknown` and never trusts a transport-specific runtime type:

1. Use `structuredContent` when present and JSON-compatible.
2. Extract text from a single string or MCP/LangChain text content blocks and parse JSON when valid.
3. Apply a named tool adapter for known stable prose formats.
4. Retain credential-redacted, size-bounded text as unstructured evidence.

Each envelope records:

```ts
type EvidenceParseQuality =
  | 'structured'
  | 'json'
  | 'adapter'
  | 'unstructured';
```

Parse quality describes representation confidence, not truth. Scope, freshness, emptiness and
filtering assessment still runs separately. Unsupported images, audio and resources are not
silently converted into business facts.

## Model boundary

The answer pass receives the immutable resolved request and validated evidence only. It has no MCP
data tools and may call `render_hotel_ui` once. The local render function validates the generated UI
schema and emits it; the model then provides the short final explanation. Dedicated collection does
not create a collection model or expose raw MCP output to one.

## Observability

Structured server logs record phase, run/execution IDs and duration only:

- `workflow.collection.started/completed` with strategy and tool name;
- `workflow.evidence.assessed` with assessment and evidence count;
- `answer.model.started/completed` with UI presence and duration;
- existing tool lifecycle events remain for the desktop timeline.

No log contains user text, arguments, evidence data, UI spec, model output or credentials.

## Failure and fallback

- Tool selection or input-schema incompatibility falls back to the constrained Agent collector.
- Once a deterministic MCP call starts, its error follows the normal retryable Run failure path and
  is not repeated through the Agent fallback.
- Structured/JSON parse failure falls through to bounded text; it does not discard the source.
- Evidence rejection never reaches answer generation.

