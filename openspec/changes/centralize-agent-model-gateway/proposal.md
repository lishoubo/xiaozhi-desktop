# Proposal: Centralize Agent model access behind an in-process gateway

## Why

The server currently constructs `ChatOpenAI` independently in the Agent runtime, route classifier,
conversation summarizer and conversation-title generator. Provider settings, model-tier selection,
timeouts, retries and telemetry can therefore drift, and changing provider integration requires
editing several business-facing adapters.

## What changes

- Add one in-process model gateway as the only place that constructs LangChain chat models.
- Define named model purposes with bounded token, retry, timeout and streaming policies.
- Emit structured, content-free lifecycle logs for every underlying model invocation.
- Inject the gateway into the existing runtime, classifier, summarizer and title generator.
- Keep `HotelAgentGateway`, the current workflows, LangChain/LangGraph execution and read-only data
  permissions unchanged.

## Non-goals

- No standalone gateway service, observability platform or new infrastructure.
- No model-provider migration or automatic fallback between model tiers.
- No changes to Agent API contracts, prompts, intent behavior, DMS tools or write permissions.

## Success criteria

- `ChatOpenAI` is constructed only by the model-gateway adapter.
- Existing callers preserve their current model tier and request budgets.
- Model starts, completions and failures are logged without prompts or generated content.
- Affected server tests and checks pass.
