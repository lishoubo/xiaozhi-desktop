# Server container deployment delta

## Requirement: Deployed environment matches the packaged production release

The production deployment SHALL install the environment file embedded in the selected verified
bundle and recreate the server container from that bundle's image.

### Scenario: Enable phone identity in production

- **WHEN** the selected production bundle contains a non-empty `RMS_DATABASE_URL`
- **THEN** the installed host environment and recreated server container receive that variable
- **AND** startup logs report the result of verifying it from the ECS network

