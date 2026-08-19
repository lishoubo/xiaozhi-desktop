# Verification

## Behavior evidence

- Gateway regression coverage confirms general execution receives conversation summary, history and
  employee memory together with empty MCP and business-Skill allowlists.
- Runtime coverage confirms the general route allows `remember_long_term_memory` and excludes
  `render_hotel_ui`.
- Provider coverage confirms an empty MCP capability allowlist selects no server, while a hotel-data
  route selects only the DMS server.
- Routing coverage confirms standalone weather uses general conversation and weather-informed general
  hotel advice uses LLM-only hotel knowledge without the legacy weather MCP workflow.
- Routing coverage confirms a simple greeting bypasses the classifier entirely.
- Server E2E logs confirmed the hotel operating-data workflow initialized one catalog with
  `cacheKey: hotel_data` and retained the DMS evidence flow.

## Commands

- `npm run test:unit:server`: 44 files, 229 tests passed.
- `npm run test:e2e:server`: 8 tests passed.
- Final focused run after local-tool policy refinement: 3 files, 46 tests passed.
- Classifier/model-routing regression run: 4 files, 38 tests passed.
- `npm run check:server`: 0 errors and 0 warnings.
- `npm run lint --workspace @hotel-butler/server`: passed.
- `git diff --check`: passed.

## Independent verification pass

The verification pass traced every `McpToolProvider.getTools` call. Each call now supplies an explicit
capability list: intent execution policy for collection, or the fixed `hotel_data` scope for DMS hotel
resolution. No zero-argument implicit-all call remains.

The running local Compose configuration was also checked against the Moonshot-compatible endpoint:

- K2.6 thinking-disabled function calling completed successfully through LangChain.
- LangChain's inferred JSON Schema path reproduced a request timeout.
- K3 accepted `reasoning_effort: low` and returned a complete analysis response.
- After rebuilding the local image, a real authenticated `你好` Run completed in 5.66 seconds, produced
  a text-only answer, and its logs contained neither `classify_route` nor MCP catalog/tool events.

## Code-review pass

The review found one over-broad local-tool default: general conversation still exposed generative UI.
The final policy now keeps only local long-term-memory writes for general conversation and reserves
generative UI for business presentation. No remaining blocking findings were identified.

A later failure review found that the installed OpenAI adapter inferred JSON Schema support from the
non-GPT Kimi model name. The classifier now pins `functionCalling`, and deterministic general routes
run before model-assisted classification.
