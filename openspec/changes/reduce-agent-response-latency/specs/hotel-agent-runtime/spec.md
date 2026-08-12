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
