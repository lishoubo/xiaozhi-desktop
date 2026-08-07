# Proposal: Complete desktop phone OTP login

## Why

The desktop login screen still accepts a fixed phone/code entirely in the renderer and stores a self-asserted seven-day identity in `localStorage`. The server already exposes provider-neutral phone OTP procedures and resolves active identities from RMS, but desktop does not call them and successful login does not create a revocable server session. This is not an authentication boundary.

An SMS provider has not been selected. The temporary provider behavior must therefore remain explicit and replaceable, while every other part of the login and session lifecycle follows the production path now.

## Outcome

- Connect the desktop login UI to the server phone-code request and login mutations through main/preload IPC.
- Keep the temporary OTP gateway that accepts every schema-valid six-digit code; do not hard-code a special code in desktop.
- Permit login only when the phone belongs to an active RMS `employee`.
- Add one deterministic active RMS development employee to the checked-in local schema bootstrap and show that phone as the desktop experience account.
- Issue a random opaque desktop session after login, store only its SHA-256 digest and RMS employee ID in PostgreSQL, and support validation, expiry, and logout revocation.
- Persist the server cookie only in a dedicated encrypted Electron session partition. Renderer receives employee identity but never the session credential.
- Remove the renderer `localStorage` auth session and fixed mock credentials.

## Non-goals

- Selecting or integrating an SMS provider.
- Adding refresh tokens, multi-device session management UI, or administrator control of desktop sessions.
- Copying RMS employee profiles into PostgreSQL.
- Coupling desktop application logout to third-party OTA account cookies.

## Success criteria

- Requesting a code from desktop reaches the server and starts the countdown only after acceptance.
- Any six-digit code can pass the temporary OTP gateway, but login succeeds only for an active RMS employee phone.
- Successful login sets a secure server session cookie, survives desktop restart, and restores identity through server validation.
- Expired, missing, malformed, revoked, or RMS-disabled sessions return the desktop to login.
- Logout revokes the server record and removes the local cookie even when the remote revocation request fails.
- Neither renderer APIs nor logs expose the opaque session token, phone code, or full phone number.
- Fresh local RMS initialization contains the displayed experience employee.

