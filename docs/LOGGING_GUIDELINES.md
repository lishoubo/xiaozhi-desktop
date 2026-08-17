# Logging Guidelines

## Purpose

Logs exist to reconstruct meaningful operational events and diagnose failures without exposing sensitive data or overwhelming useful signals. Logging is part of a feature's design, not a line-by-line trace of its implementation.

## What to Log

Add concise logs at meaningful boundaries such as:

- application, database, window, session, and managed-resource lifecycle transitions;
- completion of important user-initiated mutations;
- external system, filesystem, native API, IPC, migration, or persistence failures;
- security-relevant rejection of untrusted input, navigation, permissions, or IPC senders;
- long-running or multi-stage operations where start and final outcome are necessary to diagnose interruption;
- degraded outcomes, partial success, retry exhaustion, or recovery actions.

For third-party API and MCP boundaries, log the call lifecycle and outcome at the orchestration
boundary. A successful response MAY include an allow-listed, non-content summary such as protocol
status, result type, content-block count, serialized character count, filtering state and a SHA-256
fingerprint. A failure SHOULD identify the safe operation/tool name, failure stage, error class,
retryability and duration. Never include request arguments or response content in these summaries.

Prefer one outcome log at the boundary that knows the operation's result. Do not log every helper call, query, render, state assignment, resize event, normal navigation event, or high-frequency loop iteration.

## Levels

- `error`: an operation failed and could not fulfill its contract, or application integrity is at risk.
- `warn`: a blocked security event, degraded/partial result, recoverable failure, or rejected request worth investigating.
- `info`: a significant lifecycle transition or successful user/business operation.
- `debug`: development-only diagnostic detail with a demonstrated need; do not use it as routine narration.

Do not use `error` for expected validation feedback and do not use `info` for high-frequency reads.

## Event Shape

- Use a stable, concise event message describing the outcome, for example `Cookie import completed`.
- Put small, structured diagnostic fields in a metadata object.
- Record counts, safe category identifiers, booleans, duration buckets, and error class/name when useful.
- Log success only after the operation has actually succeeded.
- At layered boundaries, avoid duplicating the same failure unless each log represents a distinct operational stage.
- Preserve enough context to correlate the operation without logging raw payloads.
- Correlate third-party calls with the owning run/request, conversation or business execution when
  that context exists; cached catalog initialization may instead use safe server/tool counts.

## Sensitive Data

Never log:

- passwords, verification codes, secrets, API keys, access/refresh tokens, authorization headers, or credentials;
- Cookie names, values, headers, raw browser storage, or session identifiers;
- phone numbers, email addresses, guest identity, personal data, or user-entered free text;
- full URLs that may contain queries, fragments, credentials, or personal identifiers;
- sensitive local paths, home directories, command output, database contents, or raw IPC payloads;
- complete settings values or authentication/session objects.

Prefer allow-listed metadata over attempting to remove fields from a raw object. The shared redaction hook is defense in depth, not permission to log sensitive payloads. When an error may embed a path, URL, command, or external payload, record a safe error name/category rather than the raw error message.

## Placement and Ownership

- Server requests use a request-scoped Pino child logger and a validated correlation ID. SvelteKit owns HTTP and unexpected-error events; tRPC owns procedure outcome events. Neither layer logs request bodies, headers, sessions, raw input, or raw error messages.
- Shared API code depends only on the minimal logger contract provided through tRPC context; it must not import Pino or server framework code.
- Main process owns logs for IPC handling, persistence, database, native APIs, browser sessions, filesystem access, security decisions, and application lifecycle.
- Renderer logs only meaningful UI/session failures or lifecycle events that are unavailable in main. It must not log form contents or duplicate every main-process event.
- Preload normally remains a thin, unlogged bridge; log invoke outcomes at the trusted main boundary.
- Pure domain logic should stay framework-independent. Inject the minimal logger interface when it owns a meaningful operation; otherwise log at its orchestration boundary.

## Review and Tests

For every changed operational flow, review the success, failure, partial-success, cancellation, and security-rejection paths. Add or update tests before production code when logging is observable behavior.

Tests should verify:

- the event is emitted at the correct outcome boundary;
- the level and message are stable and meaningful;
- metadata is minimal and useful;
- secrets, personal data, raw payloads, full URLs, and sensitive paths are absent;
- logging does not change the operation's return value or error behavior.

Do not weaken redaction hooks, disable error capture, or replace structured logging with `console.*`.
