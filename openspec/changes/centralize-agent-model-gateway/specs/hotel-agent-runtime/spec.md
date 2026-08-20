# Hotel Agent runtime delta

## MODIFIED Requirements

### Requirement: Replaceable runtime and model-provider boundaries

Run orchestration SHALL depend on the SDK-neutral `AgentRuntime` interface. All LangChain model
consumers SHALL obtain chat models through one injected, provider-neutral in-process model gateway;
only its provider adapter SHALL construct the configured provider client. SDK-specific stream and
tool-call behavior SHALL remain in the runtime adapter.

#### Scenario: Execute any model-backed Agent phase

- **WHEN** the Agent runs workflow generation, evidence analysis, route classification, context
  summarization or conversation-title generation
- **THEN** the consumer obtains its model from the shared model gateway for that named purpose
- **AND** the gateway applies the configured tier, timeout, retry and output-token policy
- **AND** lifecycle logs contain identifiers, purpose, model and duration but no prompt, output,
  credential or hotel business result

#### Scenario: Replace the model provider adapter

- **WHEN** another OpenAI-compatible model provider is introduced
- **THEN** provider construction and request tuning change behind the model-gateway port
- **AND** business routing, workflows, persistence, API contracts and data permissions do not
  require a rewrite
