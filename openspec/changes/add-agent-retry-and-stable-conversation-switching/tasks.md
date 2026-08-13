# Tasks

## 1. Contract and state machine

- [x] 1.1 Add retry checkpoint schemas, pure failure/restoration transitions and focused tests.
- [x] 1.2 Add shared retry contract and nullable Run lineage without changing existing inputs.

## 2. Server execution

- [x] 2.1 Implement the owned, idempotent retry transaction with CAS and audit evidence.
- [x] 2.2 Resume the existing Gateway executor from restored states and preserve failure semantics.
- [x] 2.3 Prevent error ToolMessages and duplicate generated-UI calls from producing evidence or
  duplicate lifecycle events.
- [x] 2.4 Configure and smoke-test the replacement DMS MCP endpoint without exposing credentials.

## 3. Desktop experience

- [x] 3.1 Preserve the current conversation surface while an uncached conversation loads.
- [x] 3.2 Render and invoke retry only for retryable failed Runs, preserving old traces.
- [x] 3.3 Run the Svelte autofixer and add focused renderer/component coverage.

## 4. Verification and convergence

- [x] 4.1 Run directly affected tests while iterating and one completion-state verification.
- [x] 4.2 Perform separate verification and code-review passes and record exact evidence.
- [x] 4.3 Synchronize affected stable capability specs and the existing Agent call-chain document.

## 5. Container startup

- [x] 5.1 Make development and production server Compose stacks self-contained and remove private
  registry image requirements.
- [x] 5.2 Add environment-specific root npm commands for config validation, up, logs and down.
- [x] 5.3 Reduce the production environment template to deployment-time inputs and document the
  supported container startup paths.
- [x] 5.4 Terminate production HTTPS in the server container and scope Electron private-CA trust to
  the configured backend origin.
