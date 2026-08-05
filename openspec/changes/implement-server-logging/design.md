# Design: Server structured logging

## Boundaries

`apps/server/src/lib/server/logging/` owns Pino configuration, redaction, request-ID validation, child loggers, and safe error classification. The shared `packages/api` context accepts a small structural logger interface so router middleware stays independent from Pino.

## Request flow

1. The outer SvelteKit handle validates `x-request-id` or generates a UUID.
2. It stores the request ID and a child logger in `event.locals`, then returns the ID in the response header.
3. It logs one HTTP completion event with route ID, method, status, and duration.
4. The tRPC handler passes the request logger into `ApiContext`.
5. Router middleware logs successful procedure completion; the adapter `onError` logs failures once.
6. SvelteKit `handleError` logs unexpected non-tRPC failures with safe error classification.

## Safety

Logs never include request bodies, tRPC input, query strings, cookies, authorization headers, sessions, raw user objects, email addresses, phone numbers, or raw error messages. Pino redaction is defense in depth for accidental sensitive keys. Expected 4xx outcomes use `warn`; unexpected 5xx outcomes use `error`; successful reads use `debug`; mutations and significant lifecycle events use `info`.

## Configuration

`LOG_LEVEL` may select a valid Pino level. Defaults are `debug` in development and `info` otherwise. Logs are newline-delimited JSON on stdout for local, container, and process-manager collection.
