# Tasks

- [x] 1. Add a shared strict parser for `XIAOZHI_AUTH_VARIANT` and use it from the desktop build plugin.
- [x] 2. Add router context state and tests that disable phone OTP/login outside the phone variant.
- [x] 3. Refactor RMS database initialization into an explicit factory with no import-time environment requirement.
- [x] 4. Add server authentication composition that creates RMS dependencies only for `phone`.
- [x] 5. Update local/production Compose and production environment examples for conditional RMS configuration.
- [x] 6. Run targeted tests, affected workspace gates, Compose configuration checks, verification and review.
- [x] 7. Merge the accepted delta into stable authentication/deployment specifications and archive the change.
