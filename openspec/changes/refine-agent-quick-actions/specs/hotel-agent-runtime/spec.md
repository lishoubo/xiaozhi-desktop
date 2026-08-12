# Hotel Agent runtime delta

## ADDED Requirements

### Requirement: Capability-backed quick actions

The Agent SHALL advertise a compact quick-action catalog derived from configured MCP capabilities and SHALL resolve each action to a server-owned prompt.

#### Scenario: Show representative test shortcuts

- **WHEN** weather and hotel-data MCP capabilities are configured
- **THEN** the catalog exposes one weather shortcut and one hotel operating-data shortcut
- **AND** the operating-data shortcut requires the configured read-only hotel-data MCP

#### Scenario: Hotel-data MCP is unavailable

- **WHEN** the `hotel_data` capability is not configured
- **THEN** the operating-data shortcut is not advertised
- **AND** a direct request for it is rejected before Run persistence

#### Scenario: Answer a hotel-specific business question

- **WHEN** an answer depends on a specific hotel's current or historical operating facts
- **THEN** the Agent queries the configured hotel-data MCP before answering
- **AND** does not present remembered, inferred or stale values as verified facts

#### Scenario: Answer a general hospitality question

- **WHEN** the user asks for a general concept, metric definition or operating method without requiring hotel-specific facts
- **THEN** the Agent may answer without an MCP query
