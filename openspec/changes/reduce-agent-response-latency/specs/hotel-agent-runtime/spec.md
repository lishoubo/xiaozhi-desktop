# Hotel Agent runtime delta

## ADDED Requirements

### Requirement: Avoid redundant Run preparation

The runtime SHALL avoid repeated external work when equivalent context has already been prepared for a Run.

#### Scenario: Prepare employee memory

- **WHEN** a Run starts
- **THEN** employee memory is loaded once into the guarded system context
- **AND** the model is not offered a redundant memory-recall tool

#### Scenario: Initialize multiple MCP servers

- **WHEN** more than one MCP server is configured and its tool catalog is first requested
- **THEN** independent server catalogs load concurrently
- **AND** transformed tools retain deterministic server configuration order

#### Scenario: Model retries a successful UI render

- **WHEN** one valid UI spec has been emitted and the model requests `render_hotel_ui` again
- **THEN** the duplicate render is not executed or displayed as another execution step
- **AND** the Run completes with the first UI instead of exhausting its recursion limit
