# Design: Recoverable Runs and stable conversation switching

## Persistence model

`agent_business_execution` remains the one persisted state-machine instance. A retryable failure
stores a discriminated `retryCheckpoint` inside its failed state. Checkpoints contain only the
minimum server-owned state required to safely re-enter `routing`, `resolving_slots`, `executing` or
grounded `answering`.

`agent_run` remains one execution attempt. A retry creates a new Run linked by nullable
`retry_of_run_id`, while the original failed Run and its events remain immutable. The transaction
validates ownership, failed/retryable state and checkpoint schema, restores the execution with a CAS
version update, inserts the new Run and audit event, then commits before background execution starts.

The state-machine transition remains a pure function. Repository code owns transaction/CAS work;
Gateway code resumes the existing `executeRun` orchestration. No model, tool or database handle is
stored in a checkpoint.

## Retry entry points

- `routing`: rerun free-text classification or deterministic quick-action routing.
- `resolving_slots`: rerun registered slot resolution with the saved intent and candidates.
- `executing`: invoke collection again using the immutable resolved request. Evidence from an
  incomplete collection pass is not reused unless it had already crossed validation.
- grounded `answering`: invoke only the answer model with already validated evidence.

Configuration failures, write denial, evidence rejection, expired clarification and terminal
success/cancellation have no checkpoint. The shared retry mutation accepts only `failedRunId` and a
fresh `clientRequestId`; all state is resolved under the authenticated employee on the server.

## Desktop behavior

Conversation selection uses a separate pending target. Cached targets switch immediately. For an
uncached target, the current conversation remains rendered until `getConversation` succeeds, then
the target ID and hydrated view are committed together. The selected navigation item may show a
bounded loading indicator without applying a page-level transition or empty-state flash.

Run failures are retained as presentation data keyed by Run. A retryable failure renders one
`重新尝试` action. Starting a retry appends a new user-visible attempt and clears only the active
failure banner; the failed execution trace remains in history.

## Answer UI limit

The answer-only runtime exposes only `render_hotel_ui`. The first valid call publishes one UI spec.
If the next model turn requests the tool again, middleware terminates before tool execution and the
runtime returns the first valid UI plus a bounded conclusion. Tool lifecycle emission must follow
the same guard so a suppressed duplicate does not appear as started/completed in the desktop log.

Weather itself remains deterministic MCP collection. The supplied trace attributes roughly ten
seconds to MCP and over two minutes to answer/UI generation; therefore no speculative weather-tool
optimization is included.

## DMS endpoint configuration

The bundled DMS connection reads `AI_DMS_MCP_URL` from the server environment and defaults to the
current HTTPS SSE endpoint. `AI_DMS_DATABASE_ID` pins every schema/SQL operation to one reviewed
database; model arguments cannot override it. The generic DMS endpoint's `listTables`,
`getTableDetailInfo`, `generateSql` and `executeScript` are renamed into product read tools, while
all instance-management, change-order and approval tools are discarded. A resolved operating
summary uses a code-owned aggregate SELECT against `fact_business_daily`; generic data reads may use
the longer schema/generate/execute chain. URL parsing retains the HTTPS-only remote guard. Tokens
remain server-only and production examples contain placeholders only.

## Failure handling

Retry transactions use both execution version CAS and employee-scoped `clientRequestId` uniqueness.
A concurrent second click returns the already-created attempt or a conflict, never a second active
execution. If restoration commits but background startup is interrupted, existing interrupted-Run
recovery marks the new Run retryable on the next request.

## Container startup

The server remains the only application process containerized; the Electron desktop is packaged
for the target operating system and connects to the configured HTTPS server origin. Development
Compose builds the server's `local-runtime` target and starts PostgreSQL, the local read-only RMS
fixture, database initialization and the HTTPS preview server. Production Compose builds the
server's `production` target locally, runs PostgreSQL plus database initialization and starts the
Node adapter through its direct HTTPS entry point. The production leaf certificate and private key
are mounted read-only; only the private CA public certificate is packaged in Electron.

Root npm commands use explicit `development` and `production` names for config validation, up,
logs and down operations. Production uses Docker Hub images and a locally built server image; image
publishing and remote deployment remain outside these scripts. Only credentials, origins, host
paths, certificate paths, external RMS connectivity and AI provider settings remain
environment-configurable. Caddy is intentionally not part of this private-CA deployment mode.
