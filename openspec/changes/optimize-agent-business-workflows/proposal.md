# Proposal: Optimize Agent business workflows

## Why

Registered business reads currently use a general Agent loop to select and call an MCP tool. After
the tool returns, that loop invokes the model again only to close the collection pass; its text is
discarded before evidence validation. A second model pass then produces the actual answer and
optional UI. This adds substantial latency and obscures model, MCP, evidence and UI-generation time.

MCP output is also normalized from `ToolMessage.content` with a permissive JSON-or-text fallback.
The protocol can expose `structuredContent` and `outputSchema`, but third-party servers are not
required to do so, so the execution layer needs an explicit compatibility hierarchy rather than
assuming either structured objects or prose.

## What Changes

- Execute registered weather, operating-summary and public-rate reads directly through a
  server-owned deterministic collector when a compatible read tool and input schema are available.
- Keep the constrained Agent collector for generic hotel-data discovery and as an explicit
  compatibility fallback when a third-party dedicated tool cannot be invoked safely from its schema.
- Normalize MCP results through ordered tiers: structured result, JSON content, tool adapter and
  bounded unstructured text; record the parse quality in the evidence envelope.
- Preserve programmatic evidence assessment before the answer model sees any result.
- Keep one post-validation model pass for grounded text and optional generated UI.
- Add structured phase-duration logs for collection, evidence assessment, answer-model execution,
  UI argument generation and completion without logging prompts, tool payloads or business results.

## Success Criteria

- A compatible dedicated workflow performs no model call before its MCP request and no discarded
  model close-out after the MCP result.
- Generic or incompatible tools retain the existing bounded read-only Agent behavior.
- Evidence parsing never assumes `ToolMessage.content` is a JavaScript object.
- Final answer generation receives only validated, bounded evidence.
- Logs make the previously invisible time between tool completion and UI generation attributable to
  named phases.

## Non-goals

- Requiring third-party MCP servers to add `outputSchema` or `structuredContent`.
- Removing the final grounded-answer model pass.
- Deterministically generating every result UI or supporting business writes.
- Changing desktop/API contracts, PostgreSQL schema or deployment settings.

