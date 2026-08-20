# Design: Register Agent workflow handlers

## Runtime boundary

The existing business-execution state machine remains authoritative for routing, slot resolution,
clarification, execution, evidence validation, answering, retry and cancellation. The gateway
resolves a registered workflow after it has an immutable `ResolvedBusinessRequest` and delegates
only intent-specific decisions.

Each `BusinessWorkflowHandler` declares one versioned `id` and one intent and provides:

- `planCollection`: choose a direct read-only tool call or bounded Agent collection from normalized
  request data and the already-authorized tool catalog;
- `assessEvidence`: apply the workflow's evidence sufficiency and safety policy;
- `present`: optionally build deterministic text and generative UI from validated evidence.

The initial handlers may delegate evidence assessment to the current shared assessor. This is an
explicit default, not a gateway dependency, so a later knowledge workflow can enforce document
authorization, relevance, version and citation rules without changing other handlers.

## Registry and integrity

`BusinessWorkflowRegistry` is built from the server-owned intent definitions and handler list. It
indexes handlers by workflow ID and validates at construction:

- workflow IDs are unique;
- every intent definition references an installed handler;
- the handler intent matches the definition intent;
- no unreferenced handler is silently installed.

Runtime resolution is therefore:

```text
ResolvedBusinessRequest.intent
  -> IntentDefinition.workflowId
  -> BusinessWorkflowRegistry
  -> BusinessWorkflowHandler
```

Unknown or inconsistent registration is a protocol/configuration failure before a business tool is
called.

## Collection execution

The collection executor remains responsible for concerns shared by all workflows: capability-
filtered tool loading, schema-safe direct invocation, MCP lifecycle events, timeouts, the bounded
stale-connection refresh, result-error rejection and evidence capture. A handler cannot broaden
the capability allowlist declared by its intent definition.

Current behavior maps as follows:

- `hotel_operating_summary.v1`: direct code-owned aggregate SQL for a single hotel; existing
  constrained Agent fallback for supported multi-hotel discovery; deterministic operating view;
- `generic_hotel_data_query.v1`: bounded Agent collection and deterministic tabular view when the
  validated result is representable;
- `public_hotel_rates.v1`: direct call only for a compatible authorized rate-tool schema, otherwise
  bounded Agent collection;
- `weather_operations_advice.v1`: model/Agent collection under its existing empty MCP policy.

## Presentation and validation

The gateway no longer probes global answer builders. It calls the selected handler's `present`
method after evidence validation. When the handler returns no deterministic view, the existing
grounded model presentation remains the fallback.

The gateway calls the same handler's `assessEvidence` method during validation. Evidence
normalization remains shared because it is a security and transport boundary; domain-specific
sufficiency rules belong behind the handler.

## Extensibility

A future knowledge workflow can register `knowledge_answer.v1`, plan retrieval calls, validate
document scope/relevance/version/citations and produce citation-oriented presentation. It does not
need to modify the gateway or another workflow handler.

## Failure and compatibility

This refactor does not change persisted workflow IDs or execution state. Manual retries resolve the
handler again from the immutable request, so process restart and code upgrade use the currently
registered implementation for that versioned ID. Registration errors fail closed and contain no
user or business content.
