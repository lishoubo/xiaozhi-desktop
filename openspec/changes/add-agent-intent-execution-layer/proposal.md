## Why

The current Hotel Agent gives the model a prompt and the available tools, then relies on the model
to decide whether context is complete, which MCP calls are appropriate and whether returned data is
sufficient for the answer. That is flexible, but it cannot reliably pause for missing business
parameters, resume after a restart, constrain each request to a known read workflow or prove that a
hotel-specific conclusion is grounded in matching evidence.

## What Changes

- Add a server-owned business execution layer between conversation input and the Agent runtime:
  request routing, slot resolution, clarification, constrained read workflow execution, evidence
  validation and grounded answer generation.
- Use a compact intent registry for stable, high-value hotel workflows, while retaining a generic
  read-only hotel-data route for valid long-tail questions that were not anticipated in advance.
- Route general conversation and hotel knowledge to model-only answers when no current business
  facts are required; ask one focused clarification when routing or required parameters remain
  ambiguous.
- Reject every detected or requested business write operation before MCP execution. No configuration
  flag may enable Agent write tools in this phase.
- Persist a long-lived business execution independently from individual model Runs so clarification
  can pause and resume across messages, renderer recreation, server restart and multiple server
  instances.
- Add deterministic pending-interaction contracts and desktop components for clarification. These
  controls are product-owned UI and remain separate from model-generated result UI.
- Validate tool evidence for scope, period, metric coverage, freshness metadata and filtering before
  permitting a grounded answer; otherwise perform one bounded follow-up query or return an explicit
  limitation.

## Capabilities

### New Capabilities

- `hotel-agent-business-execution`: Business intent routing, slot resolution, persistent
  clarification, constrained read workflows, generic read-only fallback, evidence validation and
  write denial.

### Modified Capabilities

- `hotel-agent-runtime`: Conversation, message, Run and business-execution contracts and recovery
  behavior change to expose pending interactions and attach multi-turn business tasks to messages.
- `hotel-data-agent`: Hotel-data access changes from model-directed MCP use alone to execution-scoped
  read policies and validated evidence envelopes.

## Impact

- `packages/api`: strict schemas for execution summaries, slot/pending-interaction unions, resume
  inputs and replayable execution events.
- `apps/server`: new execution orchestrator, intent/workflow registries, slot resolvers, evidence
  validator and PostgreSQL repositories; existing gateway and runtime become execution consumers.
- PostgreSQL: new business-execution, interaction and evidence records plus optional Run/message
  associations and versioned compare-and-set transitions.
- `apps/desktop`: preload/IPC propagation and deterministic clarification cards embedded in the
  existing conversation flow.
- Existing tRPC v11 SSE remains the live transport; no WebSocket, XState, LangGraph checkpoint,
  sub-Agent, business write tool or deployment setting is introduced.
