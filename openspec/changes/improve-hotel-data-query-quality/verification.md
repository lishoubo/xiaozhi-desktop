# Verification

## Automated evidence

- `npm run test:unit:server`: completion run executed once; 278 of 279 tests passed. The sole
  failure was an existing prompt assertion for the freshness sentence after the prompt catalog was
  generated from the new registry. The sentence was restored without reverting the new behavior.
- Targeted regression after that fix: 6 files and 93 tests passed for catalog routing, SQL policy,
  prompt, evidence, runtime, gateway and MCP-provider behavior.
- Targeted deterministic presentation regression: 1 file and 5 tests passed.
- `npm run check:server`: passed with 0 errors and 0 warnings.
- `npm run lint:server`: passed.
- Real read-only DMS E2E: 2 scenarios passed. The generic flow used one local verified-schema lookup
  and two SQL calls, with no remote list/describe calls.
- Live read-only DMS metadata smoke: table listing still returned zero objects even with GUIDs
  requested. The generic workflow no longer depends on that endpoint, and the provider now rejects
  the empty result instead of treating it as usable discovery.

## Independent verification pass

- Confirmed the verified catalog contains 35 unique live RMS objects and exact column inventories.
- Confirmed complex JOIN, derived-table, CTE and UNION paths require each relation to be directly
  hotel-scoped or connected through `hotel_id` equality; date-only and Cartesian joins are rejected.
- Confirmed ordinary metric `OR` predicates remain valid when hotel scope is independently provable.
- Confirmed evidence assessment combines successful SQL results across both collection passes and
  requires all explicitly recognized request domains before grounded answering.
- Confirmed deterministic presentation preserves multiple useful SQL result sets and reports local
  row/column filtering.

## Code-review findings

No unresolved high- or medium-severity finding remains in the reviewed change. Two documentation
statements were corrected during review so they no longer claimed a persisted query fingerprint or
a mandatory warning for unclassified long-tail concepts.

Operational observation: live DMS table discovery remains misconfigured or incompatible upstream.
It is isolated from the generic hotel-data workflow by the verified local catalog, but should still
be repaired before another product path relies on live discovery.

No deployment or remote write was performed.
