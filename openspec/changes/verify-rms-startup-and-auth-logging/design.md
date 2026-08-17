# Design

## RMS verification lifecycle

`createServerAuthResources` becomes asynchronous. When `RMS_DATABASE_URL` is absent, it keeps the
existing optional-capability behavior and returns an unavailable employee directory. When present,
it creates the pool and runs a dedicated `verifyConnectivity()` operation that executes `SELECT 1`.

Successful verification installs the employee directory and marks the health capability available.
Failed parsing or verification closes the pool when possible, logs a sanitized failure event, and
returns the unavailable directory so the management server remains available. When a URL is
configured but verification fails transiently, later tRPC requests retry after a short cooldown; a
successful pool is then cached for the process lifetime. An intentionally absent URL remains cached
as unavailable.

The verifier and retry clock are injected in unit tests. Production uses the same pool that later
serves employee queries, avoiding a second connection configuration path.

## Safe server diagnostics

Startup events use stable names:

- `server.auth.resources_configured`: whether a URL was supplied and whether a verified pool is
  enabled.
- `rms.connection.verified`: success and duration only.
- `rms.connection.failed`: duration, safe error type and an allow-listed driver error code.

The server never logs the connection URL, host, username, password, SQL error message, query result
or stack for expected RMS connection failures. Driver codes such as `ER_ACCESS_DENIED_ERROR`,
`ETIMEDOUT` and `PROTOCOL_CONNECTION_LOST` are diagnostic without exposing credentials.

## Desktop diagnostics and user messages

The renderer continues mapping authentication failures to stable, friendly Chinese messages. The
main-process `AuthService` owns diagnostic logging because it sees the original tRPC/preflight error
before the preload boundary. Every failed operation, including a negative capability preflight, is
logged through one helper with operation, error type, message and stack/cause details. Phone numbers,
verification codes and tRPC inputs are never included.

## Deployment incident

Read-only inspection established that `/opt/hotel-butler/app/apps/server/.env.production` and the
running server container both lack `RMS_DATABASE_URL`. The container uses image
`hotel-butler-server:eda5fbe49047`, while the later local production bundle contains the configured
variable. Code changes cannot mutate production automatically. After verification, packaging,
upload and deployment remain a separately confirmed operator action because they recreate the
production server container.
