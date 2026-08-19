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
- Server E2E logs confirmed the hotel operating-data workflow initialized one catalog with
  `cacheKey: hotel_data` and retained the DMS evidence flow.

## Commands

- `npm run test:unit:server`: 44 files, 229 tests passed.
- `npm run test:e2e:server`: 8 tests passed.
- Final focused run after local-tool policy refinement: 3 files, 46 tests passed.
- `npm run check:server`: 0 errors and 0 warnings.
- `npm run lint --workspace @hotel-butler/server`: passed.
- `git diff --check`: passed.

## Independent verification pass

The verification pass traced every `McpToolProvider.getTools` call. Each call now supplies an explicit
capability list: intent execution policy for collection, or the fixed `hotel_data` scope for DMS hotel
resolution. No zero-argument implicit-all call remains.

## Code-review pass

The review found one over-broad local-tool default: general conversation still exposed generative UI.
The final policy now keeps only local long-term-memory writes for general conversation and reserves
generative UI for business presentation. No remaining blocking findings were identified.
