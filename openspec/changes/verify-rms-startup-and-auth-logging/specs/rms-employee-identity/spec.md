# RMS employee identity delta

## Requirement: Verify RMS identity availability before advertising it

When `RMS_DATABASE_URL` is configured, the server SHALL execute a read-only connectivity query before
advertising the phone identity source as available.

### Scenario: RMS verification succeeds

- **WHEN** the server can connect and execute `SELECT 1`
- **THEN** the verified pool backs employee identity lookup
- **AND** system health reports the phone identity source as configured

### Scenario: RMS verification fails

- **WHEN** URL parsing, network connection, authentication or the read-only verification query fails
- **THEN** system health reports the phone identity source as unavailable
- **AND** phone login cannot query an unverified pool
- **AND** the remaining management server stays available

### Scenario: A transient startup failure recovers

- **WHEN** a configured RMS source fails its startup check and later becomes reachable
- **THEN** a later request retries verification after a bounded cooldown
- **AND** the first successfully verified pool becomes the shared employee identity source
