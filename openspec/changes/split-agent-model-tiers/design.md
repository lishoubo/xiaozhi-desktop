# Design: Split Agent model tiers

## Model roles

`AgentEnvironment.model` remains the primary analysis model and continues to read
`AI_KIMI_MODEL`, defaulting to `kimi-k3`. A new `fastModel` reads `AI_KIMI_FAST_MODEL`, defaulting
to `kimi-k2.6`.

The fast tier serves:

- structured route classification;
- conversation summarization;
- ordinary Agent/tool execution;
- validated `data_only` answer generation.

The primary tier serves only the existing `analysisOnly` phase after deterministic collection and
evidence validation. This keeps the business state machine authoritative; model selection remains
an adapter concern.

## Request tuning

A small pure helper derives Moonshot-specific Chat Completions request fields:

- fast `kimi-k2.6` requests send `thinking: { type: 'disabled' }`;
- primary `kimi-k3` analysis sends `reasoning_effort: 'low'`;
- custom model IDs receive no Kimi-specific fields.

The fields are passed through LangChain's `modelKwargs`, which the installed
`@langchain/openai` Chat Completions adapter forwards into the request body. Tuning is centralized
so the runtime, classifier and summary generator cannot drift.

## Context and observability

Conversation preparation targets the fast model because it receives normal conversation history.
`contextPolicyForModel` recognizes Kimi K2.6 as a 262,144-token model. The Agent capability keeps
reporting the primary model for backward contract compatibility; startup/run logs include both
configured tiers where model configuration is reported.

## Configuration compatibility

Local and production Compose files expose `AI_KIMI_FAST_MODEL` with the K2.6 default while retaining
the current `AI_KIMI_MODEL` K3 setting. The API key and base URL stay shared because both tiers use
the same Moonshot account and OpenAI-compatible endpoint. Operators must still ensure their chosen
regional endpoint lists both configured model IDs.

## Failure behavior

Timeouts, retries, cancellation and error conversion remain phase-specific and unchanged. There is
no automatic cross-tier fallback: silently retrying a failed model on another tier would change
cost, latency and behavior and could duplicate an in-flight tool operation.
