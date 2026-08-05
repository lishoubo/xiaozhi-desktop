# Server observability

## Requirements

- The server SHALL emit newline-delimited structured JSON logs through Pino.
- Every HTTP request SHALL receive a validated or generated request ID that is shared with tRPC and returned in `x-request-id`.
- HTTP and tRPC outcome logs SHALL use stable event names and allow-listed fields for route/procedure, operation type, status or error code, and duration.
- Logs SHALL NOT include raw input, query strings, headers, sessions, credentials, personal data, database contents, or raw error messages.
- Expected client failures SHALL use `warn`; unexpected server failures SHALL use `error`; successful reads SHALL use `debug`; successful mutations and lifecycle events SHALL use `info`.
- Pino SHALL remain owned by `apps/server`; `packages/api` SHALL depend only on a minimal structural logger contract.
- `LOG_LEVEL` MAY select a supported Pino level and SHALL default to `debug` in development and `info` otherwise.
