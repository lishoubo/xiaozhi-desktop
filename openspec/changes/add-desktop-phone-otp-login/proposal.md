# Proposal: Add desktop phone OTP login API

## Why

The desktop login screen is still backed by a local fixed phone/code mock. The server can read a safe active employee identity from RMS, but its public phone lookup is not protected by an OTP boundary and can be used to enumerate employee phone numbers. An SMS provider has not been selected yet, so provider-specific delivery cannot be implemented without coupling the contract to a guess.

## Outcome

- Add a shared tRPC phone-code request mutation for the desktop.
- Add a shared tRPC phone-code login mutation that returns the safe active RMS employee identity only after OTP verification succeeds.
- Put SMS delivery and verification behind an injected server port.
- Use an explicit temporary implementation that accepts every schema-valid request/code until a provider is selected.
- Remove the public employee-by-phone query so callers cannot bypass the OTP boundary.

## Non-goals

- Selecting or integrating an SMS provider.
- Issuing access/refresh tokens or introducing a server-side desktop session model.
- Connecting the existing desktop renderer mock to the new API in this change.
- Writing employee or OTP data to RMS MySQL or PostgreSQL.

## Success criteria

- A valid phone-code request returns a provider-neutral accepted response without disclosing whether the employee exists.
- A valid six-digit code reaches the temporary OTP gateway and then resolves only an active RMS employee.
- Invalid OTP and unavailable employees produce the same unauthenticated login failure.
- The shared router no longer exposes a direct public employee lookup.
- Focused contract and server tests prove the temporary behavior and the replaceable provider boundary.

