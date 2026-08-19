# Hotel Agent runtime delta

## Added requirements

### Requirement: Context-aware natural-language continuation

The system SHALL use bounded persisted conversation context when routing a user message that
referentially continues an earlier request, including when the earlier Run failed.

Employee-scoped long-term memory SHALL also be available to model-driven routing, collection, general
answering and grounded-answer presentation. Deterministic authorization, evidence validation, SQL
constraints and state transitions SHALL not consume natural-language history or memory.

#### Scenario: Continue after routing failure

- **WHEN** a prior user request was persisted and its Run failed during intent classification
- **AND** the user later says “继续查询” or an equivalent referential continuation
- **THEN** the new classifier call receives bounded prior conversation text
- **AND** may recover the earlier intent, hotel, date and metric candidates
- **AND** the continuation executes as a distinct new Run

#### Scenario: Current message overrides prior context

- **WHEN** a continuation supplies a new hotel, period or metric
- **THEN** the current explicit value takes precedence over the prior request

#### Scenario: Independent new request

- **WHEN** the current message is self-contained and does not refer to an earlier request
- **THEN** routing does not inherit prior slot candidates

#### Scenario: Cancelled or failed hidden state

- **WHEN** prior execution was cancelled or failed with partial model/tool state
- **THEN** only persisted user/assistant text and the conversation summary may inform routing
- **AND** hidden reasoning, partial drafts and tool stacks are not restored or replayed
