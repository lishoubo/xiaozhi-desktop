# Delta: Hotel Agent runtime

## ADDED Requirements

### Requirement: Observable business execution phases

The server SHALL record privacy-safe duration logs for workflow collection, evidence assessment and
post-validation answer generation so time outside MCP lifecycle events is attributable.

#### Scenario: Grounded read completes
- **WHEN** a business read progresses from collection through answer generation
- **THEN** logs identify collection strategy, phase duration, assessment status and UI presence
- **AND** omit user content, tool arguments, evidence data, model output and generated UI payloads

