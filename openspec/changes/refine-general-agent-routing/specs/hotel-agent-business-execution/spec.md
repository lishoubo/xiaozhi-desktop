# Hotel Agent business execution delta

## Added requirements

### Requirement: General Agent and hotel business boundary

The system SHALL route ordinary Agent tasks outside hotel business execution unless the request
depends on current or historical hotel business facts or asks for hotel-operating action/advice.

#### Scenario: Standalone weather request

- **WHEN** a user asks for current weather without connecting it to hotel operations
- **THEN** the request routes to general Agent execution
- **AND** the system does not request a hotel selection

#### Scenario: Weather-informed hotel advice

- **WHEN** a user asks how weather affects hotel operations, staffing, pricing or occupancy
- **THEN** the request may route to the registered weather operations workflow
- **AND** only weather-workflow slots may be requested

#### Scenario: Hotel business facts

- **WHEN** an answer depends on the user's current or historical hotel orders, operations, rates,
  inventory, rooms, channels or other managed data
- **AND** the user has not explicitly asked to avoid internal lookup
- **THEN** the request routes to an authorized hotel business read

#### Scenario: User explicitly declines internal lookup

- **WHEN** a user asks for general guidance and explicitly says not to query internal hotel data
- **THEN** the system answers through explanatory/general execution
- **AND** clearly avoids claiming knowledge of the user's actual hotel state
