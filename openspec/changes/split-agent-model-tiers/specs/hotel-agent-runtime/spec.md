# Hotel Agent runtime delta

## Added requirements

### Requirement: Phase-specific model tiers

The server SHALL use a fast non-thinking Kimi model for latency-sensitive classification, summary,
collection and routine grounded-answer phases, and SHALL reserve the primary reasoning model for an
explicit business-analysis phase.

#### Scenario: Routine grounded answer

- **WHEN** validated evidence requires a `data_only` response
- **THEN** the runtime uses the configured fast model with thinking disabled
- **AND** does not invoke the primary reasoning model

#### Scenario: Business analysis

- **WHEN** validated evidence requires an analysis response
- **THEN** the runtime uses the configured primary model with low reasoning effort
- **AND** exposes no data tools during that analysis phase

#### Scenario: Model configuration override

- **WHEN** an operator configures `AI_KIMI_FAST_MODEL` or `AI_KIMI_MODEL`
- **THEN** the server applies each override only to its corresponding tier
- **AND** continues to share the server-side Kimi credential and endpoint

### Requirement: Kimi K2.6 context capacity

The conversation context policy SHALL treat `kimi-k2.6` as a 262,144-token context model and SHALL
prepare ordinary conversation history against that tier's capacity.

#### Scenario: K2.6 context preparation

- **WHEN** `kimi-k2.6` is the configured fast model
- **THEN** summarization thresholds derive from a 262,144-token context window
