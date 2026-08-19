# Hotel Agent business execution delta

## Modified requirements

### Requirement: Layered request routing

The system SHALL separate LLM-only Agent work from business reads that require verified hotel facts.
General capabilities SHALL not receive MCP or business Skill access. A hotel business intent SHALL
execute its registered workflow and receive only the dependencies explicitly declared by that route.

#### Scenario: Weather request or weather-informed advice

- **WHEN** a prompt asks about weather or connects weather to general hotel operating advice without
  requesting the user's live hotel facts
- **THEN** it routes to LLM-only general or hotel-knowledge execution
- **AND** it does not request hotel fields or initialize an MCP catalog

#### Scenario: Hotel business facts

- **WHEN** an answer depends on the user's current or historical hotel operating data
- **THEN** it routes to the authorized business-read workflow
- **AND** only dependencies declared by the selected business route may be loaded
