# Verify RMS startup connectivity and authentication logging

## Why

Production phone login can fail before a phone authentication mutation reaches the server, while
the desktop UI shows only a generic message and neither side records enough diagnostic context. The
server currently treats a non-empty `RMS_DATABASE_URL` as configured without opening a connection,
so invalid credentials, network restrictions and connection failures remain invisible until the
first employee lookup.

The current incident also exposed an operational mismatch: the deployed ECS release predates the
local production bundle that contains `RMS_DATABASE_URL`, leaving both the host environment file and
the running container without the variable.

## What changes

- Verify a configured RMS MySQL pool with a read-only `SELECT 1` during authentication-resource
  initialization.
- Emit safe structured events for missing configuration and verification success or failure without
  logging the URL, credentials, phone numbers or database results.
- Report the phone identity source as available only after successful verification.
- Preserve user-friendly renderer messages while recording the original desktop authentication
  error chain and stack in the desktop main-process log.
- Add regression tests for startup verification, sanitized server logging and the desktop preflight
  failure path.
- Document the production diagnosis and require a separately confirmed production deployment of a
  bundle containing the configured environment.

## Success criteria

- A configured and reachable RMS database produces an `rms.connection.verified` startup event.
- An invalid URL, unreachable host, rejected credential or rejected verification query produces an
  `rms.connection.failed` event with safe error metadata and no secrets.
- Health never advertises the phone identity source when startup verification failed.
- Desktop phone authentication failures retain a friendly UI message and produce a main-process log
  containing the original error stack without sensitive request input.
- The relevant targeted tests and the repository completion gate pass.

