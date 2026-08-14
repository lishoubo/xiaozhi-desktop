# Proposal: Add authentication build profiles

## Why

The desktop authentication variant is currently selected through an ad-hoc shell environment
assignment, while the server incorrectly treats the same value as a mutually exclusive runtime
mode. This makes packaging error-prone and prevents one server from serving both desktop variants.

## What changes

- Add named, cross-platform `staff` and `phone` desktop development/package/make profiles.
- Keep desktop authentication selection at build time so unused UI and IPC composition are removed.
- Make the server register both authentication interfaces unconditionally.
- Treat `RMS_DATABASE_URL` only as an optional phone identity-source capability: create the pool when
  configured, otherwise start normally and return a deliberate unavailable response when that data
  source is actually needed.
- Expose authentication capability state through server health metadata for diagnostics.
- Give profile artifacts distinct identities/paths so operators cannot confuse them.

## Success criteria

- No raw shell environment assignment is required for normal staff/phone desktop workflows.
- A server without `RMS_DATABASE_URL` starts and keeps both authentication route families registered.
- A phone login that needs an unconfigured RMS identity source fails with an actionable service
  response rather than a startup error or 404.
- A configured server creates exactly one RMS pool and supports phone and staff clients concurrently.

