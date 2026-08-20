# Hotel Agent business execution delta

## ADDED Requirements

### Requirement: Workflow-ID handler dispatch

Every registered business intent SHALL resolve its versioned `workflowId` to exactly one server-
owned workflow handler. The handler SHALL own that workflow's collection plan, evidence-assessment
entry point and optional deterministic presentation while the gateway retains the shared durable
execution lifecycle.

#### Scenario: Resolve a registered workflow

- **WHEN** slot resolution produces an immutable business request for a registered intent
- **THEN** the server reads the intent definition's `workflowId`
- **AND** dispatches collection, evidence assessment and deterministic presentation to the same
  matching handler

#### Scenario: Reject an inconsistent registry

- **WHEN** a workflow ID is duplicated, missing, unreferenced or registered for the wrong intent
- **THEN** server composition fails closed before the affected business tool can execute

#### Scenario: Add a future business intent

- **WHEN** a new intent requires different collection, evidence or presentation behavior
- **THEN** it can add an intent definition and matching workflow handler without adding an intent-
  specific branch to the gateway orchestration loop
