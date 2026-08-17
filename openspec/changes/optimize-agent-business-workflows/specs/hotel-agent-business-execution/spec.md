# Delta: Hotel Agent business execution

## ADDED Requirements

### Requirement: Deterministic dedicated collection

Registered dedicated read workflows SHALL call a compatible read-only MCP tool without a
model-driven collection loop. A generic workflow or incompatible third-party tool SHALL use the
existing constrained Agent collector rather than guessing a tool input.

#### Scenario: Dedicated tool is compatible
- **WHEN** the resolved dedicated intent has an allowed tool and a server-owned argument shape
  accepted by its runtime schema
- **THEN** the server calls that tool directly and captures its result as evidence
- **AND** performs no collection model call before or after the MCP request

#### Scenario: Dedicated tool is incompatible
- **WHEN** no server-owned argument shape satisfies the available tool schema
- **THEN** the server uses the bounded read-only Agent collector
- **AND** does not invoke the incompatible tool speculatively

### Requirement: Compatible MCP evidence representations

The evidence boundary SHALL accept structured MCP results, JSON text, known adapter formats and
bounded unstructured text without assuming a tool message contains a JavaScript object. The
envelope SHALL record the representation parse quality before evidence assessment.

#### Scenario: MCP returns structured content
- **WHEN** a tool result contains JSON-compatible `structuredContent`
- **THEN** the normalizer prefers it over display content and records structured parse quality

#### Scenario: MCP returns prose
- **WHEN** no structured, JSON or known adapter representation is available
- **THEN** the normalizer preserves bounded credential-redacted text as unstructured evidence
- **AND** scope and freshness requirements still determine whether answering is allowed

