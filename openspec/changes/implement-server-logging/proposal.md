# Proposal: Implement server logging

## Why

The server depends on Pino but does not initialize it or capture HTTP, SvelteKit, tRPC, authentication, or database failures. Production failures cannot currently be correlated across a request, and ad-hoc logging could expose credentials or personal data.

## Outcome

- Add structured server logging with one request ID across SvelteKit and tRPC.
- Capture request outcomes, tRPC procedure outcomes, durations, and unexpected errors.
- Use allow-listed metadata and defensive redaction for credentials, sessions, tokens, and personal data.
- Keep Pino inside `apps/server`; expose only a minimal logger interface to the shared API router.

## Success criteria

- Every server request receives and returns a safe request ID.
- Successful and failed tRPC operations emit stable structured events without raw input.
- Unexpected SvelteKit failures are logged without changing public error behavior.
- Tests prove correlation, level selection, and sensitive-data redaction.
