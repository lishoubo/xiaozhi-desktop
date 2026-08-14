# Design

## Configuration boundary

`XIAOZHI_AUTH_VARIANT` remains `staff | phone` with default `staff`. The pure parser is shared from
`packages/api`; the desktop Vite plugin uses it at build time and the server uses it at runtime. An
invalid value fails closed instead of silently selecting another authentication system.

## Server composition

The RMS module becomes a factory with no import-time environment access. The tRPC composition root
resolves the variant once:

- `phone`: require `RMS_DATABASE_URL`, create one MySQL pool, RMS employee directory, phone OTP gateway
  and cookie-backed desktop sessions.
- `staff`: create no MySQL pool; inject unavailable phone dependencies that cannot authenticate and
  mark phone procedures disabled. Agent ownership continues to come from the validated RMS Bearer token.

The router checks `phoneAuthEnabled` before OTP calls so disabled phone endpoints return a deliberate
`NOT_FOUND` response rather than a misleading upstream failure.

## Deployment

Production Compose is fixed to `staff`, omits `RMS_DATABASE_URL` entirely and requires
`XIAOZHI_RMS_SERVER_URL` because that variant validates Bearer identities through the RMS API. Local
Compose remains variant-selectable so the phone build can still be exercised with RMS MySQL.

## Testing

- Shared parser: default, both variants and invalid input.
- Router: phone procedures are disabled before gateway/directory access.
- Server auth composition: staff mode does not call the RMS pool factory; phone mode does and requires URL.
- Production Compose config renders for staff mode without `RMS_DATABASE_URL`.
