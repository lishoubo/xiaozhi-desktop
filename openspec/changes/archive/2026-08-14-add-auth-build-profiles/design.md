# Design

## Desktop profiles

A small Node runner accepts a closed `staff | phone` profile and a closed action list. It sets
`XIAOZHI_AUTH_VARIANT` for the child Forge command, forwards signals and exits with the child status.
Root npm scripts provide the stable human/CI interface. Forge derives the packaged application name,
bundle/application ID and output directory from the same validated build-time profile.

The environment variable remains an implementation detail because Vite needs a compile-time literal
for dead-code elimination. It is not an end-user runtime setting.

## Server capabilities

The server no longer reads `XIAOZHI_AUTH_VARIANT`. At composition time it always creates the OTP
gateway and always registers phone procedures. If `RMS_DATABASE_URL` is present it creates the RMS
pool and employee directory. Otherwise it injects an employee directory that throws a typed
identity-source-unavailable error only when an RMS lookup is attempted.

The router translates that boundary error into `SERVICE_UNAVAILABLE` with an actionable Chinese
message. Requests that do not need an RMS lookup, including health and staff Bearer authentication,
remain available.

## Capability reporting

`system.health` continues to report transport health and adds authentication facts: both interface
families are supported, and `phoneIdentitySourceConfigured` states whether phone identity lookup can
currently complete. This is diagnostic metadata, not an authorization decision.

## Deployment

Production remains staff-oriented and omits `RMS_DATABASE_URL`, but does not compile or route-disable
phone authentication. Adding the secret URL later enables the phone identity source without changing
the server image. Local Compose passes the optional URL when supplied.

