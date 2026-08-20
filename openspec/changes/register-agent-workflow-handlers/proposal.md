# Proposal: Register Agent workflow handlers

## Why

The Agent intent registry already assigns a versioned `workflowId`, but runtime dispatch still
branches directly on intent inside the deterministic collector and the gateway tries multiple
intent-specific answer builders in sequence. More intents, including a future knowledge-base read,
would add more centralized conditions and couple unrelated collection, evidence and presentation
rules.

## Change

- Make `workflowId` the runtime dispatch key between an intent definition and one registered
  workflow handler.
- Give each handler explicit collection-planning, evidence-assessment and deterministic-
  presentation boundaries while retaining the gateway-owned lifecycle and durable state machine.
- Register handlers for every current business intent and fail startup/composition when an intent
  has no matching handler, a duplicate handler exists, or a handler claims the wrong intent.
- Preserve current tool permissions, direct-query behavior, Agent fallbacks, evidence safety,
  presentation and retry behavior.

## Success criteria

- No workflow selection in the collector or gateway depends on an intent-specific conditional
  chain.
- Every current intent resolves through `IntentDefinition.workflowId` to exactly one handler.
- Existing operating-summary, generic-data, public-rate and weather behavior remains covered.
- Adding a future intent requires a definition plus a handler registration rather than editing the
  gateway's orchestration loop.

## Non-goals

- Adding the knowledge-base intent, retrieval provider or document schema in this change.
- Introducing LangGraph, Temporal or another orchestration framework.
- Changing the persisted business-execution state model or shared desktop/server contracts.
- Generalizing unrelated ordinary-conversation and business-write-denial paths.
