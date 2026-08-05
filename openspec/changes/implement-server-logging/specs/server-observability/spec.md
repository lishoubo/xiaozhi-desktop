# Server observability delta

## Added requirements

- The server SHALL emit structured JSON logs through Pino.
- Each HTTP request SHALL have a validated or generated request ID available to SvelteKit and tRPC and returned in `x-request-id`.
- HTTP and tRPC outcome logs SHALL include only allow-listed operational metadata and SHALL NOT include raw input, headers, sessions, credentials, personal data, or raw error messages.
- Expected client failures SHALL be distinguishable from unexpected server failures by log level and error code.
- The shared API package SHALL depend only on a minimal logger contract, not on Pino or SvelteKit.
