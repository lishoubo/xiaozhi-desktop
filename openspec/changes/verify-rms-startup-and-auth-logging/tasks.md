# Tasks

- [x] 1. Add failing server unit tests for successful and failed RMS startup verification, health
      availability and sanitized structured logging.
- [x] 2. Implement asynchronous RMS startup verification with a read-only `SELECT 1`, safe failure
      metadata and pool cleanup.
- [x] 3. Add failing desktop unit tests for detailed logging of negative capability preflight and
      remote authentication failures without phone/code input.
- [x] 4. Implement desktop main-process authentication error-chain logging while preserving friendly
      renderer messages.
- [x] 5. Run targeted server and desktop tests during implementation.
- [x] 6. Merge the accepted deltas into the stable RMS identity, server observability and deployment
      specifications.
- [x] 7. Run one completion-state repository verification and record evidence in `verification.md`.
- [ ] 8. Present the exact production package/upload/deploy impact and wait for explicit confirmation
      before changing the ECS deployment.
