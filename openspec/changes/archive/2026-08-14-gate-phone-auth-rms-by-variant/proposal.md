# Gate phone authentication and RMS by build variant

## Why

The server currently imports and creates the RMS MySQL pool unconditionally. A staff-auth desktop
package therefore cannot start its server without `RMS_DATABASE_URL`, even though staff login uses
the RMS HTTPS identity API and never uses phone OTP or the server-side employee directory.

## What changes

- Use the existing `XIAOZHI_AUTH_VARIANT=staff|phone` meaning for server runtime configuration.
- Create the RMS MySQL pool, temporary phone OTP gateway and RMS employee directory only in `phone` mode.
- Reject phone-login procedures explicitly in `staff` mode without touching RMS.
- Fix production Compose to the deployed `staff` variant and remove phone-only RMS MySQL configuration.

## Success criteria

- A `staff` server starts and answers its health endpoint with no `RMS_DATABASE_URL`.
- A `phone` server fails fast when `RMS_DATABASE_URL` is missing and keeps the existing phone flow when configured.
- Staff Bearer authentication for Agent procedures remains unchanged.
