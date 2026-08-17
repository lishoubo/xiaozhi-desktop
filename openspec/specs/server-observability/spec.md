# Server observability

## Requirements

- The server SHALL emit newline-delimited structured JSON logs through Pino.
- Every HTTP request SHALL receive a validated or generated request ID that is shared with tRPC and returned in `x-request-id`.
- HTTP and tRPC outcome logs SHALL use stable event names and allow-listed fields for route/procedure, operation type, status or error code, and duration.
- Logs SHALL NOT include raw input, query strings, headers, sessions, credentials, personal data, database contents, or raw error messages.
- Expected client failures SHALL use `warn`; unexpected server failures SHALL use `error`; successful reads SHALL use `debug`; successful mutations and lifecycle events SHALL use `info`.
- Pino SHALL remain owned by `apps/server`; `packages/api` SHALL depend only on a minimal structural logger contract.
- `LOG_LEVEL` MAY select a supported Pino level and SHALL default to `debug` in development and `info` otherwise.
- Every outbound RMS HTTP request SHALL emit correlated start and completion or failure events with
  operation, safe endpoint origin/path, status when available, outcome and duration.
- RMS boundary logs SHALL NOT contain Bearer credentials, response bodies or returned identity data.
- Production Pino logs SHALL remain on stdout and SHALL additionally persist as newline-delimited
  JSON in the configured host bind mount.
- A configured RMS MySQL identity pool SHALL be verified during server initialization. Successful
  verification SHALL emit `rms.connection.verified`; failure SHALL emit `rms.connection.failed`
  with duration, safe error type and an allow-listed driver error code.
- RMS connection verification logs SHALL NOT include the database URL, hostname, username, password,
  raw driver message, SQL result or stack.
