# Proposal: Split Agent model tiers

## Why

The Agent currently sends classification, conversation summarization, routine answers and complex
business analysis to the same `kimi-k3` client. Kimi K3 always thinks and defaults to maximum
reasoning effort, so latency-sensitive phases pay the cost of deep reasoning even when they only
need constrained structured output or a grounded summary.

## Change

- Add a fast model tier, defaulting to non-thinking `kimi-k2.6`, for route classification,
  conversation summarization, tool-oriented collection and routine grounded answers.
- Keep the existing primary model, defaulting to `kimi-k3`, for explicit business-analysis phases,
  but request low reasoning effort.
- Preserve `AI_KIMI_MODEL` as the primary-model override and add `AI_KIMI_FAST_MODEL` as an
  independent fast-tier override.
- Apply the documented 256K context policy for Kimi K2.6.

## Success criteria

- Routine Agent phases do not invoke Kimi K3 or enable Kimi K2.6 thinking by default.
- Explicit analysis still uses Kimi K3 with low reasoning effort.
- Existing deployments that override `AI_KIMI_MODEL` retain that override for the primary model.
- Model selection, request tuning and context capacity have focused automated coverage.

## Non-goals

- Adding a non-Kimi provider or multiple API keys/endpoints.
- Changing intent routing, tool permissions, evidence validation or UI generation behavior.
- Claiming a latency percentage before a representative production benchmark is collected.
