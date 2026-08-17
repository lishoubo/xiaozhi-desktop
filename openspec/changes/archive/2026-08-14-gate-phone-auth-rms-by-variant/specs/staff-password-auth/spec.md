## ADDED Requirements

### Requirement: Server resources follow the packaged authentication variant

The server SHALL interpret the same validated `XIAOZHI_AUTH_VARIANT` value as the desktop package and
SHALL create phone-authentication RMS database resources only for the `phone` variant.

#### Scenario: Start a staff-auth server without RMS MySQL
- **WHEN** `XIAOZHI_AUTH_VARIANT=staff` and `RMS_DATABASE_URL` is absent
- **THEN** the server starts without creating an RMS MySQL pool
- **AND** phone OTP procedures are unavailable
- **AND** Agent Bearer identity validation continues through the configured RMS HTTPS endpoint

#### Scenario: Start a phone-auth server
- **WHEN** `XIAOZHI_AUTH_VARIANT=phone`
- **THEN** the server requires `RMS_DATABASE_URL` before serving requests
- **AND** uses the RMS employee directory for phone login and desktop-session restoration
