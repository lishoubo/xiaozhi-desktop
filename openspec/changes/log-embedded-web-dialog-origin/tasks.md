## 1. Diagnostic capture

- [x] 1.1 Add an isolated preload that observes native JavaScript dialogs and delegates to the original functions without capturing their text or results.
- [x] 1.2 Package the diagnostic preload and attach it only to embedded page views.
- [x] 1.3 Record the dialog kind and managed tab's channel, ID, and sanitized origin in the main log.

## 2. Validation

- [x] 2.1 Add focused tests for logging and preservation of alert, confirm, and prompt behavior.
- [x] 2.2 Run targeted unit tests, type checks, lint, and a preload build check; record results in verification.md.
